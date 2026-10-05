import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ChatView } from "../src/chat-contract.js";
import { McpSettings } from "../src/mcp-contract.js";

const input = z.object({ cookie: z.string(), conversation: z.uuid() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const request = (path: string, body?: Record<string, string | string[] | null>) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie: input.cookie, origin: base, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
});

const settings = async () => McpSettings.parse(await (await request("/api/settings/mcp")).json());

const view = async () => ChatView.parse(await (await request(`/api/chat/${input.conversation}`)).json());

const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

let phase = "bootstrap";

try {
  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());
  const prepare = () => request(`/api/chat/${input.conversation}/prepare`, { csrf });
  const save = (disabledTools: string[]) => request("/api/settings/mcp", { csrf, disabledTools });
  assert.equal((await prepare()).status, 200);
  const token = crypto.randomUUID();
  const file = `/data/workspace/outputs/mcp-pending-${token}.txt`;

  phase = "pending-manual-call";
  assert.equal((await request(`/api/chat/${input.conversation}`, { csrf,
    prompt: `Use execute_command to run exactly: printf '${token}' > ${file}\nThis is an isolated acceptance marker. Use no other tools and do not read any files. Stop after this single command.`,
  })).status, 200);
  const deadline = Date.now() + 100_000;
  let turn = (await view()).turns.at(-1);

  while (!turn?.permission && turn?.status === "running" && Date.now() < deadline) {
    await pause(); turn = (await view()).turns.at(-1);
  }

  assert.ok(turn?.permission, "Must observe an actual pending manual permission");
  const permission = turn.permission;
  const socket = await readFile("/run/bob/mcp-snapshot.json", "utf8");
  const nativeFile = await readFile("/data/workspace/.bob/mcp.json", "utf8");
  assert.equal((await save(["query-docs"])).status, 200);
  assert.deepEqual(await settings(), { disabledTools: ["query-docs"], activeDisabledTools: [] });
  assert.equal((await prepare()).status, 200);
  assert.equal(await readFile("/run/bob/mcp-snapshot.json", "utf8"), socket);
  assert.equal(await readFile("/data/workspace/.bob/mcp.json", "utf8"), nativeFile);
  assert.equal((await view()).turns.at(-1)?.permission?.id, permission.id);
  assert.equal(await Bun.file(file).exists(), false);
  const option = permission.options.find((item) => item.kind === "allow_once");
  assert.ok(option);
  assert.equal((await request("/api/chat/approve", { csrf, turnId: turn.id, permissionId: permission.id, optionId: option.optionId })).status, 200);

  while (turn?.status === "running" && Date.now() < deadline) {
    await pause(); turn = (await view()).turns.at(-1);
  }

  assert.equal(turn?.status, "completed");
  assert.equal(await readFile(file, "utf8"), token);
  phase = "apply-after-turn";
  assert.equal((await prepare()).status, 200);
  assert.deepEqual((await settings()).activeDisabledTools, ["query-docs"]);

  // Native tool records are test evidence only, never production discovery.
  const run = async (prompt: string) => {
    assert.equal((await request(`/api/chat/${input.conversation}`, { csrf, prompt })).status, 200);
    const until = Date.now() + 100_000;
    let current = (await view()).turns.at(-1);
    const approved = new Set<string>();

    while (current?.status === "running" && Date.now() < until) {
      const pending = current.permission;

      if (pending && !approved.has(pending.id)) {
        const once = pending.options.find((item) => item.kind === "allow_once");
        assert.ok(once);
        assert.equal((await request("/api/chat/approve", { csrf, turnId: current.id, permissionId: pending.id, optionId: once.optionId })).status, 200);
        approved.add(pending.id);
      }

      await pause(); current = (await view()).turns.at(-1);
    }

    assert.equal(current?.status, "completed");
    assert.ok(current);

    return current;
  };

  phase = "disabled-and-remaining-context7";
  const disabled = await run("Use only Context7 MCP tools: attempt query-docs for /facebook/react about useState if available, then use resolve-library-id for React. No shell, files, network tools or alternatives. Report unavailable tools without working around them. Send only this public documentation query.");
  const bob = new Database("/data/bob-state/home/.bob/db/bob.db", { readonly: true });

  try {
    const messages = z.array(z.object({ data: z.string() })).parse(
      bob.query("SELECT data FROM messages WHERE role = 'user'").all());

    const userMessage = messages.map((row) => z.object({ content: z.string(), availableTools: z.array(z.string()).optional() })
      .parse(JSON.parse(row.data))).reverse().find((row) => row.content === disabled.prompt);

    assert.ok(userMessage?.availableTools, "No native offered-tool evidence for the disabled request");
    assert.equal(userMessage.availableTools.includes("mcp__context7__query-docs"), false);
    assert.ok(userMessage.availableTools.includes("mcp__context7__resolve-library-id"));

    const results = (ids: Set<string>) => z.array(z.object({ data: z.string() })).parse(
      bob.query("SELECT data FROM messages WHERE role = 'tool'").all()).map((row) =>
      z.object({ toolUsage: z.object({ signature: z.object({ id: z.string(), name: z.string(), isError: z.boolean().optional() }) }) })
        .parse(JSON.parse(row.data)).toolUsage.signature).filter((record) => ids.has(record.id) && !record.isError);

    const disabledResults = results(new Set(disabled.activity.map((item) => item.id)));
    assert.equal(disabledResults.some((item) => item.name === "mcp__context7__query-docs"), false);
    assert.ok(disabledResults.some((item) => item.name === "mcp__context7__resolve-library-id"));
    phase = "reenable-and-resume";
    assert.equal((await save([])).status, 200);
    assert.equal((await prepare()).status, 200);
    assert.deepEqual((await settings()).activeDisabledTools, []);
    const restored = await run("The worker was replaced and Context7 query-docs has been re-enabled. Use the current tool definitions, not earlier availability assumptions. Call Context7 query-docs for /facebook/react about useState. Do not use any other tools. Send only this public documentation query.");
    assert.ok(results(new Set(restored.activity.map((item) => item.id))).some((item) => item.name === "mcp__context7__query-docs"));
  } finally { bob.close(); }

  console.log("MCP live settings passed: pending manual call preserved and executed, idle replacement, remaining Context7 tool and restored documentation execution.");
} catch {
  console.error(`MCP live settings failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
