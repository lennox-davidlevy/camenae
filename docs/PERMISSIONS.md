# Approvals and connected-tool permissions

Availability, authorization, and operating-system isolation are separate controls.
Camenae stores preferences and presents requests; the SDK settles permissions;
Bob owns native tool behavior. An Allow decision never proves execution or success.

## Native approvals

Settings offers Ask / Allow / Deny for `edit`, `delete`, `execute`, `search`, and
`fetch`, plus Ask / Deny for other/unclassified requests. All default to Ask;
there is no blanket Allow fallback. Categories are reported by the harness, not
trusted risk levels or individual commands, paths, or MCP identities. Allow for
Execute covers every request classified that way.

Save and apply commits to Postgres before installing on the trusted client, without
a worker restart. Only new requests use the changed policy. Pending requests stay
manual and executing actions are not revoked. Connection creation/switches serialize
with save/install. Database failure leaves active policy unchanged; installation
failure retains saved preferences without advancing the confirmed active snapshot.
Re-save/reconnect retries installation through the normal path, not a separate queue.

Every connection supplies policy before session loading, and preparation reconciles
saved preferences. Native `autoApprove` stays false. The application does not send
policy as ACP options, write it into MCP native configuration, or implement a
second decision engine. The UI distinguishes saved, active, and last-confirmed/
unverified values. Refresh after another tab changes settings; status is not a
continuous cross-tab subscription.

Manual options are filtered to native `allow_once`, `reject_once`, and cancel;
the server validates against the pending request. Missing/ambiguous one-time
options remain manual even with an automatic policy. Reads and built-in skills
can execute without asking. Native categories lack stable per-MCP-tool identity.
These controls are not universal interception or a sandbox.

`/api/settings/approvals` requires authentication; POST requires exact Origin and
CSRF. The strict schema rejects extra keys, unknown decisions, or Allow fallback.
Preferences apply to one account/shared workspace across conversations. Separate
owners need separate installations and volumes.

## Context7 permissions and availability

Connected tools settings offers an Ask / Allow / Deny server default and exact
exceptions for `resolve-library-id` and `query-docs`. Each tool can be disabled;
Disabled wins but retains its saved permission. Deny keeps an enabled tool visible
and blocks upstream forwarding. Only Context7 is configured—no Git or general
connector management. Shell equivalents are outside MCP policy.

All fixed known names appear in managed startup `alwaysAllow`, including gate
Ask/Deny/disabled names. This delegates native approval to the trusted gate rather
than globally auto-approving tools. Ask produces one gate question, Allow forwards,
Deny blocks, Disabled hides and rejects direct calls. Standard ACP session MCP
definitions remain empty; unknown upstream names are not silently delegated.
Review/update the deployment catalog and replace workers before promising new-tool
behavior. Mixed read/destructive tools require Ask unless a separately reviewed
argument-aware policy exists.

Apply changes saves then applies while idle; it is unavailable during turns or
preparation. Failed apply retains desired settings and reports saved versus active
separately. The next preparation/message can install saved settings. Availability
changes never revoke already-pending calls or completed side effects.

Each gate/token belongs to one conversation/native-session connection lifetime.
Switches, unhealthy connections, credentials changes, and applied settings replace
the worker/gate. Healthy unchanged conversations reuse it. App-published snapshots
precede retirement; fingerprints are checked before load. Failed startup closes
acquired scopes. Cancellation/teardown abort pending approvals; late answers cannot
resurrect them. Closing a browser tab alone does not cancel work.

The gate eagerly initializes its upstream. Enabled Context7 tools can therefore
make preparation depend on service availability; disabling both avoids opening it.
No fallback direct connection or local MCP protocol workaround is provided.

The application hosts the SDK's Node HTTP handler under Bun on a private listener,
without consuming its body through Effect middleware. The worker sees a fresh
bearer token/private URL, not upstream credentials. Operator configuration controls
upstream URLs. The gate is not host-published; Squid denies direct worker Context7.
Managed native files and their conflict requirements are documented in
[Bob integration](BOB-OPERATIONS.md#managed-native-files).

## History and privacy

Native `permission_auto_decision` records persist on turns: permission ID, opaque
tool-call ID, reported kind, match, decision. They are captured events, not a later
evaluation of current preferences. Session/turn identity scopes reused client IDs;
multiple requests sharing a tool-call ID stay distinct. Titles can arrive later;
missing tool updates neither drop decisions nor fabricate execution. Correlation
IDs may contain arguments: never display as labels, parse as identities, or log them.
At most 100 native decisions are retained per turn; overflow fails the turn.
Migration 006 initializes old turns with empty history, without backfill.

MCP `mcp_decision` records capture conversation identity at gate creation and exact
tool/server-default/disabled attribution from the SDK's `onAutoDecision`. They
claim no native turn/tool-call correlation. Ask produces memory-only pending
requests, not automatic history. Native category history stays separate.
Failed MCP history inserts retain captured records in process memory; reads retry
idempotent inserts only, never tool execution. An incomplete-history warning does
not hide pending approvals or disable other conversations.

Both histories prove only local authorization settlement—not transport delivery,
Bob receipt, tool execution, or success. Process failure before persistence can
lose events; no durable exactly-once audit or replay is promised. Empty history
does not establish a decision or lack of tools. Arguments, results, credentials,
and full SDK events are not logged. Bob's own rejection wording is not rewritten;
`end_turn` means a turn finished, not every action succeeded.

See [development](DEVELOPMENT.md) for synthetic settings, lifecycle, history,
gate/receipt, and optional live-model checks and their distinct evidence scope.
