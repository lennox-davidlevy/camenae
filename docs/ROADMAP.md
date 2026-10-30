# Proposed roadmap

Planning baseline: October 2026 discussion, recorded on 2026-10-24. This is a
recommended sequence, not implementation authorization, a delivery deadline, or
proof of commercial viability. See [current status](CURRENT-STATUS.md) before
starting and [product direction](PRODUCT.md) for the full end-state ambition.

## Revised sequence (review, 2026-10-30)

A full source and documentation review on 2026-10-30 (recorded in
[current status](CURRENT-STATUS.md#review-2026-10-30)) found the codebase sound and the
direction right, and recommended this order for the next horizon. It follows the owner's
2026-10-26 decisions (build to the owner's taste; json-render; a `camenae` command; full
entry control with approvals) and the four properties in
[what makes Camenae strong](PRODUCT.md#what-makes-camenae-strong-review-2026-10-30). Each
numbered item is its own task and needs its own go-ahead; nothing here is started. The
phase table further down is the longer platform sequence and is unchanged.

**Now: an app shaped by conversation, safely.**

1. **Apps step 2, kept minimal.** Versions, one draft per app, a preview beside the live
   app, activate (refused when stale), discard. History and going back move after step 3.
   Reason: whether a real model can author a definition is the largest unknown left, and
   step 3 is where it is met; the fewer things built before that answer, the better.
2. **Apps step 3, hardened from day one.** The broker, the `camenae` command, approvals
   and grants, with the hardening the slice document deferred brought forward: a durable
   action log (who acted, which operation and parameters, outcome, time) that also feeds
   undo for recent deletes; grants bounded by count and expiry as well as app and kind; a
   per-call limit on how many entries one delete may remove. The assistant then creates
   the backlog on the installed stack. Details in the
   [slice's review notes](FIRST-TOOL-SLICE.md#review-notes-2026-10-30).
3. **Apps step 4.** The synthetic acceptance run, then one live run with Claude Haiku 5.5
   under a small approved spend.
4. **Consolidation before more routes.** No behavior change, covered by the existing
   suites: one `Harness` schema instead of six `z.enum(["opencode"])` sites; one module
   for the route guards every write repeats (cookie name, session, exact Origin, JSON
   content type, CSRF); `src/chat.ts` split into connection lifetime and turn execution;
   static asset routes out of the chat routes; the event stream sending a snapshot only
   when it changed. The broker in item 2 is the first consumer of the shared guards, so
   this can also be done as its first step.

**Next: make it something used every day.**

5. **Daily-use polish.** Thread deletion and renaming; the 50-turn cap per conversation
   either raised with paging or surfaced before it bites; conversation search; a run
   detail view and a files-style Skills editor (see
   [reference projects](REFERENCE-PROJECTS.md#for-this-application)); a phone-width pass
   for apps.
6. **Backup and restore as a command.** A documented, tested path that saves the
   database, the workspace, the skills and the native state together with guidance for
   the credentials file, and restores them on a disposable stack. This underpins "data
   survives every change" and comes before any feature that creates more data to lose.
7. **A validated remote-access path.** HTTPS behind a reverse proxy (the Secure
   `__Host-` cookie path exists in code but is unvalidated), so the apps are reachable
   from a phone. "Mobile" counts only once this exists.
8. **Apps step 2, the rest.** Version history, going back, removing a field without
   losing its values, type changes where every value converts.
9. **Second harness through the SDK.** When `camenae-sdk` has a second package: the
   harness-neutral message contract rendered once in the UI, common skills exposed to
   each harness in its native form, conversation handover designed as an application
   feature. Not before the SDK side exists.

**Later (the end state, unchanged):** sharing by export and import, theme packages,
custom code containment, schedules and the activity view, the Calendar acceptance case,
toolchains and previews, the Context7 and Playwright bundle, and any demand or
commercial test.

Rules that hold across the sequence: every step ends usable and tested; one dependency
decision at a time; a feature that would weaken one of the four properties waits rather
than shipping weaker; json-render stays while the spec vocabulary is expected to grow
(visibility, repeats, state), and that expectation is reviewed after step 3.

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

Deferred. The owner decided on 2026-10-26 to build to their own taste, so nothing in
this section gates current work; it is kept for a later commercial decision.

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

## Project isolation, toolchains, and previews (proposed port)

Status: recorded 2026-10-25 as a wish and a proposed order, not an approved plan.
Deferred on 2026-10-26: this comes after the personal assistant; borrow from
`bob-workspace` where it helps rather than porting it.
Nothing here is implemented. The earlier `bob-workspace` project (outside this
repository, `/home/david/Projects/github/bob-workspace`) has working designs and code
for these; `docs/OPENSHIFT_CODE.md` there maps them. Camenae today has one worker for
one owner, no Docker socket in the app or worker, shared workspace folders that are
conventions rather than sandboxes, and no toolchains beyond Node and Bun.

Proposed order, each step needing its own scoped task and authorization:

1. **Decide the provisioner model.** One worker per project created by a small
   privileged provisioner, versus one worker with per-project workspace subtrees.
   This is a security-boundary decision and it gates the rest. It must reconcile with
   the rule that a worker accepts one application owner and Docker retires the whole
   worker before reuse.
2. **Per-project egress allowlist.** Extend the existing egress service; project hosts
   visible and removable by the owner.
3. **Language toolchains.** An approved catalog (official images pinned by digest,
   mounted read-only), requested by the agent and approved by the owner, with package
   hosts allowed alongside. The Docker-only image mounts would need a replacement for
   other platforms.
4. **Rendered previews.** Isolated preview containers behind a gateway with a strict
   CSP, no registry access, and sharing as a separate decision. Depends on 1 and 2 and
   overlaps the custom-code containment experiment in Phase 1.

Application work belongs here; changes to a harness integration, such as a toolchain
tool exposed through the SDK, belong in `camenae-sdk`. Re-derive each design against
current requirements rather than copying `bob-workspace` code wholesale.

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
