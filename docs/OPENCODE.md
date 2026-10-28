# OpenCode integration

OpenCode **2.0.23** runs in a separate application-owned worker. The application
uses a plain Promise/event adapter; the worker has its own dependency installation
because OpenCode's Effect rc.112 is incompatible with the application's rc.118.
The isolated linker alone is insufficient: native platform caret ranges also
require the worker-root overrides in `docker/opencode-runtime/package.json`.

## Exact local dependency

Stage `camenae-opencode-0.2.0-b2c0d67d6050.tgz` using `bun run sdk:stage <archive>`.
SHA-256: `b2c0d67d6050055115dcbda4bb1f7b94ef57417ba90b42d9f7afa21c6c49fa03`.
The archive is required for a fresh application image and does not belong in source
exports.

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

- Every conversation records its harness in the `harness` column, validated by the
  application. OpenCode is the only value today; a second harness needs no schema change.
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
- OpenCode asks for native shell/tool permissions and shows bounded resources.
  Each request is decided once, in Chat.
  Saved native project approval grants cause refusal rather than silent reuse.
  The bounded, read-only workspace-name capability is an application-granted
  plugin tool; plugin tools own authorization, and permission labels alone do not
  cause native approval prompts.
- USD/token usage is native OpenCode accounting, not context occupancy or a
  provider invoice. Native sessions persist independently of worker lifetime.
- Answer text, reasoning and provider retries come from the SDK's typed `stream`.
  Reasoning is stored apart from the answer (turn column `reasoning`, capped at
  256 KiB and then dropped, never failing the answer) and shown as plain text in a
  collapsed "Thinking" box. A `retry.scheduled` event is stored as the turn's
  `retry` (attempt, time, closed category, HTTP status) and shown while the turn
  waits; it clears when text arrives or the turn ends. The provider's message and
  body never reach the application.
- The worker runs without a file watcher. A skills write marks the open connection
  stale, and Chat calls `reload()` on it just before that connection's next prompt,
  so a reload never runs during a turn (it would cancel pending approvals). A new
  connection needs no reload: acquiring one starts a new worker lifetime.

Full task sandbox orchestration, dynamic skills/capability management and a
mandatory cross-harness SDK API remain out of scope.

## Console setup

`compose.yaml` runs a private OpenCode worker and an application-owned Console
gateway. They share a dedicated `CAMENAE_OPENCODE_PASSWORD`, generated into `.env`
by `bun run dev:init`. Do not reuse the acceptance project's credentials or volumes.

In Settings → **Provider**, save or remove a Console API key and manage the request
cap. The provider is fixed to Console. Chats start with `longcat-2.5-preview-free`.
The model picker inside a chat changes its saved model for the next turn, including in
existing conversations. Changes are refused while a turn is running. Preparation
applies the choice using the packaged client's native model-switch operation,
retaining the native session ID and history.

The allowed chat models are Big Pickle, Fledge Alpha, Ling 3.0 Flash Fin,
Ling 3.1 Flash, LongCat 2.5 Preview, MiMo-V2.6-Flash, Nemotron 3 Ultra,
Nemotron 3.5 Lightning and Space Bunny. These use the free model IDs listed in the
Console catalog. Jev is a structured-decision model, not a chat model. Muse Spark's
Responses endpoint is not supported by this gateway. Neither is selectable.
Arbitrary endpoints, other models and fallback routes are not accepted.

One paid model is also selectable: **Claude Haiku 5.5** (`claude-haiku-5-5`), billed per
token to the saved Console key. OpenCode reaches it through a second provider entry,
`camenae-anthropic` (OpenCode's `anthropic-compatible` package), pointed at the
gateway's `/anthropic/v1/messages` route, which forwards to Console's Anthropic
endpoint. OpenCode owns the Messages format; the gateway checks only what sets the
bill: the model is on the paid list, `max_tokens` is at most 2048 (which also bounds
any thinking budget), billed extras (`service_tier`, `mcp_servers`, `container`,
server tools) are refused, the body is at most about 100K tokens (the price boundary),
and only known `anthropic-beta` values pass. **A paid request is refused unless a request
cap is set**; the free models still work uncapped. Within the 100K-token tier a request
costs about a cent at most, so a cap bounds spend roughly. The free route never
admits the paid model.

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
Conversations are unchanged.

The internal listener on the app's inference address, port 3003, forwards only
bounded Chat Completions requests to the [documented Console endpoint](https://opencode.ai/v2/docs/console/models).
It requires the worker credential and supplies the real Console key itself;
neither ingress nor the worker receives that key. The worker has no outbound
network and cannot use the app-only Console proxy allowance. Deployment-owned
configuration confines native background model requests to the same gateway.

Settings → **Provider** includes a persistent request cap, initially
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
missing connection. New Chat and the composer remain disabled until the owner changes or refreshes
the allowance. This installation counter does not migrate or reset any temporary
live-test gateway counter.

The free models are advertised as free for a limited time. The allowlist prevents
selecting other models, but cannot guarantee future provider pricing or account
billing. Recheck the upstream free listing before authorized live use. No
fallback or automatic model substitution is implemented.

`bun run smoke:console` validates settings, encryption and the
real native worker/gateway path with a synthetic external provider and no egress
service. It also runs a native turn on the paid model through the Anthropic route against a
synthetic streamed response, and checks the paid route's refusals and that it is
refused without a cap. It does not establish live-provider availability or billing.
