# Architecture and security

## Topology

```text
browser → loopback nginx ingress → Camenae (Bun / Effect / React)
                                  ├─ PostgreSQL
                                  ├─ trusted SDK client → Unix socket → worker → Bob
                                  └─ trusted MCP gate → Context7
worker → restricted Squid CONNECT proxy → Bob inference
```

`compose.yaml` owns deployment policy. Only ingress is published, on host loopback.
App/database share an internal backend network. App, worker, and egress share an
isolated inference bridge; only egress has outbound networking. The application
has a fixed inference-network address so Squid can allow Context7 only from its
trusted gate. The worker cannot access the app/database network or arbitrary hosts.
See [Bob integration](BOB-OPERATIONS.md) for exact endpoints and limitations.

Ingress uses a fixed `app:3000` upstream, refreshes Docker DNS after app replacement,
and is not a request-selected outbound proxy. Access/error logging and disk
buffering are disabled. It has no secrets, data mounts, or Docker socket. Its
frontend network has ordinary egress: it remains trusted infrastructure.

App and worker run as UID/GID 1000, with read-only roots, dropped capabilities,
no-new-privileges, resource limits, init/reaping, and a 20-second stop grace period.
Neither mounts the host workspace or Docker socket. This is container separation,
not a guarantee against kernel escapes or unsafe handling of generated artifacts.

## Source ownership

| Owner | Responsibility |
| --- | --- |
| `Configuration`, `DatabaseLive` | Validated deployment inputs, redacted secrets, scoped PostgreSQL pool and timeouts |
| `Installation`, `src/migrations/` | Persistent installation identity and forward-only transactional migrations |
| `Identity` | Local account, login admission, database-backed sessions, encrypted Bob credential |
| `Workspace`, `Files` | Retained directories and bounded authenticated file operations |
| `HarnessRuntime`, `worker.ts` | Packaged SDK connection, environment filtering, worker lifetime and configuration handoff |
| `Chat` | Conversations, turn admission, retained native sessions, snapshots, preparation, cancellation, usage |
| `McpPermissions` | Stored settings and application-owned lifecycle of SDK authorization gates |
| `ServerLive`, UI | Authenticated HTTP/SSE routes, presentation, shutdown |

The application uses the real `@camenae/bob` contracts, not a universal client.
Effect owns resource scopes/concurrency and SQL migrations; Zod owns application
data contracts, with Effect Schema used for typed errors. Effect and its drivers
are pinned together to v4 RC. Do not add parallel pools, agent loops, protocol
implementations, or permission evaluators to compensate for missing upstream APIs.

## Conversations and worker lifetime

Conversation preparation is an authenticated, CSRF-protected POST. It initializes
the native session without submitting a prompt or creating a turn. GET/SSE reads
do not prepare a session. Admission and authorization are rechecked inside the
lifecycle permit. One loaded native session/connection is retained between turns.
Opening the active conversation leaves it alone; selecting another cannot interrupt
active work. Switching while idle replaces the connection, MCP gate, and worker.

Only one turn runs across tabs. Runs belong to application scope, not an HTTP
request or browser tab. Native cancellation has five seconds to settle before
forced disconnect/worker teardown. Expiry, logout, changed/removed credentials,
unavailable authorization, failed turns, and application shutdown retire the
connection. Revocation is scoped to the connection checked, not a later login.
No failed/interrupted prompt is automatically replayed.

Each worker serves one SDK connection, exits after `serveOnce()` settles, and is
restarted by Docker, which ends its remaining processes. `HarnessRuntime` waits
up to 30 seconds for replacement socket identity before bootstrapping; this is a
readiness check, not an ACP retry or proof from remote disconnect alone. Tests
requiring teardown must observe a new container lifetime, not stale healthy status.

The run owner persists transcript/tool snapshots. Conditional writes prevent a
stale running snapshot from replacing a terminal row. Failed terminal writes retain
an obligation retried by reconnect; only persistence is retried. Restarted unfinished
turns become interrupted. Inspect partial side effects before resubmitting.
Native context lives in retained Bob state; the app does not replay transcripts.

## Storage and files

| Volume | Path | Content |
| --- | --- | --- |
| `postgres-data` | `/var/lib/postgresql/data` | Identity, conversations, turns, settings, decision history |
| `workspace` | `/data/workspace` | Shared inputs, projects, outputs, scratch, native workspace configuration/skills |
| `bob-state` | `/data/bob-state` | Native HOME and XDG configuration/data/state/cache |
| `bob-ipc` | `/run/bob` | Tmpfs socket `gateway.sock` and configuration fingerprint; app read-only |
| `mcp-config` | `/run/camenae-mcp` | App-published configuration; worker read-only |

`/data/tmp` and `/tmp` are disposable tmpfs. Workspace folders are conventions,
not conversation sandboxes. Startup rejects symbolic links in provisioned
directories; that alone is not race-proof isolation. File APIs reject traversal,
symlinks, and special files, with limits of 200 directory entries, 8,000 UTF-8 upload
bytes, 64 KiB plain-text preview, and 8 MiB attachment download. HTML/Markdown
previews are text, not rendered active content. Upload names are generated in inbox.

Volumes surviving container replacement is not a backup. Retain database, workspace,
native state, and encryption credentials together; see [operations](OPERATIONS.md).

## Identity and HTTP security

Local provisioning generates an `owner` password hashed with Argon2id (64 MiB,
three iterations) and an independent 256-bit encryption key. Private files are
mode 0600 in a mode-0700 directory; initialization never overwrites them. The
read-only Compose secret seeds only a new database account, not an existing one.
There is no password reset, registration, key rotation, or SSO implementation.

Login attempts, including failures/invalid usernames, are limited account-wide to
one per five seconds. Sessions use random 256-bit opaque cookies; Postgres stores
only a SHA-256 digest, CSRF token, and eight-hour absolute expiry. New login revokes
the previous login. Every protected request checks Postgres; transactional session
locking prevents credential writes racing revocation. Streams recheck authorization
before snapshots, including while idle; database failure fails closed.

All POSTs require the exact configured Origin, including login. Protected actions
also require the session CSRF token. Bodies/fields are bounded. Cookies are HttpOnly,
SameSite=Strict, Path=/, without Domain. HTTPS uses Secure `__Host-` cookies; HTTP
is accepted only for explicit loopback origins. There is no permissive CORS or
forwarded-host trust. Auth forms are scriptless, no-store, and disallow embedding;
the deployed UI has its own restrictive CSP. Errors/logs use fixed messages, not
secrets, raw causes, or provider payloads.

Bob keys use AES-256-GCM with a fresh 96-bit nonce and authenticated context bound
to installation ID/purpose/version (`camenae:bob-key:v1`). Only ciphertext, nonce,
and tag enter Postgres. Wrong encryption keys fail startup rather than overwriting
unreadable data. Deleting a credential row does not erase backups/WAL. Saving a key
reports **saved, not verified**, and performs no inference.

The app is trusted and can read its encryption secret; same-user app processes
can too. Worker environment is explicitly filtered before native launch. It has
neither that secret mount nor database credentials, but Bob/tools can see their
runtime inference key and interfere with same-UID worker processes. Environment
filtering and Compose file-secret mounts alone are not OS isolation or credential
surrogation. The local database password remains in container environment metadata,
and its role is the bootstrap owner, not a production least-privilege role split.

## Health and unsupported deployment modes

`GET /health/live` checks the HTTP process; `/health/ready` checks the database,
not provider availability or complete worker cleanup. Responses expose no private
configuration. Normal server startup does not perform inference. `check-runtime`
initializes native Bob with a synthetic credential; it consumes a worker connection.

Only one app process, local owner, and shared workspace are supported. HA,
multi-user isolation, cloud/TLS/SSO rollout, general internet egress, automated
backup/restore, and cross-host native-session recovery require separate design and
validation. Authorization is not execution evidence; see [permissions](PERMISSIONS.md).
