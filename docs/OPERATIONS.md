# Local operations

The supported topology is the repository's Docker Compose deployment on Linux.
Use Docker Engine supporting `gateway_mode_ipv4: isolated` internal bridges (28.4+
is the validation baseline) and Compose v2. Current source validation targets
Linux x64; other platforms must run the same checks before being claimed supported.

## First installation

Follow the [README quick start](../README.md#quick-start--new-installation), including
the exact external SDK delivery. Bun 1.4.2 is needed on the host for provisioning
and development; the image supplies pinned Bun and Node. PostgreSQL runs in Docker.
Image/package downloads require network access at build time. No Bob key is needed
for startup or synthetic runtime checks; real messages require an authorized key.

`dev:init` creates `.env` with a random database password and port 3000, refusing
to overwrite it. `auth:init` creates `.cache/local-auth/` and refuses to reuse an
existing directory. Inspect partial provisioning failures rather than deleting
credentials and retrying blindly. Store the generated login password in a password
manager; the operator may remove `login.txt` once it is safely retained elsewhere.
Never paste credentials into command arguments, logs, screenshots, or chat.

## Configuration

| Input | Default / contract |
| --- | --- |
| `CAMENAE_DATABASE_PASSWORD` | Required by Compose; generated in `.env`; changing it does not update an initialized database role |
| `CAMENAE_HTTP_PORT` | Host loopback ingress port, `3000` |
| `CAMENAE_ORIGIN` | Exact browser origin, `http://127.0.0.1:3000`; no trailing slash; must match a changed port |
| `CAMENAE_AUTH_FILE` | Compose host secret path, `.cache/local-auth/credentials.json` |
| `CAMENAE_INFERENCE_PREFIX` | `172.30.83` for a `/24` isolated network; choose an unused subnet if it conflicts |
| `CAMENAE_DEV_BACKEND` | UI dev proxy only, `http://127.0.0.1:3000` |

Compose supplies application inputs `CAMENAE_HOST=0.0.0.0`, `CAMENAE_PORT=3000`,
database host/name/user, `CAMENAE_DATA_DIRECTORY=/data`,
`CAMENAE_CREDENTIALS_FILE=/run/secrets/local_auth`, the private MCP gate host,
and `HTTPS_PROXY`. Direct process configuration additionally supports
`CAMENAE_DATABASE_PORT` (5432), `CAMENAE_MCP_HOST` (loopback outside Compose),
and `CAMENAE_MCP_PORT` (3001). Keep the gate on its private network, never publish
it on the host. `CAMENAE_CONTEXT7_URL` is trusted operator/test
configuration, not a user-selectable URL. Do not point it at arbitrary services.
Use the Compose topology rather than running a privileged host backend/worker.

For a different local port, change both `CAMENAE_HTTP_PORT` and `CAMENAE_ORIGIN`.
Use a separate browser profile for a separate installation: cookies on `127.0.0.1`
are shared across ports. HTTP origins are loopback-only. HTTPS cookie support is
not evidence that production TLS/reverse-proxy deployment has been validated.

## Existing installation upgrades

1. Finish active turns and coordinate any interruption. Close clients that could
   start new work. Back up the installation before applying database migrations.
2. Keep `.env`, `.cache/local-auth/credentials.json`, all state volumes, and the
   existing Compose project identity. The default name is **`bob-camenae`**;
   changing it selects different volumes, not a renamed installation.
3. Check [managed-file ownership](BOB-OPERATIONS.md#managed-native-files) before
   upgrading. Resolve conflicts explicitly; never delete/adopt user configuration.
4. Validate and build with the approved dependency. Replace idle app and worker
   together, ending the complete old worker lifetime:

   ```sh
   docker compose build app worker
   docker compose stop app worker
   docker compose up -d --no-deps --force-recreate --wait --wait-timeout 90 worker app
   curl --fail http://127.0.0.1:3000/health/ready
   ```

   If ingress/egress configuration changed, rebuild and replace those services too
   in the same coordinated maintenance window.
5. Verify sign-in, preparation, preserved conversations/files, and confirmed active
   settings. A ready database or old worker health status alone is insufficient.

Forward-only database migrations run automatically on app startup. Do not reset
migration IDs, rename database columns/tables, or rerun initialization. Replacing
the credentials file is not a password-reset mechanism. Restoring old code after
a migration is not a supported downgrade; restore a matching backup if necessary.

Upgrades from installations exposing native Always approval choices must replace
both idle app and worker to clear native in-memory approvals. Migration 006 gives
older turns empty approval history; no decisions are inferred or backfilled.
Protocol names, `BOB_GATEWAY_*`, encryption context, native IDs, and ownership
markers remain compatibility contracts even when UI wording changes.

## Backup and recovery

There is no automated backup/restore command or established cross-host native
resume guarantee. Container recreation tests are not disaster-recovery tests.
Use an operator-managed, encrypted, access-restricted backup and test restoration
on an isolated installation before relying on it.

For a consistent cold backup:

1. Coordinate downtime, finish active work, stop app/worker first, then stop the
   remaining Compose services with `docker compose stop`. Do not remove volumes.
2. Record the Compose project name, source version, exact SDK checksum/image
   versions, configuration, and volume names from `docker compose config --volumes`
   (not a full config dump containing secrets).
3. Back up the stopped `postgres-data`, `workspace`, and `bob-state` volumes using
   a volume-aware backup tool preserving numeric ownership/modes. Include
   `mcp-config` as installation configuration; its contents are private and can
   include runtime gate tokens. Do not treat the tmpfs `bob-ipc` socket as data.
4. Back up `.env` and `credentials.json` **privately, separately from the database**.
   Keep the generated login password in the password manager. A database backup
   without its encryption key cannot recover stored inference credentials.
5. Restart the same installation only after copies complete. Store backups outside
   source archives and restrict access to native state and workspace contents too.

For recovery, provision an isolated target with the same application/SDK versions,
PostgreSQL major version, project-to-volume mapping, UID/GID and file modes. Restore
the stopped database and matching workspace/native state together with the original
auth encryption key and configuration. Do not run `dev:init`/`auth:init` over them.
Regenerate runtime IPC through startup, then verify readiness, authentication,
decryption, file access, settings, and native session preparation. Keep the original
backup untouched. Provider-backed resume requires a separately authorized live
check; stop if the native runtime or schema is incompatible rather than replaying
old transcripts as prompts. Never mix database and encryption-key backups from
different installation identities.

Ordinary `docker compose down` retains named volumes, but **never use
`down --volumes` for routine cleanup of an installation**. It is reserved for
explicitly disposable tests. Secret removal from the current database does not
erase copies in backups or WAL.
