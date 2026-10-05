# Experimental OpenCode integration

OpenCode **2.0.23** runs in a separate application-owned worker. The application
uses a plain Promise/event adapter; the worker has its own dependency installation
because OpenCode's Effect rc.112 is incompatible with the application's rc.118.
The isolated linker alone is insufficient: native platform caret ranges also
require the worker-root overrides in `docker/opencode-runtime/package.json`.

## Exact local dependency

Stage `camenae-opencode-0.1.0-b24e73923802.tgz` using `bun run sdk:stage <archive>`.
SHA-256: `b24e7392380263b72f1db9cdcb266b677dbd3ceddcc9bfe35dafc1d8f7839e22`.
The existing Bob archive and checksum are unchanged. Both archives are required
for a fresh application image; neither belongs in source exports.

## Isolated acceptance

`bun run smoke:opencode` builds the installed archives and starts a uniquely named
disposable Compose project. It uses synthetic credentials and a local model
fixture on internal subnet `172.30.87.0/24`; no paid provider is contacted. It
tests native streaming, one-time shell approval, the application-provided workspace
listing, cancellation, failed requests, and native session reopening. It also
crashes only the application to check old-worker retirement before reuse.

The overlay under `tests/` is an acceptance environment, **not a production
deployment recipe**. Do not apply it to the running installation. Live provider
authentication/inference, Windows, and multi-user exposure remain unvalidated.
The worker uses Bun 1.4.2. Node 22 fails on upstream emitted `await using` syntax;
the SDK archive's native lifecycle path has separately passed under Node 24.

## Contracts

- `CAMENAE_HARNESS` selects the harness for **new** conversations; existing rows
  default to Bob through migration 008 and retain their native IDs and state.
- Configure the private worker URL/password, model/provider and workspace using
  `CAMENAE_OPENCODE_*`. These are deployment configuration, not user chat inputs.
- The worker strips ambient credentials and uses dedicated HOME/XDG/native state.
  Trusted configuration disables project config discovery and supplies the
  application plugin outside the writable workspace. Writable HOME/native state
  is still untrusted execution state, not a security boundary. Deployment-owned
  configuration and plugin files must not be model-writable.
- The native HTTP listener has no published host port. It is not a sandbox;
  Compose containment, internal networking and whole-container retirement belong
  to the application. Disconnect alone is not cleanup proof.
- A worker accepts one application owner. A replacement owner requests retirement
  and waits for a different worker lifetime before acquisition. Container PID 1
  teardown, not a successful interrupt response alone, bounds uncertain cleanup.
- Native completion is distinct from prompt admission. The SDK also waits for
  the native terminal event before finishing the application's turn. Lost streams
  are terminal and prompts are never automatically replayed.
- Bob approval preferences and Context7 configuration apply **only to Bob**.
  OpenCode asks for native shell/tool permissions and shows bounded resources.
  Saved native project approval grants cause refusal rather than silent reuse.
  The bounded, read-only workspace-name capability is an application-granted
  plugin tool; plugin tools own authorization, and permission labels alone do not
  cause native approval prompts.
- USD/token usage is native OpenCode accounting, not Bobcoins, context occupancy
  or a provider invoice. Native sessions persist independently of worker lifetime.

Full task sandbox orchestration, dynamic skills/capability management and a
mandatory cross-harness SDK API remain out of scope.
