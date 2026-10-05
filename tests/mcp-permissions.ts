import assert from "node:assert/strict";
import { Effect, Exit, Schedule, Scope } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";
import { McpPermissions, type McpBinding } from "../src/mcp-permissions.js";

// Real HTTP streaming/cancellation and Postgres, with independently recorded
// upstream executions. No inference or live credentials. Run with app stopped.
const Definition = z.object({ url: z.string(), headers: z.array(z.object({ name: z.string(), value: z.string() })) });

async function protocol(binding: McpBinding) {
  const server = Definition.parse(binding.servers[0]);
  let session: string | null = null;
  let sequence = 0;

  type Params = { protocolVersion?: string; capabilities?: Record<string, never>; clientInfo?: { name: string; version: string }; name?: string; arguments?: { token: string } };

  const send = async (method: string, params: Params, signal?: AbortSignal, notification = false) => {
    const headers = new Headers(Object.fromEntries(server.headers.map(({ name, value }) => [name, value])));
    headers.set("content-type", "application/json"); headers.set("accept", "application/json, text/event-stream");

    if (session) headers.set("mcp-session-id", session);

    const response = await fetch(server.url, { method: "POST", signal,
      headers, body: JSON.stringify({ jsonrpc: "2.0", id: notification ? undefined : ++sequence, method, params }),
    });

    assert.ok(response.ok, `MCP HTTP ${response.status}`);
    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();

    if (!text) return null;

    const data = text.startsWith("event:") || text.startsWith("data:")
      ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) : text;

    return z.object({ result: z.json().optional(), error: z.json().optional() }).parse(JSON.parse(data ?? "null"));
  };

  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "camenae-check", version: "1" } });
  await send("notifications/initialized", {}, undefined, true);

  return { send, url: server.url };
}

let phase = "setup";

try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const mcp = yield* McpPermissions;
    const sql = yield* SqlClient.SqlClient;
    const conversation = crypto.randomUUID();
    yield* sql`INSERT INTO conversation (id, title) VALUES (${conversation}, 'MCP protocol fixture')`;
    const lifetime = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(lifetime, Exit.void));

    const binding = yield* mcp.open(conversation, ["query-docs"], {
      context7: { fallback: "allow", tools: { "query-docs": "allow" } },
    }).pipe(Scope.provide(lifetime));

    const client = yield* Effect.promise(() => protocol(binding));
    phase = "allow-and-disabled";
    const marker = crypto.randomUUID();
    const listed = yield* Effect.promise(() => client.send("tools/list", {}));
    assert.deepEqual(z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(listed?.result).tools.map((tool) => tool.name), ["resolve-library-id"]);
    yield* Effect.promise(() => client.send("tools/call", { name: "resolve-library-id", arguments: { token: `${marker}-allow` } }));
    yield* Effect.promise(() => client.send("tools/call", { name: "query-docs", arguments: { token: `${marker}-disabled` } }));
    const first = yield* mcp.view(conversation);
    assert.deepEqual(first.decisions.map(({ toolName, match, decision }) => ({ toolName, match, decision })), [
      { toolName: "resolve-library-id", match: "fallback", decision: "allow" },
      { toolName: "query-docs", match: "disabled", decision: "deny" },
    ]);
    assert.deepEqual(first.pending, []);
    yield* Scope.close(lifetime, Exit.void);
    assert.equal((yield* Effect.promise(() => fetch(client.url))).status, 404);

    phase = "replacement-deny-and-concurrent-ask";
    const replacement = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(replacement, Exit.void));

    const nextBinding = yield* mcp.open(conversation, [], {
      context7: { fallback: "ask", tools: { "query-docs": "deny" } },
    }).pipe(Scope.provide(replacement));

    const next = yield* Effect.promise(() => protocol(nextBinding));
    assert.notEqual(next.url, client.url);
    const tools = yield* Effect.promise(() => next.send("tools/list", {}));
    assert.equal(z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(tools?.result).tools.length, 2, "Deny hid an enabled tool");
    yield* Effect.promise(() => next.send("tools/call", { name: "query-docs", arguments: { token: `${marker}-deny` } }));
    const controller = new AbortController();
    const cancelled = next.send("tools/call", { name: "resolve-library-id", arguments: { token: `${marker}-cancelled` } }, controller.signal).catch(() => null);
    const allowed = next.send("tools/call", { name: "resolve-library-id", arguments: { token: `${marker}-asked` } });

    const waitPending = (count: number) => mcp.view(conversation).pipe(
      Effect.repeat({ schedule: Schedule.spaced("20 millis"), while: (value) => value.pending.length !== count }), Effect.timeout("5 seconds"),
    );

    const concurrent = yield* waitPending(2);
    assert.equal(new Set(concurrent.pending.map((request) => request.permissionId)).size, 2);
    assert.equal(concurrent.decisions.length, 3, "Ask fabricated automatic decisions");
    controller.abort();
    yield* Effect.promise(() => cancelled);
    const remaining = yield* waitPending(1);
    const expired = concurrent.pending.find((request) => request.permissionId !== remaining.pending[0].permissionId);
    assert.ok(expired);
    assert.ok(Exit.isFailure(yield* mcp.approve(conversation, expired.permissionId, "allow").pipe(Effect.exit)), "Late approval was accepted");
    assert.ok(Exit.isFailure(yield* mcp.approve(crypto.randomUUID(), remaining.pending[0].permissionId, "allow").pipe(Effect.exit)), "Cross-conversation approval accepted");
    yield* mcp.approve(conversation, remaining.pending[0].permissionId, "allow");
    yield* Effect.promise(() => allowed);

    phase = "replacement-cleanup";
    const closing = next.send("tools/call", { name: "resolve-library-id", arguments: { token: `${marker}-closed` } }).catch(() => null);
    const beforeClose = yield* waitPending(1);
    yield* Scope.close(replacement, Exit.void);
    yield* Effect.promise(() => closing);
    assert.equal((yield* mcp.view(conversation)).pending.length, 0);
    assert.ok(Exit.isFailure(yield* mcp.approve(conversation, beforeClose.pending[0].permissionId, "allow").pipe(Effect.exit)));

    phase = "independent-execution-receipts";

    const receipts = yield* Effect.promise(async () => z.array(z.object({ name: z.string(), token: z.string() }))
      .parse(await (await fetch("http://mcp-fixture:3002/receipts")).json()));

    assert.deepEqual(receipts.flatMap((receipt) => receipt.token.startsWith(marker) ? [receipt.token] : []), [`${marker}-allow`, `${marker}-asked`]);
    const history = yield* mcp.view(conversation);
    assert.equal(history.decisions.at(-1)?.match, "tool");
    assert.equal(history.decisions.at(-1)?.decision, "deny");
    assert.equal(history.decisions.length, 3);

    phase = "history-write-recovery";
    const recoveryBinding = yield* mcp.open(conversation, [], { context7: { fallback: "allow", tools: {} } });
    const recovery = yield* Effect.promise(() => protocol(recoveryBinding));
    // Fault the real INSERT boundary, not a fake store. SELECT and pending
    // approvals remain usable. This disposable project has no user data.
    yield* sql`CREATE FUNCTION reject_mcp_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic insert failure'; END $$`;
    yield* sql`CREATE TRIGGER reject_mcp_fixture BEFORE INSERT ON mcp_decision
      FOR EACH ROW EXECUTE FUNCTION reject_mcp_fixture()`;
    yield* Effect.promise(() => recovery.send("tools/call", { name: "resolve-library-id", arguments: { token: `${marker}-recovery` } }));
    assert.equal((yield* mcp.view(conversation)).incomplete, true);
    assert.equal((yield* mcp.view(crypto.randomUUID())).incomplete, false, "One failed insert disabled another conversation");
    yield* sql`DROP TRIGGER reject_mcp_fixture ON mcp_decision`;
    yield* sql`DROP FUNCTION reject_mcp_fixture()`;
    const recovered = yield* mcp.view(conversation);
    assert.equal(recovered.incomplete, false);
    assert.equal(recovered.decisions.length, 4, "Captured attribution was lost or duplicated after recovery");
  })).pipe(Effect.provide(McpPermissions.layer), Effect.provide(DatabaseLive), Effect.timeout("30 seconds")));
  console.log("MCP permissions passed: HTTP streaming, exact policy, disabled precedence, receipts, concurrent Ask, disconnect cancellation, late answers, scope cleanup, real history.");
} catch {
  console.error(`MCP permissions failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
