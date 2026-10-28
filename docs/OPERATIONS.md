# Local operations

The supported topology is the repository's Docker Compose deployment on Linux.
Use Docker Engine supporting `gateway_mode_ipv4: isolated` internal bridges (28.4+
is the validation baseline) and Compose v2. Current source validation targets
Linux x64; other platforms must run the same checks before being claimed supported.

## First installation

Follow the [README quick start](../README.md#quick-start--new-installation), including
the exact external SDK delivery. Bun 1.4.2 is needed on the host for provisioning
and development; the image supplies pinned Bun and Node. PostgreSQL runs in Docker.
Image/package downloads require network access at build time. No provider key is needed
for startup or synthetic runtime checks; real messages require a Console key saved in Settings.

`dev:init` creates `.env` with a random database password, a random OpenCode worker
password and port 3000, refusing to overwrite it. `auth:init` creates `.cache/local-auth/` and refuses to reuse an
existing directory. Inspect partial provisioning failures rather than deleting
credentials and retrying blindly. Store the generated login password in a password
manager; the operator may remove `login.txt` once it is safely retained elsewhere.
Never paste credentials into command arguments, logs, screenshots, or chat.

### Sign in and choose your password

Open `/auth/login` on your installation and use its generated password for the
first sign-in. No username or email entry is needed: this is the local owner account.
Sign-in opens Chat. Open **Account** in the sidebar (or **Manage account** in Settings)
and enter the current password, then a new 15–256-character password twice.
Save it in your password manager. Future sign-ins use that password, not `login.txt`.
The old generated password no longer works for this database; the login file is
not rewritten. Keep `credentials.json`: its independent encryption key is still needed.

Password changes replace the sign-in session without changing conversations, files,
or provider keys. Login and password verification share a five-second attempt limit.
The Account page also provides **Sign out**. There is no Google/SSO, public signup,
or email password recovery. If you forget a changed password, do not reprovision
or replace the credentials file; it cannot reset an initialized account.

## Configuration

| Input | Default / contract |
| --- | --- |
| `CAMENAE_DATABASE_PASSWORD` | Required by Compose; generated in `.env`; changing it does not update an initialized database role |
| `CAMENAE_OPENCODE_PASSWORD` | Required by Compose; generated in `.env`; shared only by the app and the worker |
| `CAMENAE_HTTP_PORT` | Host loopback ingress port, `3000` |
| `CAMENAE_ORIGIN` | Exact browser origin, `http://127.0.0.1:3000`; no trailing slash; must match a changed port |
| `CAMENAE_AUTH_FILE` | Compose host secret path, `.cache/local-auth/credentials.json` |
| `CAMENAE_INFERENCE_PREFIX` | `172.30.83` for a `/24` isolated network; choose an unused subnet if it conflicts |
| `CAMENAE_DEV_BACKEND` | UI dev proxy only, `http://127.0.0.1:3000` |

Compose supplies application inputs `CAMENAE_HOST=0.0.0.0`, `CAMENAE_PORT=3000`,
database host/name/user, `CAMENAE_DATA_DIRECTORY=/data`,
`CAMENAE_CREDENTIALS_FILE=/run/secrets/local_auth`, the private worker URL, and
`HTTPS_PROXY`. Direct process configuration additionally supports
`CAMENAE_DATABASE_PORT` (5432) and `CAMENAE_GATEWAY_HOST` (the address the private
Console gateway binds, port 3003; loopback outside Compose, never published on the
host). Use the Compose topology rather than running a
privileged host backend/worker.

### Quotes on the sign-in page

The sign-in page shows a random quotation chosen on the server, and the signed-in app can
request one from `GET /api/quote`. The image contains the committed public-domain set
(`/app/data/quotes/quotes.jsonl`); `CAMENAE_QUOTES_DIRECTORY` (default `data`, relative to
`/app`) names where it is read, separate from the storage directory. Files are read once at
start-up, and missing or unreadable files just mean no quote. To also show the private
Warhammer 40,000 set, build it locally and start with
`docker compose -f compose.yaml -f compose.private-quotes.yaml up -d`; it is mounted
read-only and never copied into an image. Build it first: Docker creates a directory where
a missing bind-mount file should be.

For a different local port, change both `CAMENAE_HTTP_PORT` and `CAMENAE_ORIGIN`.
Use a separate browser profile for a separate installation: cookies on `127.0.0.1`
are shared across ports. HTTP origins are loopback-only. HTTPS cookie support is
not evidence that production TLS/reverse-proxy deployment has been validated.

## Existing installation upgrades

1. Finish active turns and coordinate any interruption. Close clients that could
   start new work. Back up the installation before applying database migrations.
2. Keep `.env`, `.cache/local-auth/credentials.json`, and all state volumes. The
   Compose project name selects the volumes: changing it selects different, empty
   volumes, not a renamed installation. Add `CAMENAE_OPENCODE_PASSWORD` to an existing
   `.env` by hand if it is missing; `dev:init` never overwrites that file.
3. Migration 013 permanently deletes conversations that belong to a retired harness
   and drops obsolete tables. It runs automatically on the first start and cannot be
   undone; restore a backup if that was not intended. Migration 014 only adds the empty
   `app` and `app_entry` tables. Migration 015 adds the `reasoning` and `retry` columns
   to `turn`; existing turns get empty reasoning and no retry.
4. Validate and build with the approved dependency. Replace idle app and worker
   together, ending the complete old worker lifetime:

   ```sh
   docker compose build app opencode-worker
   docker compose stop app opencode-worker
   docker compose up -d --no-deps --force-recreate --wait --wait-timeout 120 opencode-worker app
   curl --fail http://127.0.0.1:3000/health/ready
   ```

   If ingress/egress configuration changed, rebuild and replace those services too
   in the same coordinated maintenance window.
5. Verify sign-in, preparation, preserved conversations/files, and the saved provider
   key. A ready database or old worker health status alone is insufficient.

Forward-only database migrations run automatically on app startup. Do not reset
migration IDs, rename database columns/tables, or rerun initialization. Replacing
the credentials file is not a password-reset mechanism. Restoring old code after
a migration is not a supported downgrade; restore a matching backup if necessary.
Encryption context strings and native IDs remain compatibility contracts even when
UI wording changes.

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
3. Back up the stopped `postgres-data`, `workspace`, and `opencode-state` volumes using
   a volume-aware backup tool preserving numeric ownership/modes.
4. Back up `.env` and `credentials.json` **privately, separately from the database**.
   Keep the generated login password in the password manager. A database backup
   without its encryption key cannot recover the stored provider key.
5. Restart the same installation only after copies complete. Store backups outside
   source archives and restrict access to native state and workspace contents too.

For recovery, provision an isolated target with the same application/SDK versions,
PostgreSQL major version, project-to-volume mapping, UID/GID and file modes. Restore
the stopped database and matching workspace/native state together with the original
auth encryption key and configuration. Do not run `dev:init`/`auth:init` over them.
Start the stack, then verify readiness, authentication,
decryption, file access, settings, and native session preparation. Keep the original
backup untouched. Provider-backed resume requires a separately authorized live
check; stop if the native runtime or schema is incompatible rather than replaying
old transcripts as prompts. Never mix database and encryption-key backups from
different installation identities.

Ordinary `docker compose down` retains named volumes, but **never use
`down --volumes` for routine cleanup of an installation**. It is reserved for
explicitly disposable tests. Secret removal from the current database does not
erase copies in backups or WAL.
