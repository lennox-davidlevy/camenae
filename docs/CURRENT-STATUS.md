# Current status and session pickup

Last source/document inspection: **2026-11-06** (status review: local checks rerun in
both repositories, the installed stack's state read without changes, SDK source compared
with the adopted archive; see [the review](#review-2026-11-06)). The last full source read
is [the 2026-10-30 review](#review-2026-10-30). This page records capability status, not a
fresh deployment or user-acceptance certificate.

## Read this first

Camenae currently implements a single-user assistant, not the intended
conversational plugin platform. The blank-slate vision and proposed architecture
are now documented in source so a new session does not depend on temporary files.

Reading order:

1. [Repository guidance](../AGENTS.md) for safety, ownership, and authorization.
2. This page for current capability and evidence status.
3. [Product direction](PRODUCT.md) for the intended end state and decision status.
4. [Current architecture](ARCHITECTURE.md) for the existing application.
5. [Target plugin architecture](CONVERSATIONAL-PLUGINS.md) for proposed boundaries.
6. [Roadmap](ROADMAP.md) for phases, gates, deferred work, and open decisions.
7. [Development](DEVELOPMENT.md) and [operations](OPERATIONS.md) for checks and
   installation-specific work. Read [OpenCode](OPENCODE.md) when that path matters.

No temporary plan, private transcript, provider account, or particular assistant
skill is required to understand these documents. Current user instructions still
determine what work is authorized.

## Implemented source baseline

| Capability | Source and scope |
| --- | --- |
| Local owner account, sessions, encrypted credentials | `src/identity.ts`, auth routes, and installation migrations. No general registration, SSO, or multi-user isolation. |
| Persistent conversations, streaming, tool activity, cancellation, native session reuse | `src/chat.ts`, chat routes/contracts, and runtime adapters. One active turn across tabs. |
| OpenCode integration (the only harness) | `src/opencode-runtime.ts`, worker/plugin files, and exact packaged `@camenae/opencode`. Docker retires the whole worker. Live-provider use is not validated. |
| Console model selection and request allowance | `src/console-gateway.ts`, `src/console-contract.ts`, settings, and migrations 009/010. Fixed allowlist of free models plus one paid model (Claude Haiku 5.5, admitted only while a request cap is set, through the gateway's Anthropic route; tested with a synthetic provider and used live on the installed stack on 2026-10-26), persistent cap, no fallback. Provider availability/pricing is not guaranteed. |
| One-time native approvals | Approval cards in Chat for requests the harness makes. No persistent approval preferences, connector gates, or Context7/Playwright bundle yet. |
| Workspace files, uploads, and attachment paths | `src/files.ts`, `src/workspace-files.ts`, `src/file-contract.ts`, and chat path persistence. Shared workspace, not per-conversation isolation. |
| Conversation sidebar and adjustable panels | `src/app/threads.tsx`, `src/app/panel-sizes.ts`, and migration 011. Native headline display, activity metadata, collapsible groups, remembered widths. |
| SolidJS application (the chat UI) | `src/app`, built by `bun run build:app` into the image and served at `/chat` behind the session check (`src/chat-routes.ts`); `scripts/dev-app.ts` is the fast no-Docker loop. Source and local browser checks only: masthead, thread list, resizable panels, and a chat view (streaming, sanitized Markdown, tool activity, approvals, drafts, stop, new chat, per-conversation model picker, usage panel), and Settings (provider key, request cap, refresh, request-limit notice) against synthetic data, and once against an isolated OpenCode stack with a synthetic provider (new chat, streaming, approval, cancel, failure, reload). Served by the application and built into the Docker image since the React UI was retired; sign-in, a first turn, and the shell were checked in a browser on a disposable stack with a synthetic provider. Deployed to the installed stack on 2026-10-25 and in daily use by the owner since (live chats with Claude Haiku 5.5 on 2026-10-26); not yet formally accepted. An empty conversation shows a welcome screen (banner, headline, quote), Skills is a real library (see the next row), not the earlier example preview. |
| Skills library | `src/skills-*.ts`, `src/app/skills*.ts(x)`. Skills are `SKILL.md` folders in a dedicated application-owned `skills` volume (`/data/skills`, outside the workspace): `active/` is exposed read-only to the OpenCode worker through its `skills` configuration entry, `disabled/` is not. The Skills screen lists, creates (starting switched off), edits, switches on/off, and deletes them; routes are authenticated, Origin- and CSRF-guarded, and bounded. Verified in `smoke:foundation` on a disposable stack (guards, validation, and that OpenCode lists an active skill and not a disabled one after `reload()`) and in a browser against the dev fixture. **Deployed to the installed stack 2026-10-28, not yet tried by the owner:** a change reaches the assistant on its next turn without a restart; Chat reloads the harness just before that turn, never during one (`smoke:opencode` checks a skill enabled between two turns of one conversation). Whether a model chooses to use a skill was not checked. No import, sharing, or other harness yet. Deployed to the installed stack and tried by the owner on 2026-10-26. Since 2026-11-06 a skill opens in the full-column editor shared with Files (see [the delivery note](#delivery-2026-11-06)). |
| Apps (first slice, step 1) | `src/apps-*.ts`, `src/app/app-view.tsx`, `src/app/catalog/`, migration 014. Hand-written definitions drawn by `@json-render/solid` 0.21.3 from an application-owned catalog (page, section, columns, table with filters, sort, grouping, inline edit, delete and muted rows, add form, count/sum/average tiles). Entries in Postgres, checked against the definition. The backlog pilot is seeded only by the dev fixture and tests; an installation has no apps and no way to create one yet. No versions, drafts, assistant access or approvals. Verified by `test:apps`, `smoke:foundation` on a disposable stack (guards, validation, round trip, entries kept across replacement), and a headless browser against the dev fixture. Not deployed, not tried by the owner. See [step 1](FIRST-TOOL-SLICE.md#step-1-built-in-source-2026-10-28). |
| Quotes dataset pipeline | `tools/quotes`, `data/quotes`. 179 curated quotes from 17 authors, each verified against a pinned Project Gutenberg edition. A separate private set of 871 Warhammer 40,000 quotes (from locally saved Lexicanum pages) lives in gitignored `data/private/`. The sign-in page and `GET /api/quote` (session required) serve a random quote with a link to its source: `src/quotes.ts`, `src/quotes-service.ts`, `src/quote-routes.ts`. The image holds only the public set; the private set is an optional read-only mount (`compose.private-quotes.yaml`). The Solid welcome screen uses the same route. Verified on an isolated stack only, not yet on the installed deployment. |
| Fixed visual styling | `src/ui/theme.css` contains CSS tokens (`src/ui` now holds only shared CSS, fonts, and artwork). No user-authored theme package/import engine or conversation-driven shell editor. |

Attachments are saved as workspace files in `inbox/` when a message is sent (up to
10 files, 15 MiB each, any type) and the turn stores path references; the agent is
told the paths. Files can be previewed and edited as text up to 1 MiB. In the
Solid preview, the Files screen (browse, edit, upload, new folder, rename/move,
delete), composer attachments, `@` path mentions, and "Ask about this file" were
verified in a browser against synthetic fixtures. The Files screen was also checked against an isolated real stack (upload, clash, 15 MB limit, edit/save, move, delete); sending a message with attachments was not, because no model connection was configured. The
server routes and tests passed on isolated stacks.

## Not implemented

- The “Do anything” blank-slate creation experience and generated home/views.
- A general plugin package registry, installer, update/fork lifecycle, or sharing.
- A backend capability catalog, connector broker, or sandboxed extension runtime.
- General workflow scheduling and an installed-plugin activity/recovery system.
- Assistant-authored or conversation-shaped apps, app versions and drafts, Jev composition, or portable semantic theme packages.
- Pi integration or a newly owned agent harness.
- Shared live plugin data, collaboration, multi-tenant hosting, or a marketplace.

json-render is used only to draw hand-written app definitions. The harness discriminant currently
contains OpenCode only. The trusted OpenCode application plugin is an
integration detail, not the proposed user-installable plugin system. Skill changes that apply live, additional connections, and preview controls must not be described as working
management features.

## Evidence and acceptance

Keep these categories separate:

- **Inspected now:** source files and documentation supporting the capability
  map above. This does not establish runtime readiness or provider behavior.
- **Historically reported:** the October 7 direct-upload delivery reported
  isolated deployment, fresh-source checks, browser checks, and state preservation.
  The October 11 handoff said user acceptance was still pending. These results
  were not rerun for this documentation update.
- **Not established now:** current service health, identity of deployed assets,
  latest user acceptance, live-provider availability, or production suitability.

The temporary product plan and delivery handoff referenced by the earlier session
were absent on October 24. This document reconstructs the relevant status from
the visible conversation and inspected source; it does not claim to have recovered
the original private validation logs. Keep future delivery evidence outside
published source, but update this capability/acceptance summary when it changes.

No acceptance of the latest upload appearance/interaction is recorded in this
conversation. Visual refinement remains open. Backup restoration, broader
deployment, and previously reported dependency findings need their own current
verification; old finding counts are not a present audit.

## Worktree and continuity

The test-image reuse and cleanup work (stable `camenae-test-*` tags, cleanup script,
`test:images`) was committed as `44c905e`. The product, status, and roadmap
documents followed in `468d067`. Both are source checkpoints, not an assertion
that any deployment matches them, and neither was pushed by this task. Test-image
checks resolve Compose stacks only; the smoke suites were not rerun for them.

Run `git status --short` and inspect the relevant diff at pickup. Do not assume
older conversation claims that all work is uncommitted still describe the tree.
Do not reset, clean, commit, or push to make a handoff look tidy.

For a runtime task, establish which installation the user means before touching
services. The earlier conversation distinguished the normal installation from a
retained isolated delivery. Do not infer the active target from an old port or
Compose project name. Do not reprovision or send model requests to check readiness.

## Review 2026-10-30

A full read of the source, tests, scripts, Docker files and documentation, with the
local checks run on this worktree (no Docker suite, no deployment, no inference).

| Check | Result |
| --- | --- |
| `bun run lint` | Passed, no warnings |
| `bun run typecheck` | Passed |
| `bun run check:docs` | Passed (87 local links in 19 files, before this review's edits; rerun after them) |
| `bun run build:app` | Passed |
| `bun run test:apps`, `test:threads`, `test:provisioning`, `test:quotes`, `test:dev-ui`, `test:images` | Passed. `test:dev-ui` exits 0 but prints a Vite "Failed to run dependency scan" stack trace after its own pass line, because the test kills the dev server while Vite's background scan is still running; cosmetic, not a failure. |
| `smoke:foundation`, `smoke:opencode`, `smoke:console` | Not run in this review |

**Verdict.** The codebase is well built for its size: ownership is clear per file,
every contract is a zod schema, every write is bounded and guarded, secrets never reach
logs or responses, and the tests exercise real stacks rather than mocks. The documents
describe what exists with unusual honesty. The direction is right; the review sharpened
it in [product direction](PRODUCT.md#what-makes-camenae-strong-review-2026-10-30) and
reordered the near term in the [roadmap](ROADMAP.md#revised-sequence-review-2026-10-30).

**Structure findings, for the consolidation step (no behavior change):**

- The harness name is restated as `z.enum(["opencode"])` in six places
  (`src/chat.ts`, `src/chat-contract.ts`, `src/chat-routes.ts`, `src/bootstrap-contract.ts`)
  and `readiness: { opencode: boolean }` in two; a second harness means editing all of
  them. One `Harness` schema in a contract file is the fix.
- The route guards (cookie name, session lookup, exact Origin, JSON content type, CSRF)
  are copied across `src/files.ts`, `src/skills-routes.ts`, `src/apps-routes.ts` and
  `src/chat-routes.ts`, and the cookie-name expression appears six times. The broker
  will be a fifth copy unless a shared module comes first.
- `src/chat.ts` (583 lines) holds connection lifetime, the authority loop, turn
  execution, persistence and titles. Coherent, but it should split before grants and
  the broker add to it.
- Static assets (fonts, artwork, the built UI) are served from `src/chat-routes.ts` and
  read with paths relative to the working directory.
- The event stream re-sends the full snapshot every 250 ms whether or not it changed,
  each delivery re-checking the session with a row lock. Fine for one user; sending only
  on change is a small fix.
- Three error styles for one idea: `FileProblem`/`SkillProblem` as plain errors wrapped
  into tagged errors, `AppProblem` as a tagged error directly. Apps is the model to keep.

**Text corrected in this review (source, not deployed):** the attachment error in
`src/chat-routes.ts` still described the retired four-file, 64 KiB limit; the Skills
screen said changes apply "after the next restart" although they apply on the next turn;
two comments referred to the React UI; README called Skills a preview and omitted the
paid model and apps; the development guide and the examples README described the retired
composer. The installed stack still shows the old strings until the app is rebuilt.

**Open reliability items unchanged by this review:** the unexplained first-start exit
in 2 of 4 Docker suite runs (the app logs no cause by design; a fixed, cause-classified
stage in the failure event would help without leaking anything), and the 50-turn cap
per conversation, now recorded in [architecture](ARCHITECTURE.md#conversations-and-worker-lifetime).

## Review 2026-11-06

A status review one week after the full review: the local checks rerun on this worktree
and on `camenae-sdk`, the installed stack inspected read-only, upstream versions checked.
No Docker suite, no deployment, no inference, nothing started or stopped.

| Check | Result |
| --- | --- |
| This repository: `lint`, `typecheck`, `check:docs` (102 links in 19 files), `build:app`, `test:apps`, `test:threads`, `test:provisioning`, `test:quotes`, `test:dev-ui`, `test:images` | All passed on `fff6b81` with a clean worktree. `test:dev-ui` still prints the Vite dependency-scan trace after its own pass line (exit 0), as noted on 2026-10-30. |
| `smoke:foundation`, `smoke:opencode`, `smoke:console` | Not run |
| `camenae-sdk` at `a9c2470`: `lint`, `typecheck`, `test` (Bun: two files, three tests, native lifecycle with the synthetic endpoint) | Passed. `test:node` and `build` not run. |

**The installed stack is stopped, and has been since 2026-10-31.** The host shut down
on 2026-10-31 at 23:41 and rebooted on 2026-11-01, 2026-11-02 and 2026-11-06. Project
`camenae`'s app, ingress, postgres and egress containers exited at the shutdown (exit 0;
egress 137 after its grace period) and never came back, because `compose.yaml` gives a
restart policy (`unless-stopped`) to the worker only. The worker alone restarted at each
boot and is healthy with no application owner. The four volumes (`camenae_postgres-data`,
`camenae_workspace`, `camenae_skills`, `camenae_opencode-state`), `.env` and the
credentials file are untouched. So the owner has had no Camenae for a week, and the
stack will not survive the next reboot either. Two consequences, both for the owner:

- Bringing it back is `docker compose up -d` (the 2026-10-28 images; `--build` would also
  pick up the text corrections of 2026-10-30, which are a redeploy decision), then the
  readiness check and a sign-in. Not done by this review: an inspection task does not
  authorize changes to the running installation.
- A restart policy for the other four services is a one-line deployment-policy change,
  now the first item of the [revised sequence](ROADMAP.md#revised-sequence-review-2026-10-30).
  Whether the app should restart on its own exit as well, given the unexplained
  first-start exit below, is the owner's call; `unless-stopped` after a reboot is the
  minimum. A policy change takes effect only when the services are recreated.

**SDK state.** `camenae-sdk` is clean at `a9c2470` ("review and respec for deployment",
2026-10-30), one commit past `92f2770`, the source of the adopted archive
`0.2.0-b2c0d67d6050`. That commit changes manifests and documents only: the unused
`@opencode/sdk` dependency is removed from the package, root `@types/node` moves to 24,
the lockfile follows, and `docs/roadmap.md` is new. No runtime code changed, so the
adopted archive remains current; the next archive's manifest will differ. The SDK roadmap
now defines milestone 1 (0.3.x: typed `tool.*`, `approval.*` and `turn.*` events, run
failures with a closed category, a capability object, `messages()`, `serve` returning its
address, named conformance scenarios) and recommends Claude Code via the Claude Agent SDK
as the second harness, pending a fixture proof. Three decisions there are the owner's and
were not visible from this repository until now (recorded in the
[product decision table](PRODUCT.md#decision-status)): attach `cause` to `OpenCodeError`,
confirm the second harness, name the unified package. Milestone 1 lands here as an
adoption step in `src/execution-client.ts`, which today pairs raw `session.tool.*` and
`permission.*` events itself; see the roadmap's item 9.

**Upstream versions, checked 2026-11-06, no action taken.** OpenCode publishes 2.2.5; the
SDK pins 2.0.23, and moving is the SDK's decision (its roadmap's gap 7 concerns the
version check). json-render published 0.21.4 (2026-11-01, documentation) and 0.22.0
(2026-11-04, a Chat SDK renderer); neither mentions the Solid repeat-filter bug, so
0.21.3 stays pinned.

**Structure findings of 2026-10-30, re-verified:** six `z.enum(["opencode"])` sites, the
cookie-name expression in six files (`apps-routes`, `files`, `auth-routes`,
`skills-routes`, `chat-routes`, `quote-routes`), the 250 ms schedule in three places,
`src/chat.ts` at 583 lines. Nothing was consolidated.

**Plan review.** The direction, the four properties and the revised sequence hold. Two
things were missing and are now recorded: the reboot gap above, and the SDK milestone-1
adoption step. The sequence still awaits the owner's confirmation.

## Delivery 2026-11-06

Authorized by the owner the same day, after [the review](#review-2026-11-06).

- **Decisions recorded** in the [product decision table](PRODUCT.md#decision-status):
  the revised sequence is confirmed; every service restarts (`unless-stopped`); on the
  SDK, `cause` is attached to typed errors, the unified package is `@camenae/sdk`, and
  the second harness is Claude Code only if a Claude subscription sign-in can drive it,
  otherwise Pi. The SDK items are for an SDK session; nothing in `camenae-sdk` changed.
- **Installed stack brought back** with `docker compose up -d` (no initialization, same
  volumes), after `compose.yaml` gained the restart policy. Loopback port 3000 was held by
  another project's container that had come up after the reboot, so `.env` now sets
  `CAMENAE_HTTP_PORT=3100` and `CAMENAE_ORIGIN=http://127.0.0.1:3100`; the owner's
  address is **http://127.0.0.1:3100/chat**. Readiness passed; sign-in was not exercised
  by this session (the owner's password is theirs).
- **Files and Skills editors.** A walkthrough on the dev fixture at desktop and phone
  width found the chat, files and skills pages sound, and the editing weak: a small
  text box in the right rail. New `src/app/editor.tsx` and `src/ui/editor.css`: opening
  a file or a skill replaces the page with a header (breadcrumb, name, state or path,
  actions) and an editor that takes the rest of the column; Markdown has a rendered view
  (sanitized like chat, front matter shown as a block); Ctrl+S or Cmd+S saves; the line
  and byte count and an "unsaved" mark sit above the text; leaving a file, a skill or the
  page with an unsaved edit asks first. The rail lists the neighbours (files in the same
  folder, or the whole skill library) for one-click switching. On a phone the thread
  list is hidden on every screen but Chat. Checked in a headless browser against the dev
  fixture (open, edit, Ctrl+S, rendered view, the discard prompt, phone width). Not yet
  checked against a real stack or by the owner. Still open from the files-view lead:
  tree with search, per-turn changes, and a warning when the file changed underneath.
- **Checks:** lint, typecheck, `check:docs`, `build:app`, `test:apps`, `test:threads`,
  `test:provisioning`, `test:dev-ui` passed after the change. The Docker suites were not
  run (no route or contract changed; `tests/skills.ts` and `tests/files.ts` exercise
  routes, not the UI).
- **Deployed to the installed stack 2026-11-06, not yet accepted:** a private `pg_dump`
  outside the repository, then `docker compose build app opencode-worker`, both stopped and
  recreated together (no migration in this change), readiness 200 on port 3100, and the
  served build confirmed to carry the editor styles. No activity had reached the app since
  it came back, so nothing was interrupted. The owner has not yet opened it.

## Recommended next action

**Advice, not authorization.** The owner confirmed the
[revised sequence](ROADMAP.md#revised-sequence-review-2026-10-30) on 2026-11-06: its first
item is a minimal apps step 2, its second the broker with hardening built in. Each step
still needs its own go-ahead when it starts. The two strands
recorded on 2026-10-28 remain:

1. **SDK:** archive `0.2.0-b2c0d67d6050` (typed stream and `reload()`) is adopted in
   source and deployed to the installed stack (2026-10-28; see follow-ups). SDK source
   has since moved one commit (manifests and documents only; see the review). Still open
   for an SDK session: milestone 1 of the SDK's `docs/roadmap.md`, which carries the
   harness-neutral message format drawn from
   [reference projects](REFERENCE-PROJECTS.md#for-the-sdk-camenae-sdk), and the three
   owner decisions listed there.
2. **This repository:** step 1 of the [first app slice](FIRST-TOOL-SLICE.md#step-1-built-in-source-2026-10-28)
   is built and deployed to the installed stack (2026-10-28) and awaits the owner's look; the installed stack has no apps until one is seeded or created.
   Step 2 (versions, draft preview, activation, history) needs its own go-ahead. The
   quality-of-life items in [reference projects](REFERENCE-PROJECTS.md#for-this-application)
   are also open.

Ask the owner which to start. A game backlog is the
pilot; it does not replace the recorded Calendar two-installation acceptance case.

Before changing code, state the intended observable outcome, test scope, and
deployment authorization. Do not begin the entire roadmap merely because this
page describes it.

## Pending pickup (UI migration)

The React UI is retired: `/chat` serves the Solid build, and `src/ui/*.tsx`, the React
dev server, `tests/thread-list.tsx`, and the react/assistant-ui dependencies are gone.
The installed stack was rebuilt on 2026-10-25 under project `camenae` with new volumes
(fresh account; workspace files copied from the retired `bob-camenae_workspace`). It
serves the Solid UI at `/chat` and was redeployed on 2026-10-26 with skills and the
Haiku route. The owner has signed in, saved a provider key and request cap, and
chatted; the old `bob-camenae_*` volumes are untouched.

## Follow-ups noted 2026-10-26

- Next build: [first slice of an app shaped by conversation](FIRST-TOOL-SLICE.md). Owner
  decisions recorded 2026-10-26 (json-render, a `camenae` command, full entry control with
  approvals). Step 1 is built in source (2026-10-28); a test that draws json-render in a DOM
  (the filtered-row case) needs a DOM library the owner has not approved.

- **Deployed to the installed stack 2026-10-28, not yet accepted:** SDK archive `0.2.0-b2c0d67d6050` replaces
  `0.1.0-b24e73923802` (it also carries SDK commit `7f8242b`: `OpenCodeError` with a `code`,
  isolated throwing subscribers, refused new sessions removed). The chat now shows the
  model's reasoning in a collapsed "Thinking" box apart from the answer, and a notice while
  the provider has asked OpenCode to wait and retry (reason, status, time, attempt; never the
  provider's message). Skill changes apply on the next turn (see the Skills row). Migration
  015 adds the turn columns. `smoke:opencode` checks reasoning, a 429 retry whose body holds
  a fake secret, and the skill reload with the local fixture; the UI was checked in a browser
  against the dev fixture only. No real inference. The app's own code never branched on SDK
  error messages, so the new error type needed no change.
- **Fixed and deployed to the installed stack 2026-10-28:** the Console gateway made every refusal look
  retryable, so OpenCode retried and spent more of the allowance. `src/console-gateway.ts` now
  passes 429 through with a numeric `Retry-After` only. Other upstream 4xx (except 408/409)
  keep their status with a fixed body and `x-should-retry: false`. Its own refusals
  (credential, endpoint, policy, missing key or used-up allowance) also send
  `x-should-retry: false`. 5xx, 408, 409 and transport failures stay retryable as 502.
  Upstream bodies and headers are never forwarded. `smoke:console` checks each case and that
  a native turn refused upstream makes exactly one request. It was not checked that the old
  code fails that last check.
- **Installed-stack deploy 2026-10-28:** app and worker rebuilt and replaced together under
  project `camenae` after a private `pg_dump` (outside the repository). Migrations 014 and 015
  applied; conversations, turns, account, provider-key row, skills and workspace files were
  present afterwards and readiness passed. The owner then saw the Thinking box in a live
  chat with Big Pickle (2026-10-28); retry notices and the skill reload are not yet seen live.
- **Unexplained, seen 2026-10-28:** in 2 of 4 runs of the Docker suites
  (`smoke:foundation`, `smoke:opencode`), the app container exited with status 1 on its
  first start, then passed on rerun. Eleven separate cold starts on disposable stacks did not
  reproduce it. The app deliberately logs no failure cause, so the reason is unknown, and it
  is not known whether it predates migration 014.
- **SDK findings (2026-10-28).** The SDK's `docs/design.md` has a candidate message
  contract, not yet built. The typed stream and `reload()` are adopted (above).
  - The `</think>` cause is upstream: big-pickle sometimes returns reasoning inline, and
    OpenCode stores and replays it as plain text, so one bad turn persists. OpenCode
    replays `reasoning_content` correctly. A possible fix is
    `compatibility: { requireReasoning: true }` in `console-free.json`, untested.
  Each SDK change arrives as a new archive through the packaging path in AGENTS.md.
- Borrow quality-of-life details from `bob-workspace`: easy thread deletion, richer
  detail views, and similar polish. File pointers in [reference projects](REFERENCE-PROJECTS.md).
- The Skills text-box editor was replaced on 2026-11-06 by the full-column editor (see
  [the delivery note](#delivery-2026-11-06)); the `bob-workspace` tree, search, changes
  view and stale-edit warning remain open leads.
- [Reference projects](REFERENCE-PROJECTS.md) (wshobson/agents, cc-switch, bob-workspace)
  read 2026-10-26: a harness-neutral message format, capability table and request fixes
  for the SDK; a conversation reading view, thread deletion and a files view here.
- Claude Haiku 5.5 works live on the installed stack (first real chats 2026-10-26).

## Updating this record

When capabilities or decisions change, update this page and the owning guide.
Record whether evidence is source inspection, isolated execution, selected
deployment verification, or user acceptance. Update the inspection date only
with the scope actually checked. Preserve unresolved work rather than silently
marking it complete.
