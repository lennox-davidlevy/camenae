import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ChatView } from "../src/chat-contract.js";

const mode = z.enum(["seed", "followup", "resume"]).parse(process.argv[2]);

const input = z.object({ password: z.string().optional(), apiKey: z.string().optional(), cookie: z.string().optional(), conversation: z.string().optional(), word: z.string().optional() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

let cookie = input.cookie ?? "";

let phase = "login";

const get = (path: string) => fetch(base + path, { headers: { cookie }, signal: AbortSignal.timeout(180_000) });

const form = (path: string, fields: URLSearchParams) => fetch(base + path, {
  method: "POST", headers: { cookie, origin: base }, body: fields, redirect: "manual",
});

const post = (path: string, fields: Record<string, string | null>) => fetch(base + path, {
  method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(fields),
});

try {
  if (mode === "seed") {
    assert.ok(input.password && input.apiKey);
    const login = await form("/auth/login", new URLSearchParams({ username: "owner", password: input.password }));
    assert.equal(login.status, 303);
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  const bootstrap = z.object({ csrf: z.string() }).parse(await (await get("/api/chat")).json());
  const csrf = bootstrap.csrf;

  if (mode === "seed") {
    phase = "save-key";
    assert.ok(input.apiKey);
    assert.equal((await form("/connection/bob", new URLSearchParams({ csrf, key: input.apiKey }))).status, 303);
  }

  const conversation = input.conversation ?? z.object({ id: z.uuid() }).parse(await (await post("/api/chat", { csrf })).json()).id;

  const word = input.word ?? `orchid-${crypto.randomUUID()}`;

  const prompt = mode === "seed"
    ? `Remember this exact private test word for our conversation: ${word}. Write that exact word into outputs/acceptance.txt in your workspace using a tool. Then use Context7 resolve-library-id for React and query-docs to look up React useState, and briefly explain it. Include the test word in your final reply. Send only the public library name and documentation question to Context7, never the test word or file contents. Do not read other files or access other services.`
    : "Without reading files, recall the exact private test word I gave you in our first turn. Also use Context7 query-docs to look up React useEffect cleanup and briefly explain it. Include the test word in your final reply. Send only the public library documentation question to Context7, never the test word or conversation contents. Do not access other services.";

  phase = "prepare";
  assert.equal((await post(`/api/chat/${conversation}/prepare`, { csrf })).status, 200);

  phase = "start";
  const started = await post(`/api/chat/${conversation}`, { csrf, prompt });
  assert.equal(started.status, 200);

  const conflict = await post(`/api/chat/${conversation}`, { csrf, prompt: "Do not execute this rejected concurrent request." });
  assert.equal(conflict.status, 409);

  if (mode === "seed") {
    phase = "prepare-during-turn";
    assert.equal((await post(`/api/chat/${conversation}/prepare`, { csrf })).status, 200);
    const other = z.object({ id: z.uuid() }).parse(await (await post("/api/chat", { csrf })).json()).id;
    assert.equal((await post(`/api/chat/${other}/prepare`, { csrf })).status, 409);
  }

  phase = "stream";
  const stream = await get(`/api/chat/${conversation}/events`);
  assert.equal(stream.status, 200);
  assert.ok(stream.body);
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let final: ChatView | undefined;
  const answered = new Set<string>();

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) break;

    pending += chunk.value;
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      const snapshot = ChatView.parse(JSON.parse(frame.slice(6)));
      final = snapshot;
      const turn = snapshot.turns.at(-1);
      const permission = turn?.permission;

      for (const request of snapshot.mcp.pending) {
        if (answered.has(request.permissionId)) continue;
        answered.add(request.permissionId);
        assert.equal((await post(`/api/chat/${conversation}/mcp-approve`, {
          csrf, permissionId: request.permissionId, decision: "allow",
        })).status, 200);
      }

      if (turn && permission && !answered.has(permission.id)) {
        answered.add(permission.id);
        assert.ok(permission.options.every((item) => item.kind === "allow_once" || item.kind === "reject_once"), "Native Always choices bypass persistent preferences");
        const option = permission.options.find((item) => item.kind === "allow_once");
        assert.ok(option);
        assert.equal((await post("/api/chat/approve", { csrf, turnId: turn.id, permissionId: permission.id, optionId: option.optionId })).status, 200);
      }
    }
  }

  phase = "result";
  const turn = final?.turns.at(-1);
  assert.equal(turn?.status, "completed");
  assert.ok(turn?.answer.includes(word));
  assert.ok(answered.size > 0, "Default Ask must remain manual on follow-up and resumed sessions");

  phase = "context7-tools";
  // Bob 2.0.5's native persisted results are the oracle, not spoofable UI titles
  // or the model's claim that it consulted documentation. Read only disposable state.
  const bob = new Database("/data/bob-state/home/.bob/db/bob.db", { readonly: true });

  try {
    const records = z.array(z.object({ data: z.string() })).parse(bob.query("SELECT data FROM messages WHERE role = 'tool'").all());

    const result = z.object({ content: z.string(), toolUsage: z.object({ signature: z.object({
      id: z.string(), name: z.string(), isError: z.boolean().optional(),
    }) }) });

    const completed = new Set(turn.activity.filter((activity) => activity.status === "completed").map((activity) => activity.id));

    const tools = records.map((record) => result.parse(JSON.parse(record.data)))
      .filter((record) => completed.has(record.toolUsage.signature.id) && !record.toolUsage.signature.isError);

    const docs = tools.find((record) => record.toolUsage.signature.name === "mcp__context7__query-docs");
    assert.ok(docs, "No successful native Context7 documentation tool result for this turn");
    assert.match(docs.content, mode === "seed" ? /useState/ : /useEffect/);
    assert.match(docs.content, /https:\/\//, "Documentation result has no source URL");

    if (mode === "seed") {
      const library = tools.find((record) => record.toolUsage.signature.name === "mcp__context7__resolve-library-id");
      assert.ok(library, "No successful native Context7 library resolution for this turn");
      assert.match(library.content, /react/i);
    }
  } finally { bob.close(); }

  if (mode === "seed") assert.equal((await readFile("/data/workspace/outputs/acceptance.txt", "utf8")).trim(), word);

  // Only opaque test session state and synthetic data leave this process, never the key.
  console.log(JSON.stringify({ cookie, conversation, word }));
  console.error(`Live chat ${mode} passed.`);
} catch {
  console.error(`Live chat failed at ${phase}; no request or provider payload logged.`);
  process.exitCode = 1;
}
