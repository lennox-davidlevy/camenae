# Development and source releases

## Fresh checkout

The [OpenCode integration](OPENCODE.md) requires its exact SDK archive. Stage it
before installing dependencies or building images. `bun run smoke:opencode` uses a
disposable project and a local synthetic provider; it does not change the running
installation or use paid inference.

Use Bun **1.4.2**, Python **3.10+** (documentation/export tools), POSIX shell,
`sha256sum`, `curl`, Linux Docker Engine (28.4+ isolation baseline), and Compose v2.
Node 22 is supplied in images for workspace tools; no globally installed
TypeScript/Oxlint is required.

Obtain the exact [SDK delivery](OPENCODE.md#exact-local-dependency), then:

```sh
bun run sdk:stage /path/to/camenae-opencode-0.2.0-b2c0d67d6050.tgz
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run check:docs
bun run build:app
bun run test:apps
bun run test:provisioning
bun run test:dev-ui
bun run test:threads
bun run test:images
bun run smoke:foundation
bun run smoke:opencode
bun run smoke:console
```

Run Docker suites serially. They create unique projects, synthetic credentials,
volumes, and generated env files, then remove only their own resources. Fixed
test subnets `172.30.84.0/24` (foundation), `172.30.87.0/24` (OpenCode) and
`172.30.89.0/24` (Console), host port 48923 (foundation canary), and 5173 (dev
proxy check) must be free. Do not aim these tests at user-owned volumes or reuse
credentials. No deployment is implied by passing isolated checks.

Test runners apply `tests/images.compose.yaml` to reuse fixed
`camenae-test-*:latest` image tags. Rebuilding replaces the previous tags; cleanup
prunes only dangling images labeled `app.camenae.test-image=true`, never deployment
images or images still used by containers. Containers, volumes, networks and
credentials still use unique disposable projects. Run suites serially because the
image tags and test subnets are shared. All suites use only synthetic provider data.

| Check | Evidence / boundary |
| --- | --- |
| lint/typecheck/build | Configured rules (including vendored plugins), TS/TSX contracts, production browser bundles |
| check:docs | Relative Markdown file/anchor links throughout selected source |
| test:apps | App definition checks (hostile and careless definitions refused with a reason) and entry value validation; no DOM or database |
| test:provisioning | Actual init entrypoints with no pre-existing cache, private file modes, and byte-preserving refusal to overwrite |
| test:dev-ui | `dev:app --backend` loopback proxy: Host/Origin guards, cookies, forwarding, SSE streaming with a synthetic backend |
| test:threads | Local-calendar thread grouping across week/year/DST boundaries |
| test:images | Resolve all smoke Compose stacks: stable test tags/cleanup labels, isolated project state, unchanged deployment images; no services started |
| smoke:foundation | Real Docker/Postgres: authentication, file boundaries, ingress/app network isolation, worker egress denial, DNS recovery, state retention across replacement, readiness and shutdown; skill routes, guards, and harness visibility after a location reload; app routes, guards, value checks, an entry round trip, and entries surviving stack replacement |
| smoke:opencode | Real Docker/Postgres/native OpenCode with a local model fixture: streaming, one-time approval, workspace tool, cancellation, failed requests, session reopening, old-worker retirement |
| smoke:console | Real HTTP/Postgres/native OpenCode: encrypted Settings credential, strict free-only gateway, atomic persistent request cap; synthetic provider, no egress service |

Tests are executable programs orchestrated by these runners, not a generic
`bun test` suite. Container paths and service dependencies are intentional. Retain
coverage for externally meaningful behavior; static/slow tests are not inherently
obsolete. Diagnose fixtures and owning code instead of relaxing assertions/timeouts.
The fixture upstream serves only synthetic data.

## UI development and browser checks

The thread sidebar displays persisted native headlines when available, otherwise
the first-message preview. Reading native metadata does not request a new summary;
native harness title generation still follows that harness's own behavior. Rows show
recorded tool-call counts and local times/dates, grouped by latest prompt into Today,
Yesterday, This week, Last week, and older months. Older conversations without a
recorded activity timestamp initially retain their creation date. Group headings
collapse independently. Drag the vertical separators to resize the thread and
inspector panels; focused separators also support arrow keys, Shift for larger
steps, and Home/End. Double-click resets a panel. Width preferences stay in browser
storage; narrow layouts retain their responsive panel visibility.

The composer provides **+ File → Upload from computer** or **Choose from workspace**.
Local text uploads are saved in that chat's inbox folder and automatically selected;
existing workspace files are selected in place, with folder navigation and preview.
Chips show filenames, with full paths on hover. An uploading chip blocks sending;
failed uploads offer Retry or Remove, and cannot silently be omitted from a send.
Draft selections and failed uploads are isolated per conversation
in page memory and clear after an accepted send; a rejected send retains the text
and selection. Reloading clears unsent selections, while sent snapshots remain in
history and the inspector. Removing a chip does not delete
the workspace file. PDFs, images, drag-and-drop, and attachment-only messages
are not supported. The picker estimates size from preview; server validation at
send time is authoritative if a file changes.

### SolidJS application

`bun run dev:app` serves the SolidJS UI (`src/app`) at
`http://127.0.0.1:5174/` with hot reload, no Docker, and no image builds. By default
it answers `GET /api/chat` with synthetic conversations, so no backend, sign-in, or
user state is involved. `bun run dev:app -- --backend http://127.0.0.1:3000` instead
proxies `/api`, `/auth`, and `/auth.css` to a separate loopback instance; that is not a
sandbox, so sign-in and chat writes affect that backend. The backend must be a different
loopback HTTP origin and must have `CAMENAE_ORIGIN` set to that exact origin, because it
accepts writes only from its own origin. The proxy refuses any other browser origin, then
presents the backend's origin for the page's own writes. Sign in through the proxied
`/auth/login`; its redirect to `/chat` is a 404 here, so open `/` afterwards. The server is
loopback-only, refuses other Host headers, and serves only `src/` and `node_modules`.
`bun run build:app` writes a production build to `public/app/` (gitignored). The
application serves that build at `/chat`, and the Docker image runs `build:app`.
The shell has thread grouping, resizable panels, and a chat view: message list with
sanitized Markdown, tool activity, approval cards, a composer with per-conversation
drafts, stop, new chat, a per-conversation model picker, a usage panel, a server-sent-event stream with follow-the-bottom
scrolling, and a Settings screen for the provider key and request allowance. In fixture mode the dev server simulates turns in memory: any message
streams a short "Thinking" block and then a reply; include `approve` to trigger an
approval card, `retry` to show the provider-retry notice for three seconds, and
`markdown` for hostile Markdown. Attachments and files are not built in it; its Skills use the real storage code over a throwaway directory. It also serves the seeded game backlog under **Backlog** in the navigation, using the application's own definition and value checks over entries held in memory (they reset when the server restarts). Close any browser you opened and stop the server when
finished.

For browser checks against a real backend without inference, start a separate
disposable Compose project with its own generated auth/env, an unused port and subnet,
`CAMENAE_ORIGIN` set to that port, and the overlays
`-f compose.yaml -f tests/opencode.compose.yaml -f tests/images.compose.yaml`. That
overlay replaces the provider with a local synthetic fixture. Point
`bun run dev:app -- --backend` at its published port, or use the project's own ingress.
Check sign-in, Chat, Settings, file upload/preview/download, reload persistence, and
narrow-screen layout. Stop and remove only that disposable project afterwards. Never
present fixture-backed browser behavior as proof of live model behavior.

## Design/change discipline

Keep application concerns here and native protocol/capabilities in their owning
SDK/harness. Preserve compatibility identifiers and forward-only migrations.
Add new routes only with authentication/authorization and bounded data contracts.
Maintain the single-process lifecycle and fail-closed security boundaries unless
an explicit design changes them. No application plugin framework or cloud
deployment is implied by a design idea.

Changes require lint, typecheck, affected boundary tests, production build, and an
independent review. UI/deployment changes need actual-path checks where possible.
Record exact commands, artifact identity, environment, and blocked checks outside
published source; do not turn guides into session journals.

## Source-only release/export

`bun run export:source /absolute/path/outside-this-checkout` writes a selected
source archive, per-file inventory/hashes, and SHA-256. The destination must be
new. Selection is explicit: maintained source/tests/scripts/docker/docs, required
lint tooling, font/artwork assets, configuration and notices. It rejects symlinks,
unexpected file types, obvious credential material and private home paths.
This targeted scanner is not a guarantee that arbitrary secrets can be detected;
review the file inventory before sharing.

No Git history, `.env`, `.cache`, local agent tooling, dependencies, compiled
SDK archives, generated UI, uploads, databases, credentials, or logs are copied.
Assets needed to build the UI are source inputs, not generated build output.
The third-party notices and font licenses remain included.

Validate the **extracted archive**, not just the working tree: stage the approved
external SDK there, install freshly with the frozen lockfile, and run the checks
above. Do not copy `node_modules`/`public` or private state from another checkout.
Do not re-export that populated validation directory as an unfiltered tarball.

Release evidence belongs adjacent to, not inside, the export: validation logs,
inventory, SHA-256, removed-document contract mapping, and review results. Keep
private Git/source/evidence backups separate and never publish them accidentally.
Publishing also requires an explicit app-license/artwork-rights decision and a
usable SDK delivery channel; see [notices](../THIRD-PARTY-NOTICES.md).

To start a new repository, extract a fresh copy of the validated source archive,
inspect its inventory/notices, and initialize Git in that directory yourself.
There is no `.git` or old remote in the archive. Stage only the selected source,
review `git status`, and make your initial commit. Create/configure the new GitHub
remote and push only when you choose to publish. Do not copy the old checkout's
Git directory, private backups, validation runtime state, or SDK archive.

## Quotes pipeline

`tools/quotes` builds `data/quotes/quotes.jsonl`, a dataset of public-domain quotations
verified word for word against pinned Project Gutenberg editions. It runs outside the
application and is not in the Docker images. See [its README](../tools/quotes/README.md);
`bun run test:quotes` checks the text helpers and the committed dataset. A private,
gitignored set of Games Workshop quotes is built the same way from locally saved pages; the
README says how and why it stays out of the repository.
