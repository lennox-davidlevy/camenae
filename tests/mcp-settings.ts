import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";
import { McpSettings } from "../src/mcp-contract.js";

const mode = z.enum(["exercise", "retained", "failure", "recover"]).parse(process.argv[2]);

const input = z.object({ cookie: z.string(), conversation: z.uuid().optional() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

type SettingsRequest = { csrf: string; disabledTools?: string[]; permissions?: { context7: { fallback: string; tools: Record<string, string> } }; server?: string };

const request = (path: string, body?: SettingsRequest, cookie = input.cookie) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie, origin: base, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
});

const settings = async () => McpSettings.parse(await (await request("/api/settings/mcp")).json());

const nativeId = (id: string) => Effect.runPromise(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = z.array(z.object({ native_id: z.string() })).length(1).parse(
    yield* sql`SELECT native_id FROM conversation WHERE id = ${id}`);

  return rows[0].native_id;
}).pipe(Effect.provide(DatabaseLive)));

let phase = "bootstrap";

try {
  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());
  const conversation = input.conversation ?? z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id;
  const prepare = () => request(`/api/chat/${conversation}/prepare`, { csrf });
  const permissions = { context7: { fallback: "allow", tools: { "query-docs": "deny" } } };
  const save = (disabledTools: string[], token = csrf, cookie = input.cookie) => request("/api/settings/mcp", { csrf: token, disabledTools, permissions }, cookie);

  if (mode === "exercise") {
    phase = "authorization-and-validation";
    const before = await settings();
    assert.equal((await request("/api/settings/mcp", undefined, "")).status, 401);
    assert.equal((await save(["query-docs"], csrf, "")).status, 401);
    assert.equal((await save(["query-docs"], "wrong")).status, 401);
    assert.equal((await save(["mcp__context7__query-docs"])).status, 400);
    assert.equal((await save(["query-docs", "query-docs"])).status, 400);
    assert.equal((await request("/api/settings/mcp", { csrf, disabledTools: [], server: "other-user" })).status, 400);
    assert.deepEqual(await settings(), before);

    phase = "prepare-and-save";
    assert.equal((await prepare()).status, 200);
    const originalId = await nativeId(conversation);
    assert.deepEqual((await settings()).activeDisabledTools, []);
    assert.equal((await save(["query-docs"])).status, 200);
    assert.deepEqual(await settings(), { disabledTools: ["query-docs"], activeDisabledTools: [], permissions,
      activePermissions: { context7: { fallback: "ask", tools: {} } } });

    phase = "replace-and-resume";
    assert.equal((await prepare()).status, 200);
    assert.equal(await nativeId(conversation), originalId);
    assert.deepEqual(await settings(), { disabledTools: ["query-docs"], activeDisabledTools: ["query-docs"], permissions, activePermissions: permissions });

    const config = z.object({ mcpServers: z.record(z.string(), z.object({ disabledTools: z.array(z.string()).optional(),
      alwaysAllow: z.array(z.string()), url: z.string() })) })
      .parse(JSON.parse(await readFile("/data/workspace/.bob/mcp.json", "utf8")));

    assert.deepEqual(Object.keys(config.mcpServers), ["context7"]);
    assert.deepEqual(config.mcpServers.context7.disabledTools, ["query-docs"]);
    assert.deepEqual(config.mcpServers.context7.alwaysAllow, ["resolve-library-id", "query-docs"]);
    assert.ok(!config.mcpServers.context7.url.includes("context7.com"), "Bob received a direct upstream route");
    const fresh = z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id;
    assert.equal((await request(`/api/chat/${fresh}/prepare`, { csrf })).status, 200);
    assert.deepEqual((await settings()).activePermissions, permissions);
    assert.equal((await prepare()).status, 200);
    assert.equal(await nativeId(conversation), originalId);
  } else if (mode === "failure") {
    phase = "preserved-unmanaged-file";
    const filename = z.enum(["mcp.json", "custom_modes.yaml"]).parse(process.argv[3] ?? "mcp.json");
    const path = `/data/workspace/.bob/${filename}`;
    const file = await readFile(path, "utf8");
    assert.equal((await save([])).status, 200);
    assert.equal((await prepare()).status, 503);
    assert.deepEqual(await settings(), { disabledTools: [], activeDisabledTools: null, permissions, activePermissions: null });
    assert.equal(await readFile(path, "utf8"), file);
  } else {
    phase = mode;
    const expected = mode === "retained" ? ["query-docs"] : [];
    assert.deepEqual((await settings()).disabledTools, expected);
    const originalId = await nativeId(conversation);
    assert.equal((await prepare()).status, 200);
    assert.deepEqual((await settings()).activeDisabledTools, expected);
    assert.deepEqual((await settings()).activePermissions, permissions);
    assert.equal(await nativeId(conversation), originalId);
  }

  console.log(JSON.stringify({ cookie: input.cookie, conversation }));
  console.error(`MCP settings ${mode} passed.`);
} catch {
  console.error(`MCP settings ${mode} failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
