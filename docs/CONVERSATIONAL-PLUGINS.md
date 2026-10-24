# Target plugin architecture

## Scope and status

Design a self-expanding Camenae: a user requests a real plugin with custom UI and
executable behavior, revises it through conversation, and shares it with another
user who connects their own accounts and can customize a fork. Example: Google
Calendar weekly planner, later revised visually and given rescheduling behavior.

This is the proposed future architecture, consolidated on 2026-10-24 from the
earlier plugin brief and subsequent blank-slate product discussion. It is not an
implemented plugin platform or authorization to build one. See [current status](CURRENT-STATUS.md),
[product direction](PRODUCT.md), [roadmap](ROADMAP.md), and the
[implemented architecture](ARCHITECTURE.md).

## Agreed product decisions to preserve

- Allow genuinely new frontend/backend code. Supplied components are optional
  conveniences, not a fixed vocabulary limiting functionality.
- Begin with JS/TS and dependencies; design replaceable boundaries for expansion.
- Integrate through designated extension points, initially including plugin pages
  and navigation entries. The original first slice excluded core host UI rewriting.
  The later end-state requirement expands user-facing shell customization; this
  does not authorize arbitrary host-code execution or remove trust boundaries.
- Zero trust and sandboxing are foundational, including dependency installation
  and builds. Private storage and explicit grants; no ambient host/other-plugin
  access.
- Camenae owns reusable external connections. Plugins get separately granted
  scoped operations, never provider tokens.
- Host enforces external-write approvals bound to actual operations/parameters.
  Installing a plugin or enabling a schedule is not blanket write permission.
- Previews categorically prohibit real-world mutations and commitments, with NO
  ask/allow override. Sample data by default; explicitly authorized live reads
  only. Separate preview state; preview schedules disabled.
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
- Prefer concrete proposals and bounded technical experiments over repeating an
  exhaustive product interview whose decisions are already recorded here.

## Proposed structure

```text
request / selected element / current version
    -> authoring harness
    -> proposed definition or isolated code change
    -> host validation, functional checks, migration review
    -> no-write preview
    -> explicit activation of an immutable version
    -> installed UI and runtime with installation-local state and grants
```

The application owns the durable artifact and installed execution. A harness
authors proposals; its session is not the runtime of an installed plugin. Normal
non-AI operations must work without an authoring provider. Runtime model calls,
where needed, are explicit scoped operations with their own costs and failures.

| Definition | Responsibility |
| --- | --- |
| UI catalog and view | Registered components, layouts, data bindings, and interaction contracts. |
| Backend capability catalog | Typed, bounded storage/query/calculation operations and trusted connector actions. |
| Workflow | Explicit steps, triggers, version identity, budgets, and failure/approval behavior. |
| Theme | Semantic appearance values and checked assets, without execution authority. |
| Package and immutable version | Portable definitions/source, dependency requirements, compatibility, identity, and lineage. |
| Installation | Selected version, owner, private records, local settings, connection bindings, and grants. |
| Draft and activation | Proposed change against a base version, verification state, migration/recovery plan, and explicit promotion. |
| Run | Operation identity, authorized parameters, outcome, and uncertainty about external effects. |

Stable field/record identities should survive renames. Reject stale activation
against a newer base version. Bind jobs to the activated version and reconcile
old work before granting a replacement version authority. Schema rollback must
not silently erase records created after an update.

## Catalogs, decision models, and custom code

The preferred implementation direction is catalog-first, with isolated custom
extensions when existing capabilities cannot express a request. Catalogs must not
quietly become a fixed ceiling on the agreed open-ended product.

json-render is a candidate UI renderer with application-defined components and
actions. It does not implement durable storage, authorization, workflow execution,
or safe plugin installation. Prefer supported extension points before deciding
to maintain a fork. It is not installed in the current app.

Jev can choose among supplied candidates or bounded options. The harness or app
must still prepare values, bindings, and genuinely new content. Keep arithmetic,
dates, permissions, grants, limits, and deterministic operations in code. Neither
schema validity nor a model's confidence establishes semantic correctness or
authority. Compare whole workflows before adopting model routing as an optimization.

The October research found contradictory release wording: the Jev guide said
“unreleased,” while published json-render core 0.21.0 declarations exported the
experimental composition APIs. This is historical evidence, not a current version
recommendation. Check exact package capabilities and stability before integration.

Custom computations do not automatically justify custom authority. New connectors
need reviewed operation contracts. An extension cannot promote itself into the
trusted catalog, declare arbitrary HTTP read-only, or inspect other installations.
Scope authoring inputs too: displaying private data does not automatically permit
sending that data to a model provider.

## Theming and editable views

Use semantic roles consistently across the host shell and generated components:
text, surfaces, actions, feedback, focus, and interaction states. Extend appearance
definitions to typography, spacing/density, borders, corners, elevation, and motion.
Keep layout and behavior separate from theme values.

A received plugin uses the recipient's theme by default. Importing the author's
theme or workspace arrangement is a separate choice. Direct controls and text
edits should update the same definitions. Preserve a host-owned path to home,
permissions, history, cancellation, and recovery outside generated content's control.

Theme imports are bounded data and checked assets, not arbitrary install scripts.
Validate actual rendered contrast, focus, keyboard navigation, zoom, and reduced
motion. Remote assets, arbitrary CSS, and isolated custom components need explicit
network/accessibility policies; a token schema alone cannot enforce them.

## Sharing and updates

Start with copying a versioned package between separate installations. Import
with clean sample data, explicit grants, and recipient-owned connection setup.
Exclude records, credentials, private chat history, logs, and personal values
embedded in generated source, labels, or previews. Hashes prove identity of
contents, not author trust.

Settings remain local without creating a fork. Activated changes to definitions
or behavior preserve fork lineage. Updates are optional, permission increases
require fresh grants, and customized copies are not silently overwritten. No
automatic fork merging is required initially.

Shared live data requires a separate ownership/membership/revocation design.
It is not a consequence of installing the same package. Revoking a download link
cannot recall already downloaded copies. Cross-plugin data access likewise needs
explicit grants and versioned contracts, not ambient access to a common database.

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

## References and continuity

Earlier handoff text referred to `docs/PLUGIN-DESIGN.md` and
`docs/SELF-EXTENSION.md`, which are absent from this checkout. Do not treat those
paths as required reading or claim their contents were recovered. The preserved
requirements are above; the subsequent product direction and proposed plan live
in [product direction](PRODUCT.md) and [roadmap](ROADMAP.md).

- [Repository guidance](../AGENTS.md): ownership, preservation, authorization,
  and validation requirements for every implementation task.
- [Current architecture](ARCHITECTURE.md): source ownership and current trust limits.
- [Bob operations](BOB-OPERATIONS.md) and [OpenCode](OPENCODE.md): exact packaged
  SDK delivery and native integration contracts. SDK changes require separate
  authorization; no sibling-source imports or installed-package edits.
- https://github.com/anishfn/shapeshift : interaction inspiration, not runtime.
- https://github.com/vercel-labs/json-render : candidate UI renderer, not the
  application backend or plugin security boundary.
- https://json-render.dev/docs/jev : bounded composition and current limitations.
- https://github.com/bjarneo/100-themes : theme packaging and palette inspiration.
- https://opencode.ai/v2/docs/cli/theme : semantic theme role inspiration.
- https://gvisor.dev/docs/architecture_guide/security/ : sandbox guarantees and
  limitations; network policy/resource limits remain separate responsibilities.
- https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox
  and https://html.spec.whatwg.org/multipage/web-messaging.html : browser sandbox
  and capability messaging semantics, needed for the frontend security design.
- https://developers.google.com/workspace/calendar/api/auth and
  https://developers.google.com/workspace/calendar/api/guides/version-resources :
  scope selection and optimistic concurrency for the calendar vertical slice.

**Authorization:** This architecture records requirements and proposals. It does
not authorize implementation, a new harness, SDK changes, or deployment.
