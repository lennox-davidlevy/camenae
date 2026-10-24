# Current status and session pickup

Last source/document inspection: **2026-10-24**. This page records capability
status, not a fresh deployment or user-acceptance certificate.

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
| Default Bob integration | `src/harness-runtime.ts`, `src/worker.ts`, and exact packaged `@camenae/bob`. Docker retires the whole one-connection worker. |
| Experimental OpenCode integration | `src/opencode-runtime.ts`, worker/plugin files, and exact packaged `@camenae/opencode`. Separate native lifecycle, configured new-chat selection. |
| Optional Console model selection and request allowance | `src/console-gateway.ts`, `src/console-contract.ts`, settings, and migrations 009/010. Fixed allowlist, persistent cap, no paid fallback. Provider availability/pricing is not guaranteed. |
| Bob approval preferences and managed Context7 gates | `src/mcp-permissions.ts`, `src/managed-mcp.ts`, approval contracts/settings. Not general plugin authorization. |
| Workspace browsing and text uploads/attachments | `src/files.ts`, `src/file-contract.ts`, `src/ui/attachments.tsx`, and chat snapshot persistence. Shared workspace, not per-conversation isolation. |
| Conversation sidebar and adjustable panels | `src/ui/thread-list.tsx`, `src/ui/panel-sizes.tsx`, and migration 011. Native headline display, activity metadata, collapsible groups, remembered widths. |
| Fixed visual styling | `src/ui/theme.css` contains CSS tokens. No user-authored theme package/import engine or conversation-driven shell editor. |

Chat attachments support four text files and 64 KiB total per message, with a
64 KiB per-file upload/preview limit. Local uploads automatically attach and use
conversation-organized inbox paths with collision-safe names. Pending/failed
uploads block sending; failures offer Retry/Remove. Existing files stay in place.
Removing a selection does not delete its file. The server persists immutable
path/content snapshots at send time. Unsent selections are page-memory drafts.
PDF/image attachments, drag-and-drop, and attachment-only messages are unsupported.

## Not implemented

- The “Do anything” blank-slate creation experience and generated home/views.
- A general plugin package registry, installer, update/fork lifecycle, or sharing.
- A backend capability catalog, connector broker, or sandboxed extension runtime.
- General workflow scheduling and an installed-plugin activity/recovery system.
- json-render integration, Jev composition, or portable semantic theme packages.
- Pi integration or a newly owned agent harness.
- Shared live plugin data, collaboration, multi-tenant hosting, or a marketplace.

`package.json` has no json-render dependency. The harness discriminant currently
contains Bob and OpenCode only. The trusted OpenCode application plugin is an
integration detail, not the proposed user-installable plugin system. Skills,
additional connections, and Pi preview controls must not be described as working
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

The latest inspected commit was `430d8e4`, dated October 7. That is a source
checkpoint, not an assertion that the worktree or a deployment matches it.
At inspection, existing uncommitted changes affected development instructions,
package scripts, smoke runners, and test Compose image handling. Additional
test-image cleanup/verification files were untracked. Preserve and inspect this
work before editing those areas; it was not implemented or accepted by this docs task.

Run `git status --short` and inspect the relevant diff at pickup. Do not assume
older conversation claims that all work is uncommitted still describe the tree.
Do not reset, clean, commit, or push to make a handoff look tidy.

For a runtime task, establish which installation the user means before touching
services. The earlier conversation distinguished the normal installation from a
retained isolated delivery. Do not infer the active target from an old port or
Compose project name. Do not reprovision or send model requests to check readiness.

## Recommended next action

**Advice, not authorization:** review the product and proposed roadmap, then select
one bounded next task. The recommended first engineering proof is durable
catalog-based editing with synthetic data and recovery, alongside a separately
bounded isolation experiment. Demand discovery can proceed separately. A game
tracker is a proposed low-risk pilot; it does not replace the recorded Calendar
two-installation acceptance case without a product decision.

Before changing code, state the intended observable outcome, test scope, and
deployment authorization. Do not begin the entire roadmap merely because this
page describes it.

## Updating this record

When capabilities or decisions change, update this page and the owning guide.
Record whether evidence is source inspection, isolated execution, selected
deployment verification, or user acceptance. Update the inspection date only
with the scope actually checked. Preserve unresolved work rather than silently
marking it complete.
