# First slice: an app shaped by conversation

Status: design proposed on 2026-10-26, owner decisions recorded the same day. Step 1 was
built in source on 2026-10-28 (see [step 1](#step-1-built-in-source-2026-10-28)); it is
deployed to the installed stack on 2026-10-28 (no apps seeded there) and not yet accepted. Steps 2 to 4 are not started, and each needs its own go-ahead. It is the first bounded step toward the
[product end state](PRODUCT.md#intended-end-state) and follows the
[target architecture](CONVERSATIONAL-PLUGINS.md) and the roadmap's
[first bounded engineering proof](ROADMAP.md#first-bounded-engineering-proof).

Wording: an **app** is what you see in Camenae's navigation (the game backlog). A
**tool** is something the assistant calls. An **entry** is one row of an app's data
(one game).

## Outcome

You ask the assistant for an app, for example "make me a backlog of games to play
next." A real page appears in Camenae's navigation with a table, a form and some
sample entries. You use it directly: add a game, mark one finished, filter by
platform, all without the model. You also tell the assistant to do it for you: "add
Hades", "mark Celeste finished", "delete the ones I dropped". You change the app
itself by talking: "add a rating out of five", "group by status", "make finished games
grey". Each design change arrives as a draft you can preview beside the live version
and activate, or throw away. The data survives every change, every restart, and the
model being unavailable.

## What is in and out

In: one kind of app (entries plus views), json-render with an application-owned
component catalog, versioned definitions with draft and active versions, entry storage
with stable field identities, a `camenae` command the assistant runs from its shell,
full assistant control of entries with an approve-once rule for destructive actions, a
preview and activation flow, version history with going back, and the game backlog as
the pilot.

Out: custom code, external integrations (Steam, Calendar), schedules, sharing and
export, themes beyond the existing tokens, selecting an element on screen to edit it,
mobile-specific layout work. Each is a later slice.

## Owner decisions (2026-10-26)

1. **Renderer: json-render.** Use `@json-render/solid` with our own catalog. The
   October spike's filter bug has a workaround (put the condition on each row, not on
   the repeat container) and should be reported upstream; the application-owned props
   check sits on top of json-render rather than replacing it.
2. **Agent channel: a `camenae` command line.** Every harness has a shell, so one
   command works for OpenCode, Claude Code, Codex and Pi without per-harness tool
   wiring. The command is a thin client of an application broker; the application
   validates and stores everything. The assistant may draft definitions as files in its
   workspace, but those are its scratch copies, never the live app.
3. **Entries: full assistant control.** The assistant can add, edit and delete entries.
   Destructive actions need your approval the first time, with the option to approve
   that kind of action from then on. To be hardened later.

## The pieces

### 1. Definition

An app is an application-owned definition, validated by zod and stored by the
application, never by the harness.

```text
app         id, name, icon, active version
version     immutable definition, base version, author (you or the assistant), time
definition  collections[]  fields with stable ids, labels, types, options
            spec           a json-render spec built from the Camenae catalog
            actions[]      the catalog's entry actions bound to collections
```

Field ids are generated once and never reused, so renaming "Hours" to "Time played" is
a label change, not a data migration. The spec and actions refer to fields by id.

### 2. Component catalog and renderer

`@json-render/solid` renders the spec. The catalog is ours: a small set of Solid
components, each with a zod props schema. The application checks every element's props
against its schema before rendering, because the October spike showed json-render's
catalog validation alone missed a wrong prop type.

- Layout: page, section, columns, tabs.
- Data: table, list, card grid, each bound to a collection with sort, filter and group.
- Input: form, inline edit, with field types text, long text, number, date, choice,
  multi-choice, yes/no, rating, link.
- Summary: count, sum, average, as small stat tiles.
- Action: button bound to a declared action.

Appearance uses the existing theme tokens and a few semantic choices ("muted",
"emphasis", "status colour"), never raw CSS. Entries reach the renderer as json-render
state, loaded from the application's routes; json-render actions call those routes.
Filtered lists put the condition on the row, never on the repeat container, until the
upstream bug is fixed.

### 3. Entries

Entries live in Postgres, separate from definitions: one row per entry, values keyed by
field id, with created and updated times. Ordinary operations (add, edit, delete,
filter) go through authenticated application routes and never need a model.

Schema changes in this slice are additive or reversible without loss:

- Adding a field: existing entries show it empty.
- Renaming: label only.
- Removing a field: hidden from views, values kept, restorable from history.
- Changing a type: allowed only where every existing value converts (text to choice
  when values match the options, number to rating when in range). Otherwise the draft
  is refused with an explanation.

### 4. How the assistant works with apps

The harness authors and acts; the application owns the artifact and the data. The
worker gets a `camenae` command (a small script on its path), for example:

```text
camenae app list
camenae app get backlog                 definition plus a sample of entries
camenae app propose backlog draft.json  submit a full definition as a draft
camenae entry list backlog --where status=playing
camenae entry add backlog '{"title":"Hades","platform":"Switch"}'
camenae entry update backlog <id> '{"status":"finished"}'
camenae entry delete backlog <id>
```

Output is JSON with precise validation errors, so the model can fix and retry within
the same turn. `--help` documents every command, and a shared skill teaches the format,
so any harness can learn it.

The command talks to an application **broker** on the private inference network, built
like the Console gateway: worker credential required, typed operations only, bounded
bodies, never published by ingress. The worker still has no route to the database or
the app's backend network. Workspace files are only inputs to `propose`: a bad file or
a stray script can never change a live app.

The assistant's own helper scripts (writing small tools for itself, in the Muse
spirit) already work through the worker's shell and Bun. They live in the workspace and
are separate from apps.

### 5. Approvals for destructive actions

Proposing a draft changes nothing live and needs no approval. Activating a draft is
always yours. Adding and editing entries are allowed. Destructive actions (deleting
entries, and later deleting an app or removing a field's data) need approval.

- The broker refuses a destructive action without a grant and records a pending
  request. The chat shows it as an approval card with the exact operation: which app,
  which entries, how many.
- **Approve once** runs that one operation. **Approve and don't ask again** creates a
  grant for that kind of action in that app, for example "delete entries in Backlog".
  It does not cover other apps or other kinds of action.
- Grants are listed in Settings and can be revoked. The assistant cannot create,
  widen or extend a grant.
- An approval binds to the exact operation it showed. Running something different
  needs a new approval.

To be hardened later: limits on how many entries one call may delete, undo for recent
deletes, and expiring grants.

### 6. Draft, preview, activate, history

- A draft is shown beside the live app, rendered against live entries read-only plus
  any labelled samples. A preview never writes real entries.
- **Activate** promotes the draft in one transaction. It is refused if the live version
  changed since the draft was based on it.
- **Discard** drops the draft. Nothing live changes.
- **History** lists versions. Going back activates an older definition. It never
  deletes entries created since, and fields that older version lacks are simply hidden.

### 7. Where it shows up

Activated apps appear in the top navigation next to Chat, Skills, Files and Settings,
which are the designated extension points (pages and navigation entries). The shell,
Settings, history and recovery stay outside generated content, so a bad definition can
never hide the way back.

## Acceptance: the game backlog

Run on a disposable stack. Each step has a literal expected result fixed before the run.

1. "Make me a backlog of games to play next": a draft with title, platform, status,
   hours, and samples. Activate it.
2. Add three real games by hand, without the model. Restart the stack; they remain.
3. "Add Hades on Switch": the entry appears with no approval asked.
4. "Delete Hades": an approval card names the one entry. Approve once; it is gone.
   "Delete the finished ones": asked again. Approve and don't ask again; they are gone.
   A further delete in Backlog runs without asking; a delete in another app still asks.
   Revoke the grant in Settings; the next delete asks again.
5. "Add a rating out of five": the draft adds a field, the games show it empty, and
   activating keeps them.
6. "Rename hours to time played": the label changes, the values are untouched.
7. "Group by status and grey out finished ones": the view changes, the data doesn't.
8. Start a draft, add a game by hand on the live app meanwhile, activate the draft:
   the game is kept.
9. Two drafts from the same base: activating the second is refused as stale.
10. Kill the app mid-activation: after restart, exactly one version is active.
11. "Change platform to a number": refused with an explanation, nothing changed.
12. Go back two versions: the rating is hidden, not deleted. Go forward: it returns.
13. Remove the provider key: the app still works for every ordinary operation.
14. A hostile definition (unknown component, wrong props, oversized, script-like
    strings) and a broker call without the worker credential: both refused.

Automated tests drive steps 1 to 12 through the synthetic model fixture, which can be
scripted to run `camenae` commands, as `smoke:console` already does for shell calls.
A live run with Claude Haiku checks that a real model can author definitions and use
the command. It needs a small, separately approved spend.

## Build order

1. Definition schema, catalog components on json-render, entry storage and routes,
   with a hand-written backlog definition (no assistant yet).
2. Versions, draft preview, activation, history.
3. Broker, `camenae` command, approvals and grants; the synthetic-fixture tests.
4. The acceptance run, then a live run with Haiku.

Each step ends usable and tested; step 1 alone already gives a working app.

## Review notes (2026-10-30)

From the full review recorded in [current status](CURRENT-STATUS.md#review-2026-10-30).
Recommendations, not decisions; the owner's 2026-10-26 decisions stand.

- **Order.** Keep step 2 minimal (versions, one draft, preview, activate, discard) and
  move history and going back after step 3. Step 3 is where the largest unknown is met:
  whether a model can author a valid definition and use the command. See the
  [revised sequence](ROADMAP.md#revised-sequence-review-2026-10-30).
- **Step 3 hardening, brought forward.** The slice above defers limits, undo and
  expiring grants. Build them in from the first version, because they are cheap now and
  expensive once the assistant is in daily use:
  - A durable action log table: actor (you or the assistant, with the conversation and
    turn), operation, parameters as checked, outcome, time. It is what the approval card
    cites, what Settings lists under each grant, and what undo reads from.
  - Grants bounded by app and kind (as planned) and also by count and expiry, with
    defaults the owner can change. A grant that runs out asks again.
  - A per-call ceiling on entries one delete may remove, so "delete the finished ones"
    cannot become "delete everything" from one misread.
  - Undo for recent deletes, from the log, within a window.
- **Authoring model.** Treat Claude Haiku 5.5 as the baseline for authoring definitions;
  the free models made live checks ambiguous. Keep the acceptance run's live part small
  and separately approved, as written.
- **json-render's place.** Step 1 uses json-render only to walk the tree; data components
  call the entry routes directly and the catalog declares no actions. That is the right
  trust boundary. The dependency earns its place once definitions may use visibility,
  repeats and state expressions; review that after step 3.
- **The command's output.** Every refusal the command prints should be the same precise
  problem list the routes return today (`definitionProblems`, `checkValues`), so a model
  can fix and retry within the turn. No new message wording.

## Step 1 (built in source, 2026-10-28)

What exists: `@json-render/core` and `@json-render/solid` 0.21.3, pinned exactly (the
0.21.2 and 0.21.3 release notes are bug fixes only, nothing about repeats or filters).
Also built: the contract, migration 014, store and routes; the hand-written backlog
seed; the catalog (Page, Section, Columns, Table, EntryForm, Stat); and the app screen.
Apps sit in the navigation after the built-in screens. Checked by `test:apps`, by
`tests/apps.ts` in `smoke:foundation` on a disposable stack (guards, validation, round
trip, entries kept across stack replacement), and in a headless browser against the dev
fixture (add, filter, inline edit, muted rows, delete with confirmation, phone width).
Not checked: a browser against a disposable stack, the installed stack, or the owner.

Differences from the plan below:

- Data components call the entry routes directly, and only for actions the definition
  declares. They do not go through json-render actions, so a definition cannot build
  arbitrary requests. The spec subset allows no `visible`, `repeat`, `on`, `watch` or
  state expressions yet.
- Filtering, sorting and grouping are props of Table, done in the browser (the plan's
  default). Card grid, list, tabs and a standalone button are not in the catalog yet.
- Tables are named `app` and `app_entry`, singular like the existing tables.
- The dev fixture keeps entries in memory using the real definition and value checks,
  so `dev:app` stays Docker-free. Postgres is covered by `tests/apps.ts`.
- The renderer test covers the props check and refuses unknown components without a
  DOM. It does not draw json-render, so the filtered-row case was not re-run: that needs
  a DOM test library, which is not an approved dependency.
- The seed exists in development and tests only (the plan's default).

### The plan as prepared

Goal: a backlog app you use by hand, drawn by json-render from a hand-written
definition, with entries that survive restarts.

Dependencies, pinned exactly: `@json-render/solid` and `@json-render/core` 0.21.3, the
version the October spike tested. It peers on `solid-js` ^1.9 and `zod` ^4, which the
project already has (1.9.17, 4.6.5). 0.21.3 was published on 2026-10-24; check its
changelog against 0.21.1 before installing, and re-run the spike's filter case against
it in a test.

Work, in order:

1. `src/apps-contract.ts`: zod schemas for the definition (collections, fields with
   ids and types, spec, actions), entry values per field type, request bodies, limits
   (definition size, collections, fields, entries per app), and failure codes.
2. `src/migrations/014-apps.ts`: `apps` (id, name, icon, active definition) and
   `app_entries` (id, app id, values keyed by field id, created and updated times).
   Versions arrive in step 2; step 1 stores one definition per app.
3. `src/apps-store.ts`: list and get apps, list, add, update and delete entries,
   validating values against the definition's field types.
4. `src/apps-routes.ts`: `GET /api/apps`, `GET /api/apps/:id` (definition and
   entries), `POST /api/apps/entries/add`, `/update` and `/remove`, each with session,
   exact Origin, JSON content type and CSRF, like the skills routes.
5. The hand-written backlog definition as a seed, created once where it is enabled
   (see the open questions) and never overwritten.
6. `src/app/catalog/`: the catalog (zod props per component), Solid components, the
   props check, and the json-render registry and actions wired to the routes.
7. `src/app/app-view.tsx`: loads an app, puts entries into state, renders the spec,
   and handles errors with a fixed message and a way back. Apps join `screens` in
   `src/app/shell.tsx`.
8. Fixture: `scripts/dev-app-apps.ts` over the real store on disposable Postgres, wired
   into `scripts/dev-app-fixture.ts`.
9. Tests: `tests/apps.ts` (route guards, value validation, entry round trip, persistence
   across an app restart) added to `scripts/smoke-foundation.sh`; a renderer test for
   the props check, the filtered-row case and an unknown component being refused.
10. Docs: CURRENT-STATUS, ARCHITECTURE (new tables and routes), DEVELOPMENT.

Done when: lint, typecheck, the UI build, docs check and the new tests pass; on a
disposable stack you add, edit, filter and delete games by hand, restart, and find
them intact. Deploying to the installed stack is a separate go-ahead.

Open questions for step 1, with defaults if not answered:

- How filters and sorting are expressed: json-render state and `$computed` (default),
  or filtering in the application routes. Default stays client-side until an app holds
  more entries than one page loads.
- Whether the seeded backlog appears on the installed stack or only in development.
  Default: development and tests only, until step 3 lets the assistant create it.
