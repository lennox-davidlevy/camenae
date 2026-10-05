import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";
import { ApprovalSettings } from "../src/approval-contract.js";

const mode = z.enum(["exercise", "retained"]).parse(process.argv[2]);

const { cookie, conversation } = z.object({ cookie: z.string(), conversation: z.uuid() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

interface RequestBody { csrf: string; policy?: { kinds: Record<string, string>; fallback: string }; workspace?: string }

const request = (path: string, body?: RequestBody, session = cookie, origin = base) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie: session, origin, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
});

const allAsk = { kinds: { edit: "ask", delete: "ask", execute: "ask", search: "ask", fetch: "ask" }, fallback: "ask" };

const savedPolicy = { kinds: { edit: "deny", delete: "deny", execute: "deny", search: "allow", fetch: "ask" }, fallback: "deny" };

const settings = async () => ApprovalSettings.parse(await (await request("/api/settings/approvals")).json());

const database = <A,>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) => Effect.runPromise(effect.pipe(Effect.provide(DatabaseLive)));

let phase = "bootstrap";

try {
  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());
  const post = (body: RequestBody, session = cookie, origin = base) => request("/api/settings/approvals", body, session, origin);
  const mcpBefore = await (await request("/api/settings/mcp")).json();
  const socketBefore = await lstat("/run/bob/gateway.sock");

  if (mode === "exercise") {
    phase = "default-and-guards";
    assert.deepEqual(await settings(), { saved: allAsk, active: allAsk });
    assert.equal((await request("/api/settings/approvals", undefined, "")).status, 401);
    assert.equal((await post({ csrf, policy: savedPolicy }, "")).status, 401);
    assert.equal((await post({ csrf: "wrong", policy: savedPolicy })).status, 401);
    assert.equal((await post({ csrf, policy: savedPolicy }, cookie, "https://invalid.example")).status, 400);

    for (const policy of [
      { ...allAsk, fallback: "allow" },
      { ...allAsk, kinds: { ...allAsk.kinds, execute: "always" } },
      { ...allAsk, kinds: { ...allAsk.kinds, "mcp__context7__query-docs": "allow" } },
      { ...allAsk, kinds: { execute: "allow" } },
    ]) assert.equal((await post({ csrf, policy })).status, 400);

    assert.equal((await post({ csrf, policy: savedPolicy, workspace: "another-owner" })).status, 400);
    assert.deepEqual(await settings(), { saved: allAsk, active: allAsk });
    phase = "live-install-without-replacement";
    assert.equal((await post({ csrf, policy: savedPolicy })).status, 200);
    assert.deepEqual(await settings(), { saved: savedPolicy, active: savedPolicy });
    const socketAfter = await lstat("/run/bob/gateway.sock");
    assert.equal(`${socketAfter.ino}:${socketAfter.birthtimeMs}`, `${socketBefore.ino}:${socketBefore.birthtimeMs}`);

    phase = "failed-save-does-not-install";
    await database(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE FUNCTION fail_approval_save() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic approval storage failure'; END $$`;
      yield* sql`CREATE TRIGGER approval_save_failure BEFORE UPDATE ON approval_settings FOR EACH ROW EXECUTE FUNCTION fail_approval_save()`;
    }));

    try {
      assert.equal((await post({ csrf, policy: allAsk })).status, 503);
      assert.deepEqual(await settings(), { saved: savedPolicy, active: savedPolicy });
    } finally {
      await database(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DROP TRIGGER approval_save_failure ON approval_settings`;
        yield* sql`DROP FUNCTION fail_approval_save()`;
      }));
    }
  } else {
    phase = "persisted-and-reinstalled";
    assert.deepEqual(await settings(), { saved: savedPolicy, active: savedPolicy });
    assert.equal((await request(`/api/chat/${conversation}/prepare`, { csrf })).status, 200);
    assert.deepEqual(await settings(), { saved: savedPolicy, active: savedPolicy });
    assert.equal((await post({ csrf, policy: allAsk })).status, 200);
    assert.deepEqual(await settings(), { saved: allAsk, active: allAsk });
  }

  assert.deepEqual(await (await request("/api/settings/mcp")).json(), mcpBefore, "Approval changes changed MCP availability");
  console.log(`Approval settings ${mode} passed.`);
} catch {
  console.error(`Approval settings ${mode} failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
