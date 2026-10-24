# Camenae

Camenae is a self-hosted personal assistant for one person working in a persistent
workspace. Ask questions, research, write, plan, and build software with an assistant
that can use tools and work with your files.

## What you can do

- Keep conversations, stream replies, inspect tool activity, and stop a running turn.
- Approve or reject each tool request the agent makes, one at a time.
- Browse a shared workspace; upload small text files, preview text, and download files.
- Attach files to chat messages; they are saved in the workspace and referenced by path.
- Choose among approved free Console models per conversation, under a local request cap.
- Sign in locally and store an encrypted provider key.

Camenae owns the application, identity, persistence, workspace, UI, and worker
deployment. The agent loop and its native tools belong to the harness: today that is
[OpenCode](docs/OPENCODE.md), integrated through `@camenae/opencode`, reaching the
approved free Console models through a guarded gateway.

## Quick start — new installation

Requirements: Linux Docker Engine with isolated internal bridges (28.4 or newer),
Docker Compose v2, Bun **1.4.2**, `sha256sum`, and the approved external SDK archive.
Builds need access to package registries and container images. The SDK is not a
published registry release and is **not included in this source repository**. Obtain
the [OpenCode archive](docs/OPENCODE.md#exact-local-dependency) before starting.

```sh
bun run sdk:stage /path/to/camenae-opencode-0.1.0-b24e73923802.tgz
bun install --frozen-lockfile
bun run dev:init
bun run auth:init
docker compose up -d --build --wait --wait-timeout 120
curl --fail http://127.0.0.1:3000/health/ready
```

Open **http://127.0.0.1:3000/chat**. Sign in as `owner` using the generated password
in `.cache/local-auth/login.txt`; read it privately, not in shared logs. Save a Console
API key under **Settings → Provider** to send messages. Saving a key does not verify it
or make a provider request. Sending messages spends from the local request cap.

Do **not** run the initialization commands on an existing installation. See
[operations](docs/OPERATIONS.md) for configuration, upgrades, retention, and recovery.

## Boundaries

This is a local, single-user, single-app-process deployment. One turn runs at a
time. Closing a browser tab does not cancel work. The worker can see the shared
workspace, but not application or database credentials, and has no direct network
access. Approvals only govern requests the harness actually asks about; they are not
a sandbox. The application reaches the provider only through a restricted egress
proxy. General browsing, package downloads, and Git network operations are blocked.

The Skills screen is a preview, not a working management control. Arbitrary model
selection, editable custom instructions, arbitrary connectors, SSO, multi-user
isolation, and production/cloud deployment are not implemented. Effect v4 RC is a
pinned pre-release dependency. Backup restoration and cross-host native-session
resume are not automated guarantees.

## Guides

- [Current status and session pickup](docs/CURRENT-STATUS.md): what exists, evidence limits, and reading order.
- [Product direction](docs/PRODUCT.md) and [roadmap](docs/ROADMAP.md): intended end state and proposed delivery gates.
- [Operations](docs/OPERATIONS.md): installation, configuration, upgrades, backup/recovery.
- [Architecture and security](docs/ARCHITECTURE.md): ownership and trust boundaries.
- [OpenCode integration](docs/OPENCODE.md): exact SDK, native lifecycle, Console setup.
- [Development and source releases](docs/DEVELOPMENT.md): checks, isolated testing, exports.
- [Third-party notices](THIRD-PARTY-NOTICES.md): licensing and redistribution boundaries.

No app-level license is currently declared. Third-party licenses do not license
Camenae-authored code; choose an app license explicitly before offering it as open source.
