# Product direction

Decision baseline: October 2026 product discussion, recorded in the repository on
2026-10-24. This is the intended product, not a list of implemented features.
Read [current status](CURRENT-STATUS.md) for what exists today.

## Intended end state

Camenae is a personal app the user creates and changes through conversation.
A new user opens a blank slate with **Do anything** and a text box. They can ask
for a calorie tracker, a Steam-connected game recommendation tool, a planner,
or another useful feature. Camenae creates a persistent, usable tool inside their
app, then lets them change it as their needs change.

The customization goal covers the user-facing application: appearance,
navigation, layouts, views, interactions, and functionality. Chat is the means of
building and modifying the experience; it need not remain the main screen.
Installed tools should be usable directly without a new conversation for every
action. Reliability, efficiency, and ease of use take priority over the number
of generated features.

A user can share a plugin with a friend who uses Camenae. The friend installs it,
connects their own accounts, and modifies their own copy. Themes and workspace
arrangements should also be portable. Sharing functionality must not implicitly
share personal records, credentials, or authoring conversations.

The long-term ambition is broader than templates or a fixed component menu.
Catalogs should make common requests reliable and efficient without ruling out
genuinely new frontend or backend behavior.

## What a complete experience means

1. **Create.** Describe a need, answer only necessary questions, and try a working
   preview. Example data and unavailable integrations are labeled honestly.
2. **Use.** Reopen the tool, enter records, and perform ordinary operations
   directly. Non-AI operations do not require model inference.
3. **Change.** Select an element or describe a behavior change. Revise a draft
   while the current version stays usable. Preserve unrelated behavior and data.
4. **Activate and recover.** Understand what changes, activate a version, and
   reach history, permissions, and recovery even after a bad customization.
5. **Share.** Export or send a versioned creation. The recipient installs an
   independent copy with their own private state and explicit grants.
6. **Evolve.** Receive optional updates without silently losing local changes.
   Shared live data and collaborative editing are separate later capabilities.

Text-first does not require text-only operation. Direct controls and conversational
edits should update the same definitions. Mobile browser use, accessibility,
clear save state, and predictable error recovery are part of usefulness.

## Decision status

| Topic | Status |
| --- | --- |
| Blank slate, “Do anything,” conversational creation and extensive UI customization | User-stated end-state requirement. |
| Persistent functional plugins and friend-to-friend editable sharing | User-stated end-state requirement. |
| Reliability, efficiency, and ease of use | User-stated priorities. |
| json-render UI catalog plus app-owned backend capability catalog | User-selected direction to investigate; no integration installed here. |
| Per-project isolation, language toolchains, egress control, and rendered previews | User-stated wish (2026-10-25), deferred behind the personal assistant (2026-10-26), carried over from the earlier `bob-workspace` project (design and code map in its `docs/TOOLCHAINS.md`, `docs/NETWORK_ACCESS.md`, `docs/OPENSHIFT_CODE.md`; outside this repository). Not implemented here. The provisioner model is undecided; see the [roadmap](ROADMAP.md#project-isolation-toolchains-and-previews-proposed-port). |
| Multi-harness through `camenae-sdk` | User decision (2026-10-26): the SDK is the one entry point for any harness; the personal assistant is its first application. |
| How to judge readiness | User decision (2026-10-26): build to the owner's taste; user interviews and demand tests are not a gate for now. A reliable model for testing is needed, since the free models made live checks ambiguous. |
| Jev or other decision models for bounded choices | Desired technical direction; exact placement and measurable benefit remain unproven. |
| Themes inspired by Omarchy theme packages and OpenCode semantic tokens | User-selected direction; not an implemented theme-import system. |
| New executable code, scoped connections, no-write previews, explicit activation | Preserved requirements from the earlier plugin design discussion; see [target architecture](CONVERSATIONAL-PLUGINS.md). |
| Catalog-first implementation with isolated custom extensions | Architecture recommendation, not a completed or validated design. |
| Protected host authority and recovery alongside customizable UI | Recommended boundary for satisfying customization without allowing generated code to redefine permissions. |
| Fork json-render | Originally proposed by the user; recommendation is to use extension points first. No fork decision or work is approved. |
| UI framework: SolidJS, replacing React and `assistant-ui` | User-selected direction (2026-10-24); the chat UI is now SolidJS and React is removed. A synthetic spike of `@json-render/solid` 0.21.3 passed streaming, repeated lists, `pushState`, `$computed`, and `$math`. Filtered repeat lists with the condition on the container render nothing (a documented React-only feature); a condition on the child row worked. Catalog validation did not reject a wrong prop type, so props need an application-owned check. Evidence is jsdom only, not a browser or user acceptance. |
| Backend language: stay on TypeScript with Effect | User-selected direction. Rust or Go only for a concrete need, such as a proxy or sandbox supervisor. |
| Supported harnesses: OpenCode today; Pi, Claude, and Codex intended | User-stated direction. OpenCode is the only implemented harness; the `harness` column and execution adapter leave room for more without a schema change. |
| Bundle Context7 and Playwright with the application | User-stated requirement; not implemented. Must go through the application's own permission and network rules. |
| Build a new harness or add Pi | Discussed, not selected for implementation. Recommendation is to defer until a concrete product limitation justifies it. |
| Game-backlog pilot, customer cohort, pricing, and delivery schedule | Recommendations in the [roadmap](ROADMAP.md), not confirmed market demand or committed scope. |
| Open source, hosted service, commercial licensing | Unresolved owner decisions; no license change is authorized. |

## Product boundaries

- Appearance customization must not grant new authority. Authentication,
  permission enforcement, and recovery remain host-owned.
- A saved or schema-valid definition is not proof of correct behavior.
- An unsupported request must be reported, not represented by a nonfunctional
  control that appears complete.
- A plugin's data belongs to its installation unless the user separately shares it.
- Copy-sharing, shared live data, and sharing improvements need distinct product
  language and permission models.
- Restoring a UI/code version, restoring data, and compensating for an external
  action are different operations. Do not promise universal undo.
- The final ambition does not authorize a whole-application rewrite or removal
  of the current assistant. Deliver verifiable increments under a current task.

## Competitive notes

**Cindy** (`github.com/makecindy/cindy`, Apache-2.0, XD Inc.). Read from a local clone on
2026-10-26: source search only, nothing run, so absences below mean "not found", not
"proven absent".

- An Electron and mobile client with a hosted cloud backend (separate repository).
  About 10,000 commits since 2026-07-24 and about 35 packages, so a funded team moving
  quickly. Breadth: Claude Code, Codex, and Pi harnesses, browser/computer/phone
  control, IM bots, schedules, skills, plugins, remote SSH.
- Posture: the agent runs on the user's machine with their files and logged-in apps.
  Its sandbox setting is Codex's own passed through; no container isolation, network
  egress policy, exact-operation approvals, or OpenTelemetry were found.
- Harnesses: a shared `BaseAgent` interface with declared capabilities and
  `NotSupportedError`, over each harness's native path (Claude Agent SDK, Codex
  app-server, a Pi manager). A session has one fixed harness. "Switching" is a
  cross-agent converter for project configuration (`CLAUDE.md` and `AGENTS.md`,
  subagent definitions, hooks, MCP config); skills are reused through shared links
  rather than converted. No live conversation transfer between harnesses was found.

Implications (corrected 2026-10-26 after the owner restated the product):

- The product remains the blank-slate personal assistant that works with any
  harness, with dynamic UI and integrations as part of its design, in the spirit of
  Meta's Muse (`ai.meta.com/muse`) as a personal agent that connects to anything.
  What sets it apart is being owned, self-hosted, open to any harness and model, and
  made with taste. Contained, governed execution in the style of `bob-workspace` is a
  later layer, not the lead.
- Multi-harness use goes through `camenae-sdk` as the single entry point (its
  `AGENTS.md` sets the unified layer as the end goal, extracted once two harnesses
  work). The application renders a harness-neutral message contract over it; see
  [the layout proposal](CONVERSATIONAL-PLUGINS.md#workspace-layout-across-harnesses-proposal).
- Worth designing, not copying: **common skills** shared across harnesses, and
  **instruction and MCP conversion** between harness formats from one
  application-owned source. Cindy's code is Apache-2.0 and may be studied; designs here
  are re-derived against this product's trust model.
- Conversation handover on a harness switch (summary, transcript, or native fork where
  supported) is unclaimed by what was found and is an application feature to design.

## Value and viability hypotheses

The proposed advantage is software people keep using and safely modifying,
without becoming its developer. Initial generation, persistence, and remixing
alone are not distinctive enough to assume a business advantage.

The October investigation found overlapping capabilities in first-party
documentation for [Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them),
[Replit](https://docs.replit.com/features/data-and-storage/development-and-production),
and [Base44](https://docs.base44.com/api-reference/remix-an-app.md). These are dated
research references, not current comparative benchmarks. Recheck them before
using feature availability or pricing in a commercial decision.

Retained use, recipient adoption, willingness to pay, and support cost are
unproven. Potential paid value includes managed connections, backup/recovery,
synchronization, and dependable background work. Open source and hosted service
are distribution/business choices, not substitutes for evidence of usefulness.

## Design references

- [json-render](https://github.com/vercel-labs/json-render) provides a candidate
  approach to catalog-constrained UI, not the whole plugin lifecycle.
- [Jev composition](https://json-render.dev/docs/jev) is a model-composition
  reference. Verify the exact package API and release before implementation.
- [100-themes](https://github.com/bjarneo/100-themes) illustrates portable palettes,
  assets, and appearance variants.
- [OpenCode themes](https://opencode.ai/v2/docs/cli/theme) illustrates semantic
  tokens consumed consistently by components.
- Local interactive mockups live under `docs/design/camenae-ui`. Follow
  [repository guidance](../AGENTS.md#ui-design-references) when inspecting them.
  They are references, not proof that a feature works.
