# Camenae repository guidance

## Product and ownership

Camenae is a single-user assistant application, not a harness SDK. Bob is the default
harness; the experimental OpenCode path is documented in `docs/OPENCODE.md`.
Use Camenae branding and neutral application wording; retain
Bob names for actual credentials, native SDK types, metrics, and integration contracts.
Do not claim planned integrations or preview UI controls work.

Application ownership: authentication, persistence, workspace provisioning, UI,
approval preferences, and deployment policy. The packaged SDK owns transport,
native mode/configuration management, and MCP gate semantics; Bob owns its agent
loop. Trace a gap to its owner before proposing changes. Do not conceal SDK defects
with alternate launchers, protocol implementations, output rewrites, sibling-source
imports, or installed-package edits. SDK changes require separate authorization.

Consume the exact approved package, never an arbitrary same-version archive.
SDK updates must use its packaging tooling and change `package.json`, `bun.lock`,
both Dockerfile paths/checksums, `.dockerignore`, the staging script, and the
integration guide together. Keep concrete `Bob`/`Bob*` SDK contracts at boundaries;
do not introduce aliases claiming universal harness support.

## Compatibility and safety

Preserve persisted identifiers, migrations, native IDs, `bob-gateway/usage`,
`BOB_GATEWAY_*`, encryption context, ownership markers, credential paths, and the
Compose identity `bob-camenae`. Cosmetic naming is not a data migration.

Bob workers serve one connection. The entrypoint must exit after `serveOnce()` settles;
Docker owns whole-worker teardown before reuse. Disconnect/EOF or an old healthy
status is not cleanup proof: require a new lifetime and healthy readiness.
Never silently adopt, delete, or overwrite conflicting managed native files.

Never print secrets, session tokens, generated passwords, raw provider payloads,
or argument-containing correlation IDs. Preserve `.env`, local auth, database,
workspace, and native state. Do not reprovision an initialized installation.
Use distinct test-owned projects, volumes, credentials, ports, and subnets for
acceptance; do not point test fixtures at user state. `down --volumes` is for
explicitly disposable projects only. Do not commit, push, publish, change remotes,
or select/change licensing without explicit authorization.

## Validation and delivery

Run `bun run lint` after every change batch and before completion: zero warnings
and errors, without suppressions or weaker rules. Run typecheck, production UI
build, documentation checks, and relevant tests from [development](docs/DEVELOPMENT.md).
Preserve meaningful security, lifecycle, storage, and protocol coverage. Diagnose
slow/failing tests; do not weaken assertions or raise timeouts to make them pass.
Fresh-source validation must not reuse existing `node_modules`, generated UI, or
private state. Use packaged dependencies, synthetic inputs, and isolated services.
Report skipped/blocked checks precisely. Paid inference requires specific approval.

Read the current task's deployment authorization. For ordinary authorized local
feature delivery, validate then rebuild/redeploy changed services, verify readiness
and the feature path, and hand it to the user for acceptance. Coordinate before
interrupting active work. An inspection/export/isolated-only task does not authorize
changes to the running installation. Documentation-only changes need no restart.
Automated validation is not user acceptance.

## Maintaining this repository

Keep README a concise present-tense front door. Canonical guides live in `docs/`;
keep session journals and private delivery evidence outside published source.
Retain applicable upgrade instructions and third-party notices. Source exports
must exclude Git metadata, dependencies, compiled SDK/runtime archives, generated
assets, agent-local tooling, credentials, logs, and runtime/user data.
Do not remove source or tooling without tracing callers and independently meaningful
contracts. Back up existing work externally before destructive cleanup.
