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

- The New Chat selector chooses Bob or OpenCode for **new** conversations.
  `CAMENAE_HARNESS` supplies the initial selection (Bob by default) and the API
  default when the optional `harness` field is omitted. Unconfigured choices
  cannot create conversations. Existing rows retain their harness, native IDs
  and state; migration 008 defaults older rows to Bob.
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

## Console free-only setup

The optional `compose.opencode.yaml` overlay enables a private OpenCode worker
and application-owned Console gateway. It requires a dedicated
`CAMENAE_OPENCODE_PASSWORD` shared only by the app and worker. Include the overlay
alongside `compose.yaml` for a deliberately selected installation; coordinate
before changing an active installation. Do not reuse the acceptance project's
credentials or volumes. The base Compose deployment remains Bob-only.

In Settings → **Harness**, select **OpenCode** to save or remove a Console API key.
Settings also has separate **Approvals**, **Connected tools**, and **Account** tabs.
Approval preferences and Context7 apply only to Bob. Pi and additional connections
are labeled unavailable design previews, not installed integrations. Selecting a
harness card inspects its settings; **Use for new chats** changes the current page's
new-chat choice only. Reload restores the deployment default, and existing chats
keep their original harness.
The provider is fixed to Console. OpenCode chats start with
`longcat-2.5-preview-free`. The model picker inside a chat changes its saved model
for the next turn, including in existing conversations. Changes are refused while
a turn is running. Preparation applies the choice using the packaged client's
native model-switch operation, retaining the native session ID and history.
Bob model configuration remains runtime-managed and is not editable here.

The allowed chat models are Big Pickle, Fledge Alpha, Ling 3.0 Flash Fin,
Ling 3.1 Flash, LongCat 2.5 Preview, MiMo-V2.6-Flash, Nemotron 3 Ultra,
Nemotron 3.5 Lightning and Space Bunny. These use the free model IDs listed in the
Console catalog. Jev is a structured-decision model, not a chat model. Muse Spark's
Responses endpoint is not supported by this gateway. Neither is selectable.
Arbitrary endpoints, other models and fallback routes are not accepted.

Switching sends the existing conversation history to the selected provider.
Some free providers use submitted data to improve their models. Nemotron trials
prohibit personal or confidential data. Read the
[provider data-use terms](https://opencode.ai/v2/docs/console/models#privacy)
before switching.

A saved key is encrypted
with installation-bound authenticated encryption in Postgres. Retain the local
authentication/encryption file with database backups. The UI receives only saved
status, never the key. Saving does not test the provider or spend a request.
Replacing/removing a key disconnects OpenCode and can interrupt a running turn.
Bob credentials and conversations are unchanged.

The internal listener on the app's inference address, port 3003, forwards only
bounded Chat Completions requests to the [documented Console endpoint](https://opencode.ai/v2/docs/console/models).
It requires the worker credential and supplies the real Console key itself;
neither ingress nor the worker receives that key. The worker has no outbound
network and cannot use the app-only Console proxy allowance. Deployment-owned
configuration confines native background model requests to the same gateway.

Settings → **Harness** → **OpenCode** includes a persistent request cap, initially
**20**, shared across Console chats. It counts failed upstream requests and native
background requests. Set a nonnegative integer cap, or select **Unlimited** to
remove the local cap. **0** blocks new provider requests. Requests already admitted
can finish. This is not a provider quota or a billing guarantee.

**Save request cap** changes the limit without resetting usage. **Refresh allowance**
asks for confirmation, then starts usage at zero under the saved cap. Lifetime
request counts remain stored. A revision check rejects stale/repeated refresh
submissions. Migration 010 preserves existing usage and the default cap; applying
it does not grant a fresh allowance automatically.

Restarting the app or changing/removing the key does not reset usage. The UI shows
usage and a **Request limit reached** notice rather than treating exhaustion as a
missing connection. The new-chat selector labels the exhausted allowance; new chats
and the affected composer remain disabled until the owner changes or refreshes
the allowance. This installation counter does not migrate or reset any temporary
live-test gateway counter.

The listed models are advertised as free for a limited time. The allowlist prevents
selecting other models, but cannot guarantee future provider pricing or account
billing. Recheck the upstream free listing before authorized live use. No paid
fallback or automatic model substitution is implemented.

`bun run smoke:console` validates settings, encryption, harness selection and the
real native worker/gateway path with a synthetic external provider and no egress
service. It does not establish live-provider availability or billing.
