# Architecture and security

This guide describes the implemented application. See [current status](CURRENT-STATUS.md)
for verification limits, [product direction](PRODUCT.md) for the intended end state,
and [target plugin architecture](CONVERSATIONAL-PLUGINS.md) for proposed capabilities.

## Topology

```text
browser → loopback nginx ingress → Camenae (Bun / Effect, SolidJS UI)
                                  ├─ PostgreSQL
                                  ├─ @camenae/opencode → private HTTP → opencode-worker
                                  └─ Console gateway → restricted Squid CONNECT proxy → provider
```

`compose.yaml` owns deployment policy. Only ingress is published, on host loopback.
App and database share an internal backend network. App, worker, and egress share an
isolated inference bridge; only egress has outbound networking. The application
has a fixed inference-network address so Squid can allow the provider only from the
app's Console gateway. The worker has no direct outbound network and cannot reach the
app/database network or arbitrary hosts. See [OpenCode integration](OPENCODE.md) for
the worker lifecycle, gateway, and limitations.

The worker is a separate private native HTTP service. The app connects to it through
`@camenae/opencode`; the worker shares the workspace and retains its own native-state
volume. Provider requests use the app-owned restricted Console gateway.

Ingress uses a fixed `app:3000` upstream, refreshes Docker DNS after app replacement,
and is not a request-selected outbound proxy. Access/error logging and disk
buffering are disabled. It has no secrets, data mounts, or Docker socket. Its
frontend network has ordinary egress: it remains trusted infrastructure.

App and worker run as UID/GID 1000, with read-only roots, dropped capabilities,
no-new-privileges, resource limits, and init/reaping. The app has a 20-second stop grace
period and the worker 10 seconds.
Neither mounts the host workspace or Docker socket. This is container separation,
not a guarantee against kernel escapes or unsafe handling of generated artifacts.

## Source ownership

| Owner | Responsibility |
| --- | --- |
| `Configuration`, `DatabaseLive` | Validated deployment inputs, redacted secrets, scoped PostgreSQL pool and timeouts |
| `Installation`, `src/migrations/` | Persistent installation identity and forward-only transactional migrations |
| `Identity` | Local account, login admission, database-backed sessions, encrypted Console credential |
| `Workspace`, `Files` | Retained directories and bounded authenticated file operations |
| `OpenCodeRuntime`, `opencode-worker.ts` | Separate packaged OpenCode connection, native worker ownership and retirement |
| `execution-client.ts` | Narrow application chat/event adapter for the harness; not a general harness SDK |
| `console-gateway.ts` | Restricted Console forwarding, encrypted credential use, persistent request accounting |
| `Chat` | Conversations, turn admission, retained native sessions, snapshots, preparation, cancellation, usage |
| `ServerLive`, UI | Authenticated HTTP/SSE routes, presentation, shutdown |

The application uses the real `@camenae/opencode` contracts, not a universal client.
`Chat` opens each conversation's native session through the application's
`ExecutionClient`, which normalizes only the operations and events chat needs; native
session, policy, accounting, and worker contracts remain distinct. A conversation's
`harness` column records its harness, so a second one can be added without a schema change.
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
active work. Switching while idle replaces the connection.

Only one turn runs across tabs. Runs belong to application scope, not an HTTP
request or browser tab. Native cancellation has five seconds to settle before
forced disconnect/worker teardown. Expiry, logout, changed/removed credentials,
unavailable authorization, failed turns, and application shutdown retire the
connection. Revocation is scoped to the connection checked, not a later login.
No failed/interrupted prompt is automatically replayed.

A worker accepts one application owner. A replacement owner requests retirement and
waits for a different worker lifetime before acquisition; container PID 1 teardown,
not a successful interrupt response alone, bounds uncertain cleanup. The run owner
persists transcript/tool snapshots. Conditional writes prevent a stale running
snapshot from replacing a terminal row. Failed terminal writes retain an obligation
retried by reconnect; only persistence is retried. Restarted unfinished turns become
interrupted. Inspect partial side effects before resubmitting. Native context lives
in retained native state; the app does not replay transcripts.

## Storage and files

| Volume | Path | Content |
| --- | --- | --- |
| `postgres-data` | `/var/lib/postgresql/data` | Identity, conversations, turns, Console credential and request allowance |
| `workspace` | `/data/workspace` | Shared inputs, projects, outputs, scratch |
| `skills` | `/data/skills` (app, read-write), `/data/skills` (worker, read-only) | `active/` and `disabled/` skill folders, each holding a `SKILL.md`; only `active/` is in the worker's skill configuration |
| `opencode-state` | `/data/opencode-state` | Native OpenCode HOME and XDG configuration/data/state (worker only) |

Harness-specific files stay in each harness's state volume, not the workspace (see
[the layout proposal](CONVERSATIONAL-PLUGINS.md#workspace-layout-across-harnesses-proposal)).
`/data/tmp` and `/tmp` are disposable tmpfs. Workspace folders are conventions,
not conversation sandboxes. Startup rejects symbolic links in provisioned
directories; that alone is not race-proof isolation. `src/workspace-files.ts`
opens every path component relative to an open directory with `O_NOFOLLOW`, so
traversal, symlinks, and special files are refused. Limits: 1000 directory entries,
1 MiB UTF-8 text preview/edit, 15 MiB upload, 25 MiB download. Routes: list, path
finder, preview, download, raw `POST /api/files/upload` (octet-stream body, CSRF in
a header, modes `fail|replace|unique`), and `POST /api/files/edit` (new folder,
move, delete). Moves never overwrite; the top-level `inbox`, `projects`, `outputs`,
and `scratch` folders and `.git` contents cannot be changed. Previews are text,
not rendered active content.

Chat accepts up to ten attachments per message alongside a nonempty message. The
page saves each as a real workspace file (`inbox/<name>`, `-2` suffix on collision,
never overwriting) when the message is sent, and the turn stores only path
references. The harness is told the paths in the prompt and reads the files with
its own tools; contents are not inlined. These files are provider-visible when the
agent reads them, subject to the selected model's data-use terms. Older turns that
stored file text keep their paths; the text is ignored. The HTTP body ceiling is
16 MiB, applied only to the upload route; other requests retain a 16 KiB limit,
including chunked requests. Native agent access to the shared
workspace is unchanged; this is context selection, not a filesystem permission gate.

Volumes surviving container replacement is not a backup. Retain database, workspace,
native state, and encryption credentials together; see [operations](OPERATIONS.md).

## Identity and HTTP security

Local provisioning generates an `owner` password hashed with Argon2id (64 MiB,
three iterations) and an independent 256-bit encryption key. Private files are
mode 0600 in a mode-0700 directory; initialization never overwrites them. The
read-only Compose secret seeds only a new database account, not an existing one.
The Account page changes the database password after session/CSRF and current-password
verification. New passwords are 15–256 characters and use the same Argon2id parameters.
The credential file and encryption key are not rewritten. A password change rotates
the session atomically; in-flight logins cannot mint sessions using an obsolete hash.
There is no forgotten-password reset, registration, key rotation, or SSO implementation.

Login attempts, including failures/invalid usernames, are limited account-wide to
one per five seconds, shared with password-change verification. Sessions use random 256-bit opaque cookies; Postgres stores
only a SHA-256 digest, CSRF token, and eight-hour absolute expiry. New login revokes
the previous login. Every protected request checks Postgres; transactional session
locking prevents credential writes racing revocation. Streams recheck authorization
before snapshots, including while idle; database failure fails closed.

All public POSTs require the exact configured Origin, including login. Protected actions
also require the session CSRF token. Bodies/fields are bounded. Cookies are HttpOnly,
SameSite=Strict, Path=/, without Domain. HTTPS uses Secure `__Host-` cookies; HTTP
is accepted only for explicit loopback origins. There is no permissive CORS or
forwarded-host trust. Auth forms are scriptless, no-store, and disallow embedding;
the deployed UI has its own restrictive CSP. Errors/logs use fixed messages, not
secrets, raw causes, or provider payloads.

The Console key uses AES-256-GCM with a fresh 96-bit nonce and authenticated context
bound to installation ID/purpose/version (`camenae:console-key:v1`). Only ciphertext,
nonce, and tag enter Postgres. Wrong encryption keys fail startup rather than
overwriting unreadable data. Deleting a credential row does not erase backups/WAL.
Saving a key reports **saved, not verified**, and performs no inference.

The [Console setup](OPENCODE.md#console-setup) gateway on the private
inference network requires the worker credential rather than browser cookies/Origin.
It supplies the Console key outside the worker, restricts endpoint/model/output (paid models only while a cap is set), and
atomically counts requests against a persistent safety cap. Key removal clears the
live credential, not historical database backups or the request counter.

The app is trusted and can read its encryption secret; same-user app processes
can too. The worker strips ambient credentials before native launch. It has neither that
secret mount nor database credentials and never receives the provider key, but its
tools can interfere with same-UID worker processes. Environment filtering and
Compose file-secret mounts alone are not OS isolation. The local database password remains in container environment metadata,
and its role is the bootstrap owner, not a production least-privilege role split.

## Health and unsupported deployment modes

`GET /health/live` checks the HTTP process; `/health/ready` checks the database,
not provider availability or complete worker cleanup. Responses expose no private
configuration. Normal server startup does not perform inference.

Only one app process, local owner, and shared workspace are supported. HA,
multi-user isolation, cloud/TLS/SSO rollout, general internet egress, automated
backup/restore, and cross-host native-session recovery require separate design and
validation. Authorization is not execution evidence.
