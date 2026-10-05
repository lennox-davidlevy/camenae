# Camenae

Camenae is a self-hosted personal assistant for one person working in a persistent
workspace. Ask questions, research, write, plan, and build software with an assistant
that can use tools and work with your files.

## What you can do

- Keep conversations, stream replies, inspect tool activity, and stop a running turn.
- Browse a shared workspace; upload small text files, preview text, and download files.
- Choose persistent approval preferences and per-tool Context7 permissions.
- Reuse native workspace skills and scripts across new conversations.
- Sign in locally and store an encrypted inference credential.

**Bob is the default harness**, integrated through `@camenae/bob`. An
[experimental OpenCode integration](docs/OPENCODE.md) is available for isolated
acceptance; the standard Compose installation below deploys Bob. Camenae
owns the application, identity, persistence, workspace, UI, and worker deployment;
each harness owns its agent loop and native tools. There is no UI harness selector.

## Quick start — new installation

Requirements: Linux Docker Engine with isolated internal bridges (28.4 or newer),
Docker Compose v2, Bun **1.4.2**, `sha256sum`, and both approved external SDK archives.
Builds need access to package registries and container images. The SDK is not a
published registry release and its bundled Bob runtime is **not included in this
source repository**. Obtain the exact Bob delivery described in the
[Bob integration guide](docs/BOB-OPERATIONS.md#sdk-dependency) and the
[OpenCode archive](docs/OPENCODE.md#exact-local-dependency) before starting.
Both are required to install/build, even when using only Bob.

```sh
bun run sdk:stage /path/to/approved-bob-sdk.tgz
bun run sdk:stage /path/to/camenae-opencode-0.1.0-b24e73923802.tgz
bun install --frozen-lockfile
bun run dev:init
bun run auth:init
docker compose up -d --build --wait --wait-timeout 90
curl --fail http://127.0.0.1:3000/health/ready
```

Open **http://127.0.0.1:3000/chat**. Sign in as `owner` using the generated password
in `.cache/local-auth/login.txt`; read it privately, not in shared logs. Save a Bob
API key under **Connection & account** to send messages. Saving a key does not
verify it or make an inference request. Sending messages may incur charges.
Enabled Context7 tools require the hosted service even during conversation preparation.

Do **not** run the initialization commands on an existing installation. See
[operations](docs/OPERATIONS.md) for configuration, upgrades, retention, and recovery.

## Boundaries

This is a local, single-user, single-app-process deployment. One turn runs at a
time. Closing a browser tab does not cancel work. The worker can see its inference
key and shared workspace, but not application/database credentials. Approval
settings only govern requests actually made by the harness; they are not a sandbox.
Network access is restricted to Bob inference and trusted-gate Context7 requests.
General browsing, package downloads, and Git network operations are blocked.

The Skills screen and conversation-policy buttons are previews, not working
management controls. Model selection, editable custom instructions, arbitrary
connectors, SSO, multi-user isolation, and production/cloud deployment are not
implemented. Effect v4 RC is a pinned pre-release dependency. Backup restoration
and cross-host native-session resume are not automated guarantees.

## Guides

- [Operations](docs/OPERATIONS.md): installation, configuration, upgrades, backup/recovery.
- [Architecture and security](docs/ARCHITECTURE.md): ownership and trust boundaries.
- [Permissions](docs/PERMISSIONS.md): approvals, Context7, history, and limitations.
- [Bob integration](docs/BOB-OPERATIONS.md): exact SDK, usage, native modes and skills.
- [Development and source releases](docs/DEVELOPMENT.md): checks, isolated testing, exports.
- [Third-party notices](THIRD-PARTY-NOTICES.md): licensing and redistribution boundaries.

No app-level license is currently declared. Third-party licenses do not license
Camenae-authored code; choose an app license explicitly before offering it as open source.
