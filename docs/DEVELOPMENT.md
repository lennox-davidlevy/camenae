# Development and source releases

## Fresh checkout

Use Bun **1.4.2**, Python **3.10+** (documentation/export tools), POSIX shell,
`sha256sum`, `curl`, Linux Docker Engine (28.4+ isolation baseline), and Compose v2.
Node 22 is supplied in images for native-runtime comparison and workspace tools;
no globally installed TypeScript/Oxlint is required.

Obtain the exact [SDK delivery](BOB-OPERATIONS.md#sdk-dependency), then:

```sh
bun run sdk:stage /path/to/approved-sdk.tgz
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run check:docs
bun run build:ui
bun run test:provisioning
bun run test:dev-ui
bun run smoke:foundation
bun run smoke:mcp
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

| Check | Evidence / boundary |
| --- | --- |
| lint/typecheck/build | Configured rules (including vendored plugins), TS/TSX contracts, production browser bundle |
| check:docs | Relative Markdown file/anchor links throughout selected source |
| test:provisioning | Actual init entrypoints with no pre-existing cache, private file modes, and byte-preserving refusal to overwrite |
| test:dev-ui | Real loopback proxy, Host/Origin guards, cookies, forwarding, SSE streaming with synthetic backend |
| smoke:foundation | Real Docker/Postgres/native Bob: authentication, file boundaries, environment/network isolation, preparation, whole-worker teardown, DNS recovery, state retention, readiness and shutdown |
| smoke:mcp | Synthetic local MCP/model fixtures, real Postgres/SDK/Bob: settings, ownership refusal, approvals/history, cancellation, native delegation and independent upstream receipts; HTTP/SSE usage consumer and rendered UI |
| probe:bun / probe:node | Same packaged native runtime, non-root, network disabled: initialization/session/shutdown only |

Tests are executable programs orchestrated by these runners, not a generic
`bun test` suite. Container paths and service dependencies are intentional. Retain
coverage for externally meaningful behavior; static/slow tests are not inherently
obsolete. Diagnose fixtures and owning code instead of relaxing assertions/timeouts.
The session-usage fixture replaces only the runtime service and consumes controlled
SDK events through real application HTTP/SSE/Postgres/UI; it does not prove Bob's
accounting or live billing. The fixture upstream serves only synthetic data.

## UI development and browser checks

For a deliberately selected backend, `CAMENAE_DEV_BACKEND=http://127.0.0.1:3000
bun run dev` serves `http://127.0.0.1:5173/chat`. Default backend is port 3000. This
is **not a sandbox**: sign-in/settings/files affect that backend. Cookies are shared
across loopback ports; separate installations need separate browser profiles.
The proxy is loopback-only, checks Host/Origin, translates same-origin writes, and
forwards streaming. Do not expose it through tunnels or use it in production.
Only dev HTML uses the HMR policy; the deployed page retains its production CSP.

For no-inference browser checks, start a separate disposable Compose project with
its own generated auth/env, unused port/subnet, and `tests/mcp.compose.yaml`. Build
`app`; start `postgres` and `mcp-fixture`, keeping normal `app` stopped. Run:

```sh
# Replace these placeholders with the disposable project's own paths/name only.
docker compose --env-file <test-env> -p <test-project> \
  -f compose.yaml -f tests/mcp.compose.yaml run --rm --no-deps --use-aliases -T \
  app bun tests/session-usage.tsx --serve < <test-auth-directory>/login.txt
```

In another terminal, start that project's ingress with `--no-deps`. Use its exact
configured `CAMENAE_ORIGIN`. The fixture exercises its HTTP/SSE assertions before
serving the production UI. Synthetic prompts `compact`, `unknown`, and `over-limit`
exercise displayed usage without any provider. Check sign-in, Chat, Settings,
file upload/preview/download, reload persistence, and narrow-screen layout. Stop
and remove only that disposable project afterwards. Never present fixture-backed
browser behavior as proof of live model behavior.

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
an explicit design changes them. No application plugin framework, multi-harness
selector, or cloud deployment is implied by a design idea.

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
