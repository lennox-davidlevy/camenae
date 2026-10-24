# Development and source releases

## Fresh checkout

The experimental [OpenCode path](OPENCODE.md) additionally requires its exact SDK
archive. Stage both archives before installing dependencies or building images.
`bun run smoke:opencode` uses a disposable project and a local synthetic provider;
it does not change the running installation or use paid inference.

Use Bun **1.4.2**, Python **3.10+** (documentation/export tools), POSIX shell,
`sha256sum`, `curl`, Linux Docker Engine (28.4+ isolation baseline), and Compose v2.
Node 22 is supplied in images for native-runtime comparison and workspace tools;
no globally installed TypeScript/Oxlint is required.

Obtain the exact [SDK delivery](BOB-OPERATIONS.md#sdk-dependency), then:

```sh
bun run sdk:stage /path/to/approved-bob-sdk.tgz
bun run sdk:stage /path/to/camenae-opencode-0.1.0-b24e73923802.tgz
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run check:docs
bun run build:ui
bun run test:provisioning
bun run test:dev-ui
bun run test:threads
bun run test:images
bun run smoke:foundation
bun run smoke:mcp
bun run smoke:console
bun run probe:build
bun run probe:bun
bun run probe:node
```

Run Docker suites serially. They create unique projects, synthetic credentials,
volumes, and generated env files, then remove only their own resources. Fixed
test subnets `172.30.84.0/24`, `172.30.85.0/24` (live), `172.30.86.0/24`, host port
48923 (foundation canary), and 5173 (dev proxy check) must be free. Do not aim these
tests at user-owned volumes or reuse credentials. No deployment is implied by
passing isolated checks.

Test runners apply `tests/images.compose.yaml` (and
`tests/opencode-images.compose.yaml` for OpenCode workers) to reuse fixed
`camenae-test-*:latest` image tags. Rebuilding replaces the previous tags; cleanup
prunes only dangling images labeled `app.camenae.test-image=true`, never deployment
images or images still used by containers. Containers, volumes, networks and
credentials still use unique disposable projects. Run suites serially because the
image tags and test subnets are shared.

OpenCode native smoke uses `172.30.87.0/24`; Console setup smoke uses
`172.30.89.0/24`. Both use only synthetic provider data.

| Check | Evidence / boundary |
| --- | --- |
| lint/typecheck/build | Configured rules (including vendored plugins), TS/TSX contracts, production browser bundle |
| check:docs | Relative Markdown file/anchor links throughout selected source |
| test:provisioning | Actual init entrypoints with no pre-existing cache, private file modes, and byte-preserving refusal to overwrite |
| test:dev-ui | Real loopback proxy, Host/Origin guards, cookies, forwarding, SSE streaming with synthetic backend |
| test:threads | Local-calendar thread grouping across week/year/DST boundaries and safe headline/metadata rendering |
| test:images | Resolve all smoke Compose stacks: stable test tags/cleanup labels, isolated project state, unchanged deployment images; no services started |
| smoke:foundation | Real Docker/Postgres/native Bob: authentication, file boundaries, environment/network isolation, preparation, whole-worker teardown, DNS recovery, state retention, readiness and shutdown |
| smoke:mcp | Synthetic local MCP/model fixtures, real Postgres/SDK/Bob: settings, ownership refusal, approvals/history, cancellation, native delegation and independent upstream receipts; HTTP/SSE usage consumer and rendered UI |
| smoke:console | Real HTTP/Postgres/native OpenCode: encrypted Settings credential, new-chat harness selection, strict free-only gateway, atomic persistent request cap; synthetic provider, no egress service |
| probe:bun / probe:node | Same packaged native runtime, non-root, network disabled: initialization/session/shutdown only |

Tests are executable programs orchestrated by these runners, not a generic
`bun test` suite. Container paths and service dependencies are intentional. Retain
coverage for externally meaningful behavior; static/slow tests are not inherently
obsolete. Diagnose fixtures and owning code instead of relaxing assertions/timeouts.
The session-usage fixture replaces only the runtime service and consumes controlled
SDK events through real application HTTP/SSE/Postgres/UI; it does not prove Bob's
accounting or live billing. The fixture upstream serves only synthetic data.

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

Both composers provide **+ File → Upload from computer** or **Choose from workspace**.
Local text uploads are saved in that chat's inbox folder and automatically selected;
existing workspace files are selected in place, with folder navigation and preview.
Chips show filenames, with full paths on hover. An uploading chip blocks sending;
failed uploads offer Retry or Remove, and cannot silently be omitted from a send.
Draft selections and failed uploads are isolated per conversation
in page memory and clear after an accepted send; a rejected send retains the text
and selection. Reloading clears unsent selections, while sent snapshots remain in
history and the inspector. Both upload entry points allow 64 KiB text files; a chat
message is limited to four files and 64 KiB total. Removing a chip does not delete
the workspace file. PDFs, images, drag-and-drop, and attachment-only messages
are not supported. The picker estimates size from preview; server validation at
send time is authoritative if a file changes.

For a deliberately selected backend, `CAMENAE_DEV_BACKEND=http://127.0.0.1:3000
bun run dev` serves `http://127.0.0.1:5173/chat`. Default backend is port 3000. This
is **not a sandbox**: sign-in/settings/files affect that backend. Cookies are shared
across loopback ports; separate installations need separate browser profiles.
The proxy is loopback-only, checks Host/Origin, translates same-origin writes, and
forwards streaming. Do not expose it through tunnels or use it in production.
Only dev HTML uses the HMR policy; the deployed page retains its production CSP.

### SolidJS preview shell

`bun run dev:app` serves the in-progress SolidJS UI (`src/app`) at
`http://127.0.0.1:5174/` with hot reload, no Docker, and no image builds. By default
it answers `GET /api/chat` with synthetic conversations, so no backend, sign-in, or
user state is involved. `bun run dev:app -- --backend http://127.0.0.1:3000` instead
proxies `/api` and `/auth` to a separate loopback instance; that is not a sandbox,
and the backend must be a different loopback HTTP origin. The server is
loopback-only, refuses other Host headers, and serves only `src/` and `node_modules`.
`bun run build:app` writes a production build to `public/app/` (gitignored). The
application does not serve that build yet, and the Docker images do not use it.
The shell shows real thread grouping and resizable panels; chat, skills, files, and
settings are not built in it. Close any browser you opened and stop the server when
finished.

For no-inference browser checks, start a separate disposable Compose project with
its own generated auth/env, unused port/subnet, `tests/mcp.compose.yaml`, and
`tests/images.compose.yaml`. Build
`app`; start `postgres` and `mcp-fixture`, keeping normal `app` stopped. Run:

```sh
# Replace these placeholders with the disposable project's own paths/name only.
docker compose --env-file <test-env> -p <test-project> \
  -f compose.yaml -f tests/mcp.compose.yaml -f tests/images.compose.yaml \
  run --rm --no-deps --use-aliases -T \
  app bun tests/session-usage.tsx --serve < <test-auth-directory>/login.txt
```

In another terminal, start that project's ingress with `--no-deps`. Use its exact
configured `CAMENAE_ORIGIN`. The fixture exercises its HTTP/SSE assertions before
serving the production UI. Synthetic prompts `compact`, `unknown`, and `over-limit`
exercise displayed usage without any provider. Check sign-in, Chat, Settings,
file upload/preview/download, reload persistence, and narrow-screen layout. Stop
and remove only that disposable project afterwards. Never present fixture-backed
browser behavior as proof of live model behavior.

For mixed-harness regression checks, add `-e CAMENAE_HARNESS=opencode` to the
disposable `compose run` command and pass `--mixed-harness --serve` to the fixture.
It leaves OpenCode unconfigured, creates Bob conversations plus 100 newer rows,
and prints an older Bob deep link outside the sidebar. Verify that its composer
is enabled. New Chat is disabled with OpenCode selected, but selecting Bob enables
it without changing the current conversation's harness. Select the visible Bob conversation
and save a Context7 change in Settings, then reload to verify persistence. Selecting
an unavailable OpenCode conversation must disable both its composer and Bob Apply.

## Optional paid/live checks

Only with separate authorization for paid inference and public Context7 queries:
`bun run smoke:chat:live` uses `BOB_API_KEY` from the caller's environment, piped
through stdin into synthetic onboarding in an isolated project. Never use shell
tracing, plaintext key files, real user inputs, or a key in image builds. It checks
streaming, native tool outcomes, manual/automatic approvals, Stop, revocation,
conversation switching, and retained native context across replacement.

`scripts/runtime-live-probe.ts` is a separate manually invoked Bun/Node runtime
diagnostic, not obsolete or an app smoke substitute. After `probe:build`, its opt-in
form is:

```sh
printf '%s' "$BOB_API_KEY" | docker run --rm -i --init \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 2g --cpus 2 --pids-limit 256 \
  camenae-runtime-probe:local bun scripts/runtime-live-probe.ts --allow-live
```

For Node, replace the final executable with `node --experimental-strip-types`.
This probe uses ordinary outbound Docker networking, not the app's restricted
proxy. It sends at most six prompts with an eight-minute deadline and requires
actual native approval/tool effects, not model prose. Forced client termination
may leave a test container: identify and stop only that container. These live paths
are excluded from ordinary no-inference validation and require their own evidence.

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
SDK/Bob archives, generated UI, uploads, databases, credentials, or logs are copied.
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
