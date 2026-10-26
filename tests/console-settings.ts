import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { OpenCode } from "@camenae/opencode";
import { Effect, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { ChatLive, FoundationLive, IdentityLive } from "../src/runtime.js";
import { WelcomeQuote } from "../src/quotes-contract.js";
import { Quotes } from "../src/quotes-service.js";
import { ServerLive } from "../src/server.js";
import { DatabaseLive } from "../src/database.js";
import { ChatView, Conversation } from "../src/chat-contract.js";
import { ConsoleSettings } from "../src/console-contract.js";

// Only the external provider is replaced. Real HTTP, authentication, Postgres,
// encryption, persistent admission, packaged SDK and native worker are exercised.
const password = (await Bun.stdin.text()).trim();

const base = "http://127.0.0.1:3000";

const origin = process.env.CAMENAE_ORIGIN ?? base;

const fetchLocal = globalThis.fetch;

let forwarded = 0;

let failUpstream = false;

let expectedKey = "synthetic-console-key";

const providerRequests: { model: string; messages: string }[] = [];

let finalForwarded = 0;

const paidBetas: string[] = [];

let paidStreams = 0;

type SettingsRequest = { provider?: string; model?: string; key?: string; csrf?: string; endpoint?: string; harness?: string; prompt?: string; attachments?: string[]; turnId?: string; permissionId?: string; optionId?: string; limit?: number | null; refresh?: boolean; revision?: number };

type CompletionRequest = { model: string; max_tokens: number; max_completion_tokens?: number; store?: boolean; messages: { role: string; content: string }[]; stream?: boolean; models?: string[]; n?: number };

globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);

  if (!url.startsWith("https://opencode.ai/")) return fetchLocal(input, init);

  // The paid route: a capped Anthropic Messages request with the key in both Console header forms.
  if (url === "https://opencode.ai/inference/anthropic/v1/messages") {
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, "error");
    assert.equal(headers.get("x-api-key"), expectedKey);
    assert.equal(headers.get("authorization"), `Bearer ${expectedKey}`);
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    paidBetas.push(headers.get("anthropic-beta") ?? "");
    const body = z.object({ model: z.literal("claude-haiku-5-5"), max_tokens: z.number().max(2048), stream: z.boolean().optional() }).parse(JSON.parse(String(init?.body)));
    forwarded++;

    if (body.stream) {
      paidStreams++;

      const events = [
        ["message_start", { type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Synthetic paid answer" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
        ["message_stop", { type: "message_stop" }],
      ] as const;

      return new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    }

    return Response.json({ id: "msg_synthetic", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Synthetic paid answer" }],
      stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  }

  assert.equal(url, "https://opencode.ai/zen/v1/chat/completions");
  assert.equal(init?.redirect, "error");
  assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expectedKey}`);
  const body = z.object({ model: z.string(), max_tokens: z.number().max(2048) }).parse(JSON.parse(String(init?.body)));
  forwarded++;

  if (failUpstream) return new Response("upstream-private-error-synthetic-console-key", { status: 403 });

  const task = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })), tools: z.array(z.unknown()).optional() }).parse(JSON.parse(String(init?.body)));
  providerRequests.push({ model: body.model, messages: JSON.stringify(task.messages) });

  if (task.tools && JSON.stringify(task.messages.filter((message) => message.role === "user").at(-1)?.content).includes("revocation-task")) {
    const chunk = { id: "revoke", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0,
      delta: { tool_calls: [{ index: 0, id: "call_revoke", type: "function", function: { name: "shell", arguments: JSON.stringify({
        command: "sleep 120 & child=$!; printf '%s %s' $$ $child > console-revocation.pid; echo started > console-revocation-started; wait $child; echo late > console-revocation-finished",
      }) } }] }, finish_reason: "tool_calls" }] };

    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  }

  const delta = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta: { content: task.tools?.length ? "Console fixture answer" : "Synthetic greeting summary" }, finish_reason: null }] };

  const finish = { ...delta, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };

  return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream", "content-encoding": "gzip" } });
}, { preconnect: fetchLocal.preconnect });

const server = ServerLive.pipe(Layer.provide(ChatLive), Layer.provide(IdentityLive), Layer.provide(FoundationLive), Layer.provide(Quotes.layer));

try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    yield* Layer.build(server);
    yield* Effect.tryPromise(async () => {
      const login = await fetchLocal(base + "/auth/login", { method: "POST", redirect: "manual", headers: { origin },
        body: new URLSearchParams({ username: "owner", password }) });

      assert.equal(login.status, 303);

      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);

      const bootstrap = async () => z.object({ csrf: z.string(), readiness: z.object({ opencode: z.boolean() }),
        conversations: z.array(Conversation),
        consoleUsage: z.object({ used: z.number(), limit: z.number().nullable(), revision: z.number() }) }).parse(
        await (await fetchLocal(base + "/api/chat", { headers: { cookie } })).json());

      const { csrf } = await bootstrap();

      // The sign-in page carries a server-chosen quote with a source link; the app's quote route needs a session.
      const signIn = await (await fetchLocal(base + "/auth/login")).text();
      assert.ok(signIn.includes('class="art-quote"') && signIn.includes('rel="noopener noreferrer"'));
      assert.equal((await fetchLocal(base + "/api/quote")).status, 401);
      assert.ok(WelcomeQuote.parse(await (await fetchLocal(base + "/api/quote", { headers: { cookie } })).json()).href.startsWith("https://"));

      const post = (path: string, body: SettingsRequest, override: Record<string, string> = {}) => fetchLocal(base + path, {
        method: "POST", headers: { cookie, origin, "content-type": "application/json", ...override }, body: JSON.stringify({ csrf, ...body }),
      });

      const settings = async () => ConsoleSettings.parse(await (await fetchLocal(base + "/api/settings/opencode", { headers: { cookie } })).json());
      const input = { provider: "console", model: "longcat-2.5-preview-free", key: expectedKey };
      assert.equal((await settings()).stored, false);
      assert.equal((await bootstrap()).readiness.opencode, false);
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 0, limit: 20, revision: 0 }, "Missing credentials must not be reported as exhausted allowance");
      assert.equal((await post("/api/chat", { harness: "opencode" })).status, 503);
      assert.equal((await fetchLocal(base + "/api/settings/opencode")).status, 401);
      assert.equal((await post("/api/settings/opencode", input, { cookie: "" })).status, 401);
      assert.equal((await post("/api/settings/opencode", { ...input, csrf: "wrong" })).status, 401);
      assert.equal((await post("/api/settings/opencode", input, { origin: "https://invalid.example" })).status, 400);

      for (const invalid of [{ ...input, model: "paid-model" }, { ...input, provider: "other" }, { ...input, key: "" }, { ...input, key: "bad\r\nkey" }, { ...input, key: "bad🔑key" }, { ...input, endpoint: "https://invalid.example" }]) {
        assert.equal((await post("/api/settings/opencode", invalid)).status, 400);
      }

      assert.equal((await settings()).stored, false);
      assert.equal((await settings()).used, 0);

      const saved = await post("/api/settings/opencode", input);
      assert.equal(saved.status, 200);
      assert.equal((await saved.text()).includes(expectedKey), false);
      assert.equal((await settings()).stored, true);
      assert.equal((await bootstrap()).readiness.opencode, true);
      assert.equal(forwarded, 0, "Saving settings must not invoke a provider");
      await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const rows = z.array(z.object({ encrypted_key: z.string(), id: z.uuid() })).length(1).parse(
          yield* sql`SELECT encrypted_key, installation.id FROM console_connection CROSS JOIN installation`);

        const credentialsFile = z.string().parse(process.env.CAMENAE_CREDENTIALS_FILE);
        const credentials = yield* Effect.tryPromise(async () => z.object({ encryptionKey: z.string() }).parse(JSON.parse(await readFile(credentialsFile, "utf8"))));
        const encrypted = Buffer.from(rows[0].encrypted_key, "base64");

        const decrypt = (bytes: Buffer, context: string) => {
          const decipher = createDecipheriv("aes-256-gcm", Buffer.from(credentials.encryptionKey, "hex"), bytes.subarray(0, 12));
          decipher.setAAD(Buffer.from(context));
          decipher.setAuthTag(bytes.subarray(12, 28));

          return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
        };

        const aad = `camenae:console-key:v1:${rows[0].id}`;
        assert.equal(decrypt(encrypted, aad), expectedKey);
        assert.throws(() => decrypt(encrypted, `camenae:other-key:v1:${rows[0].id}`));
        const tampered = Buffer.from(encrypted);
        tampered[28] ^= 1;
        assert.throws(() => decrypt(tampered, aad));
      }).pipe(Effect.provide(DatabaseLive)));

      assert.equal((await post("/api/chat", { harness: "invalid" })).status, 400);

      const create = async (harness: "opencode") => {
        const response = await post("/api/chat", { harness });
        assert.equal(response.status, 200);

        return z.object({ id: z.uuid() }).parse(await response.json()).id;
      };

      const opencode = await create("opencode");

      const view = async (id: string) => ChatView.parse(await (await fetchLocal(`${base}/api/chat/${id}`, { headers: { cookie } })).json());

      assert.equal((await post(`/api/chat/${opencode}/prepare`, {})).status, 200);
      await writeFile("/data/workspace/inbox/console-attachment.txt", "Attachment receipt: quartz meadow 42");
      assert.equal((await post(`/api/chat/${opencode}`, { prompt: "synthetic greeting", attachments: ["inbox/console-attachment.txt"] })).status, 200);

      const completed = await Effect.runPromise(Effect.tryPromise(() => view(opencode)).pipe(
        Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => snapshot.turns.at(-1)?.status === "running" }), Effect.timeout("30 seconds")));

      assert.equal(completed.turns.at(-1)?.status, "completed");
      assert.equal(completed.turns.at(-1)?.answer, "Console fixture answer");
      assert.deepEqual(completed.turns.at(-1)?.attachments, [{ path: "inbox/console-attachment.txt", size: 36 }]);
      // The message names the saved file for the agent to read; its contents are not inlined.
      assert.ok(providerRequests.some((request) => request.messages.includes("inbox/console-attachment.txt")), "The attachment path did not reach the native OpenCode provider request");
      assert.ok(!providerRequests.some((request) => request.messages.includes("quartz meadow 42")), "Attachment contents must not be inlined into the prompt");

      const titled = await Effect.runPromise(Effect.tryPromise(() => view(opencode)).pipe(
        Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => snapshot.conversation.title !== "Synthetic greeting summary" }), Effect.timeout("10 seconds")));

      assert.equal(titled.conversation.toolCount, 0);
      assert.ok(titled.conversation.updatedAt >= titled.conversation.createdAt);
      assert.equal((await bootstrap()).conversations.find((item) => item.id === opencode)?.title, "Synthetic greeting summary");

      await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Simulate an older installation that has not yet consumed the native title.
        yield* sql`UPDATE conversation SET title = 'synthetic greeting' WHERE id = ${opencode}`;
      }).pipe(Effect.provide(DatabaseLive)));
      const other = await create("opencode");
      const beforeReopen = forwarded;
      assert.equal((await post(`/api/chat/${other}/prepare`, {})).status, 200);
      assert.equal((await post(`/api/chat/${opencode}/prepare`, {})).status, 200);
      assert.equal((await view(opencode)).conversation.title, "Synthetic greeting summary", "Reopening must read the existing native title");
      assert.equal(forwarded, beforeReopen, "Reading a title must not generate another provider request");

      // A real native turn on the paid model: OpenCode's Anthropic provider reaches the gateway's paid route.
      assert.equal((await post(`/api/chat/${other}/model`, { model: "claude-haiku-5-5" })).status, 200);
      assert.equal((await post(`/api/chat/${other}`, { prompt: "synthetic paid turn" })).status, 200);

      const paidTurn = await Effect.runPromise(Effect.tryPromise(() => view(other)).pipe(
        Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => snapshot.turns.at(-1)?.status === "running" }), Effect.timeout("30 seconds")));

      assert.equal(paidTurn.turns.at(-1)?.status, "completed");
      assert.equal(paidTurn.turns.at(-1)?.answer, "Synthetic paid answer");
      assert.ok(paidStreams > 0, "The paid turn did not stream through the Anthropic route");
      assert.ok(forwarded > 0, "Native request did not reach the guarded gateway");
      assert.deepEqual((await bootstrap()).consoleUsage, { used: forwarded, limit: 20, revision: 0 }, "Chat must expose actual request consumption without visiting Settings");

      if (process.argv.includes("--serve")) {
        // Local browser bridge contains no credentials in its URL or output.
        const bridge = Bun.serve({ hostname: "0.0.0.0", port: 3004, fetch: () => new Response(null, {
          status: 303, headers: { "set-cookie": `${cookie}; Path=/; HttpOnly; SameSite=Strict`, location: `${origin}/chat` },
        }) });

        process.on("SIGTERM", () => { void bridge.stop(true); });
        console.log("Console synthetic browser fixture ready.");

        return;
      }

      const gate = `http://${process.env.CAMENAE_GATEWAY_HOST}:3003`;

      const gateway = (body: CompletionRequest, path = "/v1/chat/completions", authorization = `Bearer ${process.env.CAMENAE_OPENCODE_PASSWORD}`) => fetchLocal(gate + path, {
        method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
      });

      const completion = { model: "longcat-2.5-preview-free", max_tokens: 10, messages: [{ role: "user", content: "synthetic" }], stream: true };
      const before = forwarded;
      assert.equal((await gateway(completion, "/v1/chat/completions", "invalid")).status, 401);

      for (const invalid of [{ ...completion, model: "paid-model" }, { ...completion, max_tokens: 2049 }, { ...completion, max_completion_tokens: 2049 }, { ...completion, store: true }, { ...completion, models: ["paid-model"] }, { ...completion, n: 2 }]) {
        assert.equal((await gateway(invalid)).status, 403);
      }

      assert.equal((await gateway(completion, "/v1/responses")).status, 403);
      assert.equal((await gateway(completion, "/v1/chat/completions?model=paid")).status, 403);
      assert.equal(forwarded, before, "A negative control contacted upstream");
      failUpstream = true;
      const refused = await gateway(completion);
      assert.equal(refused.status, 502);
      assert.equal((await refused.text()).includes("upstream-private-error"), false);
      failUpstream = false;

      // The paid model has its own route, and the free route never admits it.
      const paid = { model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "synthetic" }] };

      type PaidRequest = { model: string; max_tokens: number; messages: { role: string; content: string }[]; tools?: { type?: string; name: string; input_schema?: { type: string } }[];
        service_tier?: string; mcp_servers?: string[]; container?: string };

      const messages = (body: PaidRequest, beta?: string) => {
        const headers = new Headers({ authorization: `Bearer ${process.env.CAMENAE_OPENCODE_PASSWORD}`, "content-type": "application/json" });

        if (beta !== undefined) headers.set("anthropic-beta", beta);

        return fetchLocal(`${gate}/anthropic/v1/messages`, { method: "POST", body: JSON.stringify(body), headers });
      };

      const beforePaid = forwarded;
      assert.equal((await gateway({ ...completion, model: "claude-haiku-5-5" })).status, 403, "The free route must refuse the paid model");

      for (const invalid of [{ ...paid, model: "longcat-2.5-preview-free" }, { ...paid, model: "claude-opus-5-5" }, { ...paid, max_tokens: 2049 },
        { ...paid, tools: [{ type: "web_search_20250305", name: "web_search" }] }, { ...paid, service_tier: "priority" }, { ...paid, mcp_servers: [] },
        { ...paid, container: "x" }, { ...paid, messages: [{ role: "user", content: "x".repeat(400_001) }] }]) {
        assert.equal((await messages(invalid)).status, 403);
      }

      assert.equal(forwarded, beforePaid, "A refused paid request contacted upstream");
      const answered = await messages({ ...paid, tools: [{ name: "shell", input_schema: { type: "object" } }] }, "interleaved-thinking-2025-05-14, thinking-binding-controls-2026-08-01, billed-extra-2026-01-01");
      assert.equal(answered.status, 200);
      assert.equal(z.object({ content: z.array(z.object({ text: z.string() })) }).parse(await answered.json()).content[0]?.text, "Synthetic paid answer");
      assert.equal(paidBetas.at(-1), "interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01", "Known betas must pass and unknown ones must not");
      assert.ok(paidStreams > 0 && paidBetas.some((beta) => beta.includes("thinking-binding-controls-2026-08-01")), "OpenCode's own thinking beta must reach the provider");
      const nativeSettings = z.object({ CAMENAE_OPENCODE_URL: z.string(), CAMENAE_OPENCODE_PASSWORD: z.string() }).parse(process.env);

      const lifetime = async () => {
        const client = await OpenCode.connect({ baseUrl: nativeSettings.CAMENAE_OPENCODE_URL, password: nativeSettings.CAMENAE_OPENCODE_PASSWORD,
          workspace: "/data/workspace", model: { providerID: "camenae", id: "longcat-2.5-preview-free" } });

        try { return z.uuid().parse((await client.native.rpc.call({ rpcID: "camenae.runtime", method: "identity", input: {}, location: { directory: "/data/workspace" } })).output); }
        finally { await client.close(); }
      };

      const beforeRevocation = await lifetime();
      assert.equal((await post(`/api/chat/${opencode}`, { prompt: "revocation-task" })).status, 200);

      const pending = await Effect.runPromise(Effect.tryPromise(() => view(opencode)).pipe(
        Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => !snapshot.turns.at(-1)?.permission }), Effect.timeout("30 seconds")));

      const turn = pending.turns.at(-1);
      assert.ok(turn?.permission);
      assert.equal((await post(`/api/chat/${opencode}/model`, { model: "big-pickle" })).status, 409, "A model change must not race a running turn");
      assert.equal((await view(opencode)).model, "longcat-2.5-preview-free");
      assert.equal((await post("/api/chat/approve", { turnId: turn.id, permissionId: turn.permission.id, optionId: "once" })).status, 200);
      await Effect.runPromise(Effect.tryPromise(() => readFile("/data/workspace/console-revocation-started", "utf8")).pipe(
        Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 })));
      const used = (await settings()).used;
      assert.equal(used, forwarded);
      assert.equal((await post("/api/settings/opencode/remove", {})).status, 200);

      const revoked = await Effect.runPromise(Effect.tryPromise(() => view(opencode)).pipe(
        Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => snapshot.turns.at(-1)?.status === "running" }), Effect.timeout("30 seconds")));

      assert.notEqual(revoked.turns.at(-1)?.status, "completed");
      assert.equal(revoked.conversation.toolCount, 1, "Tool updates must count one native call, not each status event");
      assert.equal((await bootstrap()).conversations.find((item) => item.id === opencode)?.toolCount, 1);
      assert.equal((await gateway(completion)).status, 503);
      assert.equal((await bootstrap()).readiness.opencode, false);
      expectedKey = "synthetic-replacement-key";
      assert.equal((await post("/api/settings/opencode", { ...input, key: expectedKey })).status, 200);
      assert.equal((await settings()).used, used, "Key rotation reset the request budget");
      assert.equal((await post(`/api/chat/${opencode}/prepare`, {})).status, 200);
      assert.notEqual(await lifetime(), beforeRevocation, "Revoked native worker was reused");
      const remaining = 20 - used;
      const responses = await Promise.all(Array.from({ length: remaining + 3 }, () => gateway(completion)));
      assert.equal(responses.filter((response) => response.status === 200).length, remaining);
      assert.equal(responses.filter((response) => response.status === 503).length, 3);
      assert.equal(forwarded, 20, "Concurrent requests exceeded the persistent budget");
      assert.equal((await settings()).used, 20);
      assert.equal((await bootstrap()).readiness.opencode, false);
      assert.equal((await view(opencode)).harness, "opencode");
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 20, limit: 20, revision: 0 }, "Unavailable chat must distinguish exhausted allowance from missing connection");

      const budget = { limit: 0, refresh: false, revision: 0 };
      assert.equal((await post("/api/settings/opencode/budget", budget, { cookie: "" })).status, 401);
      assert.equal((await post("/api/settings/opencode/budget", { ...budget, csrf: "wrong" })).status, 401);
      assert.equal((await post("/api/settings/opencode/budget", budget, { origin: "https://invalid.example" })).status, 400);

      for (const limit of [-1, 1.5, 2147483648]) {
        assert.equal((await post("/api/settings/opencode/budget", { ...budget, limit })).status, 400);
      }

      assert.equal((await post("/api/settings/opencode/budget", budget)).status, 200);
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 20, limit: 0, revision: 1 });
      assert.equal((await gateway(completion)).status, 503);
      assert.equal((await post("/api/settings/opencode/budget", { limit: 3, refresh: true, revision: 1 })).status, 200);
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 0, limit: 3, revision: 2 });
      assert.equal((await bootstrap()).readiness.opencode, true);
      const refreshed = await Promise.all(Array.from({ length: 5 }, () => gateway(completion)));
      assert.equal(refreshed.filter((response) => response.status === 200).length, 3);
      assert.equal(refreshed.filter((response) => response.status === 503).length, 2);
      assert.equal((await post("/api/settings/opencode/budget", { limit: 3, refresh: true, revision: 1 })).status, 409, "Retrying an old refresh must not grant more requests");
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 3, limit: 3, revision: 2 });
      assert.equal((await post("/api/settings/opencode/budget", { limit: null, refresh: false, revision: 2 })).status, 200);
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 3, limit: null, revision: 3 });
      const uncapped = forwarded;
      assert.equal((await messages(paid)).status, 503, "Without a request cap a paid model must be refused");
      assert.equal(forwarded, uncapped, "An uncapped paid request contacted upstream");
      assert.deepEqual((await bootstrap()).consoleUsage, { used: 3, limit: null, revision: 3 }, "A refused paid request must not consume allowance");
      assert.equal((await bootstrap()).readiness.opencode, true);

      const nativeId = () => Effect.runPromise(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        return z.array(z.object({ native_id: z.string() })).length(1).parse(yield* sql`SELECT native_id FROM conversation WHERE id = ${opencode}`)[0].native_id;
      }).pipe(Effect.provide(DatabaseLive)));

      const originalNativeId = await nativeId();
      assert.equal((await post(`/api/chat/${opencode}/model`, { model: "big-pickle", csrf: "wrong" })).status, 401);

      for (const model of ["paid-model", "jev-1.13-free", "muse-spark-1.3-contributor-free"]) {
        assert.equal((await post(`/api/chat/${opencode}/model`, { model })).status, 400);
        assert.equal((await gateway({ ...completion, model })).status, 403);
      }

      for (const model of ["big-pickle", "fledge-alpha-free", "ling-3.0-flash-fin-free", "ling-3.1-flash-free", "longcat-2.5-preview-free",
        "mimo-v2.6-flash-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "space-bunny-free"]) {
        const beforeSelection: number = forwarded;
        assert.equal((await post(`/api/chat/${opencode}/model`, { model })).status, 200);
        assert.equal((await view(opencode)).model, model);
        assert.equal(forwarded, beforeSelection, "Selecting a model must not spend a request");
        const prompt = `model-selection-${model}`;

        assert.equal((await post(`/api/chat/${opencode}`, { prompt })).status, 200);

        const result = await Effect.runPromise(Effect.tryPromise(() => view(opencode)).pipe(
          Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => snapshot.turns.at(-1)?.status === "running" }), Effect.timeout("30 seconds")));

        assert.equal(result.turns.at(-1)?.status, "completed", `Native turn failed after selecting ${model}`);
        assert.equal(result.turns.at(-1)?.answer, "Console fixture answer");
        const receipt = providerRequests.filter((request) => request.messages.includes(prompt)).at(-1);
        assert.ok(receipt);
        assert.equal(receipt.model, model, "The native request ignored the selected model");
        assert.ok(receipt.messages.includes("synthetic greeting"), "Switching lost the existing native history");
        assert.equal(await nativeId(), originalNativeId);
      }

      assert.equal((await view(opencode)).harness, "opencode");
      await Effect.runPromise(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const row = z.array(z.object({ requests_used: z.number(), requests_baseline: z.number() })).length(1).parse(
          yield* sql`SELECT requests_used, requests_baseline FROM console_connection`)[0];

        assert.equal(row.requests_used, forwarded, "Refreshing must preserve the lifetime request count");
        assert.equal(row.requests_baseline, 20);
      }).pipe(Effect.provide(DatabaseLive)));
      assert.equal((await post("/api/settings/opencode/budget", { limit: forwarded - 20, refresh: false, revision: 3 })).status, 200);
      finalForwarded = forwarded;
      console.log("Console settings, encryption, native free-only gateway, selection and concurrent budget checks passed.");
    });

    if (process.argv.includes("--serve")) yield* Effect.never;
  })));

  if (!process.argv.includes("--serve")) {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* Layer.build(server);
      yield* Effect.tryPromise(async () => {
        await Effect.runPromise(Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          const rows = z.array(z.object({ requests_used: z.number(), requests_baseline: z.number(), requests_limit: z.number(), budget_revision: z.number() })).length(1).parse(
            yield* sql`SELECT requests_used, requests_baseline, requests_limit, budget_revision FROM console_connection`);

          assert.deepEqual(rows[0], { requests_used: finalForwarded, requests_baseline: 20, requests_limit: finalForwarded - 20, budget_revision: 4 });
        }).pipe(Effect.provide(DatabaseLive)));

        const response = await fetchLocal(`http://${process.env.CAMENAE_GATEWAY_HOST}:3003/v1/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${process.env.CAMENAE_OPENCODE_PASSWORD}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "longcat-2.5-preview-free", max_tokens: 10, messages: [{ role: "user", content: "after restart" }] }),
        });

        assert.equal(response.status, 503, "Restart reset the request budget");
        assert.equal(forwarded, finalForwarded);
      });
    })));
  }
} finally { globalThis.fetch = fetchLocal; }
