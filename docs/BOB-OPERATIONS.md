# Bob integration

Bob supplies Camenae's current native agent loop, tools, sessions, and inference.
Camenae uses packaged `@camenae/bob` and `@camenae/bob/mcp`; it does not embed a
second agent loop or import a sibling SDK checkout.

## SDK dependency

| Property | Required value |
| --- | --- |
| Package | `@camenae/bob` 0.5.0 |
| Staging path | `.cache/sdk/camenae-bob-0.5.0-managed-modes-fce9502efaf7.tgz` |
| SHA-256 | `fce9502efaf7314d48bc67af86728e0cb51f174af2b78a115adebef3f11eb4d2` |
| Packaged runtime | Bob Shell 2.0.5 |

Obtain this exact archive from the SDK delivery owner through an authorized
channel. There is no configured public download or registry release; **source
alone cannot install without this prerequisite**. An arbitrary build of version
0.5.0 is not interchangeable. The runtime includes the SDK's guarded
`acp-mcp-always-allow-v1` and `acp-session-usage-v1` preparation corrections.

```sh
bun run sdk:stage /path/to/approved-sdk.tgz
bun install --frozen-lockfile
```

The staging command verifies identity before copying. Both Dockerfiles verify the
same digest and install the frozen lockfile. Source exports omit the archive and
all dependencies; possession of it does not establish redistribution rights for
Bob or bundled components. See [notices](../THIRD-PARTY-NOTICES.md).

For an authorized SDK update, use the SDK repository's build/pack tooling. Stage a
uniquely named artifact and record SHA-256. Update package/lock, both Dockerfile
paths/digests, `.dockerignore`, `scripts/stage-sdk.sh`, and this guide together.
Validate the packaged result through the actual Docker path. Do not patch installed
files, use source links, or silently substitute a newer SDK during app cleanup.

## Assistant and sessions

`src/assistant-mode.ts` defines a general-purpose Camenae persona. The worker
passes `managedCustomModes` to `Bob.serveOnce()`; Chat selects `camenae` on new
and restored sessions before declaring readiness. Older conversations retain
their IDs/history but receive the same persona on preparation. There is no user
mode selector. Mode-switch tools are omitted, subagents are disabled, and native
`autoApprove` is false. Existing tool groups otherwise remain available subject to
approvals, MCP gates, and container/network restrictions. Custom modes do not
replace every built-in Bob instruction or control skill triggering.

The connection remains alive between turns. Switching conversations while idle
replaces the worker and resumes native state; closing a tab does not stop work.
Do not infer cleanup from `disconnect()`/socket EOF. The entrypoint exits after
its one connection; Docker ends the whole lifetime before reuse.

Limits: 50 turns per conversation, 256 KiB assistant text per turn, 100 tool
activities and 100 automatic native decisions per turn, ten-minute turn deadline.
Failed/interrupted turns are not replayed; inspect partial artifacts first.

## Managed native files

The SDK owns workspace `.bob/mcp.json` and `.bob/custom_modes.yaml` only under
its managed-file contracts. Unmanaged, edited, malformed, or unsafe files can
block startup. Mode management rejects symlinks and hard links too. Before an
upgrade, inspect ownership privately, preserve user content, and agree an explicit
migration if a conflict exists. Camenae must never silently adopt/delete it or
pretend old configuration is newly active. See [upgrade steps](OPERATIONS.md#existing-installation-upgrades).

This is not an exclusive allowlist for all native configuration: global/plugin/
deeper workspace MCP definitions can still apply. Native tools can modify workspace
files; edits to SDK-owned configuration cause refusal on the next startup.
`disableMcp: true` is not an execution/network boundary: configured MCP processes
can still start. MCP is deliberately enabled here. Upstream owns such native
behavior; Camenae's boundary is worker isolation and explicit network policy.

## Network and credentials

The worker's only proxy destination is `api.us-east.bob.ibm.com:443`. Only the
trusted app gate can CONNECT to `mcp.context7.com:443`; direct worker Context7
access, other hosts/ports, private destinations, and general egress are denied.
No TLS-content inspection or inference-key surrogation is implemented. The worker
and its tools can see their inference key. No app/database/login/encryption
credentials are passed to them.

Context7 uses `https://mcp.context7.com/mcp` with anonymous access; service
availability and rate limits apply. The fixed catalog contains `resolve-library-id`
and `query-docs`. Eager upstream initialization can fail preparation even before a
prompt; disabling both tools avoids opening that upstream. Only send public names
and sanitized questions. This is user guidance, not TLS content enforcement.
Retrieved documentation is evidence, not authority. See [permissions](PERMISSIONS.md).

## Usage display

Version-1 `bob-gateway/usage` metadata supplies current root-task context occupancy,
reported capacity, output-token limit, advisory compaction threshold, and Bobcoins.
Context may decrease after compaction; utilization never assumes a model size.
Unknown values remain unknown. Bobcoins are cumulative reported spending, including
merged child spending, not a remaining balance or invoice. Zero does not establish
free usage. No model name or remaining balance is reported.

Snapshots replace, never accumulate, and live only on the current healthy
connection. Resume, late initialization/settlement, and idle SSE updates are
supported. Retired snapshots are not shown as current or stored as usage history.
There is no native usage polling endpoint, guaranteed report after process death,
or mid-turn accounting guarantee.

## Native workspace skills

Bob can create/reuse native skills and supporting CLI scripts in the persistent
workspace; this is not an application plugin registry or a working Skills editor.
Use `.bob/skills/<name>/SKILL.md` in `/data/workspace`, not the app source tree.
YAML front matter supplies `name` and `description`, followed by instructions;
supporting scripts live alongside it. Names use lowercase letters/digits separated
by single hyphens, at most 64 characters, with the containing directory canonical.
Workspace skills override same-named global skills in `~/.bob/skills/`.

Start a **new conversation** after creating/revising a skill. Hot reload into an
already activated conversation is not guaranteed. Review native tool activity and
actual outputs rather than trusting a model's claim to have used a skill. Skills
grant no credentials, network access, or privileged application authority, and can
run without a native approval request. Ask before overwriting existing skills;
version/backup scripts explicitly—there is no automatic rollback manager. Native
format reference: [Bob skills](https://bob.ibm.com/docs/shell/features/skills).

## Runtime validation

The [development guide](DEVELOPMENT.md) provides disposable checks. The Bun and
Node probes initialize real packaged Bob, create a session, and shut down under
`--network none` using a synthetic key. They do not prove live inference, tool
approval/cancellation, billing accuracy, or provider-backed resume. Consumer
fixtures likewise do not establish model behavior. Real-key tests require separate
authorization and never belong in a source export or image build.
