# Camenae repository guidance

## Start here

For a new session or harness, read these repository documents in order:

1. [Current status](docs/CURRENT-STATUS.md): implemented capabilities, evidence
   limits, pending acceptance, and the next recommended decision.
2. [Product direction](docs/PRODUCT.md): the intended end state and decision status.
3. [Current architecture](docs/ARCHITECTURE.md): existing runtime and ownership.
4. [Target plugin architecture](docs/CONVERSATIONAL-PLUGINS.md): proposed execution,
   data, theming, sharing, and trust boundaries; not an implemented platform.
5. [Roadmap](docs/ROADMAP.md): proposed phases, acceptance gates, and deferred work.

Use [development](docs/DEVELOPMENT.md) for checks and [operations](docs/OPERATIONS.md)
for the selected installation. Source, deployment evidence, and user acceptance
are separate facts. Recheck the worktree and relevant source before acting; a
dated status entry is not proof of current readiness. Plans and handoffs do not
authorize implementation, paid inference, deployment, or SDK changes.

Keep these documents current when a task changes capabilities or decisions.
Keep durable product context in the repository, not solely in temporary files or
session history. Keep private delivery evidence and session journals outside it.

## Product and ownership

Camenae is a single-user assistant application, not a harness SDK. OpenCode is the
only implemented harness; see `docs/OPENCODE.md`. The intended product is a blank-slate
personal app that users create and modify through conversation, including themes,
views, functionality, and shareable plugins. That end state is not implemented. Pi,
Claude, Codex, a new harness, and a json-render fork are not approved implementation
work merely because they appear in planning. The UI is moving from React to SolidJS
in stages; the React UI stays the working interface until the Solid one reaches parity.
Use Camenae branding and neutral application wording; retain native SDK type names
only at integration boundaries. Do not claim planned integrations or preview UI
controls work.

Application ownership: authentication, persistence, workspace provisioning, UI,
and deployment policy. The packaged SDK owns transport and native
configuration management; the harness owns its agent loop. Trace a gap to its owner
before proposing changes. Do not conceal SDK defects
with alternate launchers, protocol implementations, output rewrites, sibling-source
imports, or installed-package edits. SDK changes require separate authorization.

Consume the exact approved package, never an arbitrary same-version archive.
SDK updates must use its packaging tooling and change `package.json`, `bun.lock`,
the Dockerfile path/checksum, `.dockerignore`, the staging script, and the
integration guide together. Keep concrete SDK contracts at boundaries; do not
introduce aliases claiming universal harness support.

## Compatibility and safety

Preserve persisted identifiers, migrations, native IDs, encryption context strings,
credential paths, and the Compose project identity `camenae`. Cosmetic naming is not
a data migration, and changing the project name selects different volumes.

A worker accepts one application owner. Docker owns whole-worker teardown before
reuse. Disconnect/EOF or an old healthy status is not cleanup proof: require a new
lifetime and healthy readiness. Never silently adopt, delete, or overwrite
conflicting managed native files.

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

## UI design references

For UI work, inspect the interactive HTML mockups in `docs/design/camenae-ui`
with Playwright Code Mode tools. These are design references, not evidence that
the corresponding app features exist. Close the browser when finished.

Start the preview on demand using the installed `live-server` (from the repository
root):

```sh
cd docs/design/camenae-ui
live-server --host=127.0.0.1 --port=8080 --no-browser
```

Check port 8080 first. Reuse an existing preview only after confirming it serves
these mockups; do not stop or replace an unrelated service. If occupied, use an
unused port explicitly and adjust the URLs. Verify the actual listening URL.
Serve only the design directory, never the repository root. Keep the preview
loopback-only; stop a preview you started when finished unless asked to leave it up.
No always-on service or application deployment is needed.

- App views: http://127.0.0.1:8080/Camenae.dc.html
- Login page: http://127.0.0.1:8080/Login.dc.html
- Potential conversational UI items: http://127.0.0.1:8080/Catalog.dc.html — reference
  for [conversational plugins](docs/CONVERSATIONAL-PLUGINS.md); `json-render` is a
  possible implementation approach, not an adopted integration.

## Maintaining this repository

Keep README a concise present-tense front door. Canonical guides live in `docs/`;
keep session journals and private delivery evidence outside published source.
Retain applicable upgrade instructions and third-party notices. Source exports
must exclude Git metadata, dependencies, compiled SDK/runtime archives, generated
assets, agent-local tooling, credentials, logs, and runtime/user data.
Do not remove source or tooling without tracing callers and independently meaningful
contracts. Back up existing work externally before destructive cleanup.
