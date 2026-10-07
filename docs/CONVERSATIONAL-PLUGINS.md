# Camenae conversational plugins — handoff

## Goal and current state

Design a self-expanding Camenae: a user requests a real plugin with custom UI and
executable behavior, revises it through conversation, and shares it with another
user who connects their own accounts and can customize a fork. Example: Google
Calendar weekly planner, later revised visually and given rescheduling behavior.

Product interview is complete and the user confirmed shared understanding. An
architecture proposal was presented in chat, not approved for implementation.
No plugin implementation, prototype, or deployment has been performed. The
current request authorizes this handoff only.

## Verified completed work

- Inspected Shapeshift and json-render upstream documentation and source.
  Shapeshift selects predefined intent cards; json-render composes catalog-based
  interfaces. Neither supplies the requested executable plugin lifecycle. They
  may complement the product but must not define its ceiling.
- Created and updated `docs/PLUGIN-DESIGN.md` with three decision records and a
  working glossary. `bun run lint` passed after each documentation batch.
- Inspected then-current Camenae architecture: native skills/CLI scripts exist;
  a general plugin runtime, registry, and connection broker did not. Hosting was
  single-user with a shared authoring workspace. These observations predate the
  October 4 SDK migration and must not substitute for current source inspection.
- Researched primary sources on gVisor, browser isolation, and Calendar scopes
  and conditional updates. These support a proposal, not verified containment.

## Agreed product decisions to preserve

- Allow genuinely new frontend/backend code. Supplied components are optional
  conveniences, not a fixed vocabulary limiting functionality.
- Begin with JS/TS and dependencies; design replaceable boundaries for expansion.
- Integrate through designated extension points, initially including plugin pages
  and navigation entries. Core host UI rewriting is outside initial scope.
- Zero trust and sandboxing are foundational, including dependency installation
  and builds. Private storage and explicit grants; no ambient host/other-plugin
  access.
- Camenae owns reusable external connections. Plugins get separately granted
  scoped operations, never provider tokens.
- Host enforces external-write approvals bound to actual operations/parameters.
  Installing a plugin or enabling a schedule is not blanket write permission.
- Previews categorically prohibit real-world mutations and commitments, with NO
  ask/allow override. Sample data by default; explicitly authorized live reads
  only. Separate preview state; preview schedules disabled. The user briefly
  misunderstood this, then explicitly reaffirmed the categorical restriction.
- Build revisions alongside the active version; activate explicitly. Durable
  state, migration backups and consistent recovery are agreed in principle;
  infrastructure needs careful analysis and should remain easy to replace.
- Support schedules/background jobs and a functional host activity view with
  running/upcoming work, outcomes, pause and cancel. Extra visual indicators can
  wait. Cancellation/rollback cannot undo completed external effects.
- Share versioned packages by export/import first; optional updates, no marketplace
  requirement. Never distribute credentials/private installation data.
- Settings do not fork; activated changes to code/UI definitions/behavior do.
- MVP acceptance spans two separate Camenae instances/accounts: read-only agenda,
  conversational visual revision plus confirmed rescheduling, then sharing and
  customization by the second user. Multi-user hosting is not required.
- User grew tired of lengthy questioning. Do not restart an exhaustive interview;
  offer concrete proposals and bounded technical experiments.

## Architecture proposal presented (not implementation approval)

- Separate authoring, untrusted plugin execution, and trusted host authority.
  Do not run installed plugins in the shared harness authoring worker.
- Portable source package + immutable built version + local installation state
  are distinct. CLI, assistant and UI use the same authorized operations.
- Narrow sandbox supervisor; no unrestricted container-engine access in the app.
  OCI + gVisor was a candidate, pending compatibility/security validation.
- Plugin UI in separate-origin sandboxed frames, not imported into host React.
  Authenticated per-frame restricted messaging; opaque-origin frames report
  `"null"`, so origin allowlisting alone is insufficient. Consider a dedicated
  MessagePort bound to exact frame identity during initialization.
- Host-owned connector definitions enforce endpoint/parameter/operation semantics.
  Generated code cannot label an arbitrary HTTP request read-only. New connector
  definitions require a trust/promotion step; unknown operations fail closed.
- Host-mediated installation storage, durable jobs, explicit migration/activation
  generations. No exactly-once promise for external effects; reconcile uncertain
  outcomes rather than blindly retry writes.
- Build imported source in isolation, preserving identity/lineage; hashes identify
  contents, not author trust. No automatic fork merging in MVP.

## Unresolved technical work

Choose/prove sandbox backend, browser egress containment (iframe alone is not a
complete network boundary), broker protocol and connector promotion, dependency
policy, storage/recovery, scheduler semantics, package authenticity/update rules,
and Google OAuth onboarding. A provider's OAuth scopes may be broader than an
installation's grants; enforce finer restrictions in the broker. Calendar ETags
and If-Match help avoid overwriting intervening changes; they are not a universal
idempotency guarantee.

## Recommended next action — advice, not authorization

If the user authorizes continued engineering, propose a bounded boundary
prototype proving build/backend/UI isolation and categorical preview restrictions
before implementing Calendar functionality. Define pass/fail criteria first and
inspect current repository/runtime prerequisites. Do not silently weaken the
security promise if browser or sandbox constraints block it.

## References

- `docs/PLUGIN-DESIGN.md`: canonical agreed product decisions; read before drafting
  a detailed design. Its “pending user confirmation” sentence is stale: the user
  subsequently confirmed; do not treat proposed architecture as approved code.
- `AGENTS.md`: read current guidance before any engineering; preserve unrelated
  work, never commit/push, lint every edit batch, and follow local delivery rules.
- `docs/SELF-EXTENSION.md`: evidence for native skill/CLI creation and lifecycle;
  use when designing authoring without replacing the harness's native loop.
- `docs/ARCHITECTURE.md` and current `src/worker.ts`, runtime, identity, MCP, and UI
  shell sources: inspect for current integration seams, not historical assumptions.
- `docs/BOB-0.5.0-INTEGRATION.md` and `docs/SDK-INTEGRATION-2026-10-04.md`: use when
  tracing updated harness integration. Current guidance identifies pinned
  `@camenae/bob`, native Bob APIs, and SDK repository
   `../camenae-sdk` (sibling checkout); earlier chat's bob-gateway names are
  historical. SDK edits/migrations need separate authority; no sibling imports.
- https://github.com/anishfn/shapeshift : interaction inspiration, not runtime.
- https://github.com/vercel-labs/json-render : optional UI authoring/rendering
  substrate; its experimental Jev composition was labeled unreleased when read.
- https://gvisor.dev/docs/architecture_guide/security/ : sandbox guarantees and
  limitations; network policy/resource limits remain separate responsibilities.
- https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
  and https://html.spec.whatwg.org/multipage/web-messaging.html : browser sandbox
  and capability messaging semantics, needed for the frontend security design.
- https://developers.google.com/workspace/calendar/api/auth and
  https://developers.google.com/workspace/calendar/api/guides/version-resources :
  scope selection and optimistic concurrency for the calendar vertical slice.

## Potentially useful skills

- `prototype`: bounded experiment for one uncertain security/runtime question.
- `research`: primary-source verification of consequential technical assumptions.
- `effect`: when implementing host services using the repository's pinned Effect.
- `test-audit`: mandatory when authoring/changing/reviewing tests.
- `code-review`: formal review via reviewer agents once work is authorized.
- `grill-with-docs`: interview already completed; domain-modeling failed to load
  and was absent locally, so decisions/glossary were recorded directly.

**Authorization: This handoff transfers context only; the receiving agent must rely on the user's current instruction before acting.**
