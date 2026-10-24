# Proposed roadmap

Planning baseline: October 2026 discussion, recorded on 2026-10-24. This is a
recommended sequence, not implementation authorization, a delivery deadline, or
proof of commercial viability. See [current status](CURRENT-STATUS.md) before
starting and [product direction](PRODUCT.md) for the full end-state ambition.

## Delivery strategy

Prove that a useful tool survives repeated modifications before expanding the
platform. Use catalogs for common cases, preserve a separately contained path
for new code, and keep installed execution independent of the authoring session.
Retain the current assistant while delivering bounded, explicitly authorized
increments. Do not replace native SDK responsibilities with application workarounds.

The proposed first audience is people already maintaining awkward personal tools
in spreadsheets or notes. A game backlog/play-next tool is a candidate pilot,
not a confirmed market. A manual meal tracker can exercise records and totals
without assuming reliable automated nutrition data. Calendar remains the
recorded integration and approved-write acceptance case.

## Phases and exit gates

| Phase | Deliverable | Gate before expanding |
| --- | --- | --- |
| 0. Validate the recurring job | Real user tasks, current alternatives, a bounded product contract, and a held-out set of modification requests. | Users identify recurring needs and a concrete reason to prefer this experience. Enthusiasm for generation demos alone is insufficient. |
| 1. Prove durable editing | One persistent catalog-based tool, semantic styling, draft/active versions, stable record/field identities, export, backup/restore. Separate synthetic custom-code containment experiment. | Repeated edits, restarts, interrupted activation, and schema changes preserve required data/behavior. Non-AI operations work without the authoring provider. Isolation failures block custom-code release. |
| 2. Prove everyday usefulness | A complete pilot tool, mobile/browser accessibility, element-targeted chat editing, direct controls, and a second structurally different tool using the same catalog. | Users perform the task and modifications without developer rescue. Measure catalog reuse and full-workflow costs. Compare Jev with simpler alternatives rather than assuming a benefit. |
| 3. Prove recipient independence | Versioned export/import between two installations, synthetic previews, explicit grants, separate data/connections, customization and optional updates. | An unfamiliar recipient installs, uses, changes, and removes a copy without the author's secrets or developer intervention. Original installation and recipient theme remain intact. |
| 4. Prove external effects | Read-only Calendar agenda, conversational visual revision, explicitly approved rescheduling, sharing, durable runs, pause/cancel, and reconciliation. | Preview cannot mutate real services. Approval binds to actual operations/parameters. Lost responses do not cause blind duplicate writes. Recovery limitations are visible. |
| 5. Prove retained use and economics | A bounded pilot measuring actual task use, recipient adoption, complete costs, repair time, and payment decisions. | Retained value and supportable economics justify broader delivery. Count dropouts, failed attempts, and manual assistance. |
| 6. Expand where evidence supports it | More capabilities, shared live data, custom code, or managed distribution, one boundary at a time. | Each addition has a verified need, authority model, recovery story, and sustainable operating cost. |

Demand discovery and technical risk experiments can proceed independently.
Read-only user pilots do not need all external-write capabilities. Advertising
scheduled external automation does require the corresponding phase 4 proof.
Every phase needs its own scoped task and authorization; no phase is complete
merely because its design is documented.

## First bounded engineering proof

Use disposable state and synthetic inputs, not the user's installation:

1. Define a small tool's records, view, theme bindings, actions, version, and local
   installation state. Include known data with literal expected outcomes.
2. Exercise creation and repeated visual/behavior changes through one existing
   harness. Keep the active version while building the draft.
3. Demonstrate that visual edits do not alter stored records or unrelated actions.
4. Exercise an additive schema change, a stale concurrent edit, an interrupted
   activation, and recovery without deleting newer legitimate records.
5. Restart and disconnect the authoring provider. Verify ordinary tool operation,
   export, and recovery still work.
6. Attempt denied operations with a separate synthetic extension. Contain build
   steps, runtime storage/network access, and browser communication. Do not infer
   sandbox safety from a passing UI or typecheck.

An initial sequence of 20 specified edits is a proposed coverage exercise, not
a reliability benchmark or sufficient security proof. Exact cases, budgets, and
pass/fail criteria must be fixed before execution. No paid inference is authorized
by this plan.

## UI framework note

The October 24 spike used synthetic data in an isolated directory and is not in
this repository. It ran under jsdom and then in a real Chromium page through Vite.
Both agreed: a repeat container's `$item` filter rendered no rows in
`@json-render/solid` 0.21.3, while the same condition on the child row rendered
the matching rows. Catalog validation did not reject a wrong prop type, so add an
application-owned props check. This supports trying SolidJS but does not prove the
rewrite: it used a toy catalog and no user acceptance. Keep the current UI working
until a Solid chat reaches parity.

## Preserved integration acceptance

The earlier plugin discussion specified two separate installations/accounts:
read-only agenda, conversational visual revision, confirmed rescheduling, then
sharing and recipient customization. Retain that acceptance contract. A game
pilot is an earlier demand/architecture experiment, not a silent replacement.

Preview must prohibit real-world mutations with no approval override. Schedules
are disabled in preview. Installing a plugin or enabling a schedule is not
blanket permission for external writes. See [target architecture](CONVERSATIONAL-PLUGINS.md).

## Demand and commercial tests

Proposed discovery size is roughly 8 to 12 people with an existing recurring
workaround. Compare the same task with their current tool and a capable alternative.
Technical users can validate an early local pilot, but cannot establish that
nontechnical users can independently install the current deployment.

A four-week retained-use pilot is a suggested next investment after technical
gates. Example continuation signals are half of activated creators using the
actual tool in week four, several voluntary shares followed by recipient reuse,
and several real payment decisions at a cost-compatible price. These are small
learning gates, not forecasts or statistical proof of product-market fit.

Measure:

- Time to first useful action, including questions, connections, retries, and activation.
- Requested changes completed correctly while preserving prior behavior/data.
- Requests needing new host capabilities versus composition or isolated code.
- Manual repair time and unsuccessful or abandoned authoring attempts.
- Repeated task use, distinct from time spent editing or watching generation.
- Recipient setup success and continued use.
- Authoring/runtime inference, hosting, storage, connector, payment, and support costs.

Track heavy users as well as the median. Count acquisition and fixed engineering
costs separately so contribution is not presented as profit. Do not promise
unlimited inference or background operation before those costs are known.

Stop broad expansion if people return to their previous tools, routine changes
need bespoke developer repair, or recipients cannot use shared tools independently.
A narrow domain product may be better than a general platform. Security failures
and data loss are hard blockers, not errors to average into a good success rate.

## Open decisions and risks

- Prove catalog expressiveness without creating an unnecessarily general language
  inside JSON. Unsupported requests must remain explicit.
- Select and verify custom-code build/runtime/browser isolation. Containers and
  frames alone do not establish the complete boundary.
- Define migration/activation recovery, durable job semantics, and version compatibility.
- Validate provider access, revocation, data-use terms, and operation semantics.
  Steam authentication must not imply access to private game libraries.
- Choose a recipient onboarding/delivery path. Current installation requires
  external SDK archives and developer tooling; it is not consumer onboarding.
- Decide redistribution rights, application licensing, asset rights, and any
  applicable employment/IP constraints before commercialization.
- Separate copy-sharing from shared data, membership, and collaborative editing.
- Compare deterministic rules, generative authoring, and Jev-assisted composition
  on the same complete tasks, including candidate preparation and repairs.

## Deferred until justified

No new harness, Pi implementation, universal harness SDK, or json-render fork
solely for architectural completeness. No marketplace, social feed, automatic
fork merging, creator payments, federation, or multi-tenant hosting merely to
demonstrate copy-sharing. No raw plugin access to host credentials or unrestricted
external operations. No automatic production repair with unbounded authority/cost.

Keep the theme/component catalog small enough to validate thoroughly. Expand it
from demonstrated needs, not as a substitute for retained usefulness. The broad
customizable end state remains the goal; these are sequencing decisions, not a
permanent reduction to templates.
