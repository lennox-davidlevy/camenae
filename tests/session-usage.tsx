import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { BobEvent, BobRemoteClient } from "@camenae/bob";
import { Config, Effect, Layer, Match } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { HarnessRuntime } from "../src/harness-runtime.js";
import { Chat } from "../src/chat.js";
import { ChatView, type SessionUsage } from "../src/chat-contract.js";
import { DatabaseLive } from "../src/database.js";
import { McpPermissions } from "../src/mcp-permissions.js";
import { FoundationLive, IdentityLive } from "../src/runtime.js";
import { ServerLive } from "../src/server.js";
import { SessionUsagePanel } from "../src/ui/session-usage.js";

// Disposable Docker project only. The real Chat service, Postgres, HTTP/SSE,
// boundary decoder, and UI consume controlled SDK events. No Bob/provider calls.
// This is the consumer contract owner; SDK tests own native reporting correctness.
// Run tests/mcp-upstream.ts alongside it and set CAMENAE_CONTEXT7_URL to that
// loopback fixture. stdin is the disposable account's login.txt.
const password = (await Bun.stdin.text()).trim();

const reported: SessionUsage = { version: 1, contextTokens: 53000, contextWindow: 200000,
  maxOutputTokens: 16000, compactionThreshold: 0.9, autoCompact: true, bobcoins: 12.34 };

const unknown: SessionUsage = { ...reported, contextTokens: null, contextWindow: null, maxOutputTokens: null,
  compactionThreshold: null, bobcoins: null };

const unexpected = () => { throw new Error("Unexpected Gateway operation"); };

function gatewayFixture() {
  const listeners = new Set<(event: BobEvent) => void>();
  const retired: ((event: BobEvent) => void)[] = [];
  let nativeId = "";

  const emit = (usage: Record<string, number | boolean | string | null>, sessionId = nativeId, metadataOnly = false, late = false) => {
    const event: BobEvent = { type: "session_update", notification: { sessionId, update: metadataOnly
      ? { sessionUpdate: "session_info_update", _meta: { "bob-gateway/usage": usage } }
      : { sessionUpdate: "usage_update", used: 53000, size: 200000, _meta: { "bob-gateway/usage": usage } } } };

    for (const listener of late ? retired : listeners) listener(event);
  };

  const client: BobRemoteClient = {
    workspace: "/data/workspace", initializeResult: { protocolVersion: 1, agentCapabilities: {} },
    authenticate: unexpected, listSessions: unexpected, loadSession: unexpected,
    deleteSession: unexpected, setMode: async () => ({}), setConfigOption: unexpected, run: unexpected,
    newSession: async () => {
      nativeId = crypto.randomUUID();
      emit(reported); // Before newSession returns its ID: consumer must subscribe first.

      return { sessionId: nativeId };
    },
    resumeSession: async (id) => {
      nativeId = id;
      emit({ ...unknown, bobcoins: 12.34 }, nativeId, true);

      return {};
    },
    closeSession: async () => {}, cancel: unexpected, setApprovalPolicy: () => {}, respondToPermission: unexpected,
    prompt: async (_id, parts) => {
      const text = parts.find((part) => part.type === "text")?.text;
      emit(Match.value(text).pipe(
        Match.when("unknown", () => unknown),
        Match.when("compact", () => ({ ...reported, contextTokens: 10000, bobcoins: 15 })),
        Match.when("over-limit", () => ({ ...reported, contextTokens: 220000 })),
        Match.orElse(() => reported),
      ));

      return { stopReason: "end_turn" };
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => { retired.push(listener); listeners.delete(listener); };
    },
    disconnect: async () => { assert.equal(listeners.size, 0, "Connection subscription leaked at teardown"); },
  };

  return { client, emit, listeners };
}

const connections: ReturnType<typeof gatewayFixture>[] = [];

const fixtureRuntime = Layer.succeed(HarnessRuntime, HarnessRuntime.of({
  stage: () => Effect.void,
  connect: () => Effect.acquireRelease(Effect.sync(() => {
    const connection = gatewayFixture();
    connections.push(connection);

    return connection.client;
  }), (client) => Effect.promise(() => client.disconnect())),
}));

const chatLayer = Chat.layer.pipe(Layer.provide(fixtureRuntime), Layer.provide(McpPermissions.layer),
  Layer.provide(IdentityLive), Layer.provide(DatabaseLive));

const server = ServerLive.pipe(Layer.provide(chatLayer), Layer.provide(IdentityLive), Layer.provide(FoundationLive));

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  yield* Layer.build(server);
  const origin = yield* Config.String("CAMENAE_ORIGIN").pipe(Config.withDefault("http://127.0.0.1:3000"));
  yield* Effect.promise(async () => {
    const base = "http://127.0.0.1:3000";

    const login = await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { origin },
      body: new URLSearchParams({ username: "owner", password }) });

    assert.equal(login.status, 303);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const request = (path: string, body?: { csrf: string }) => fetch(base + path, { method: body ? "POST" : "GET",
      headers: { cookie, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000) });

    const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());

    const saved = await fetch(base + "/connection/bob", { method: "POST", redirect: "manual", headers: { cookie, origin },
      body: new URLSearchParams({ csrf, key: "synthetic-usage-fixture-never-sent-to-a-provider" }) });

    assert.equal(saved.status, 303);
    const create = async () => z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id;
    const prepare = async (id: string) => { assert.equal((await request(`/api/chat/${id}/prepare`, { csrf })).status, 200); };

    const view = async (id: string) => ChatView.parse(await (await request(`/api/chat/${id}`)).json());
    const first = await create();
    assert.equal((await fetch(`${base}/api/chat/${first}`)).status, 401);
    assert.equal((await view(first)).usage, null);

    // Open before preparation: the same idle stream must deliver async usage,
    // rather than closing because the conversation has no running turn.
    const response = await request(`/api/chat/${first}/events`);
    assert.ok(response.body);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    const next = async () => {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, "Idle usage stream ended before its next report");
        buffer += chunk.value;
      }

      const end = buffer.indexOf("\n\n");
      const data = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);

      return ChatView.parse(JSON.parse(data.slice(6)));
    };

    assert.equal((await next()).usage, null);
    await prepare(first);
    const original = connections[0];
    assert.ok(original);
    assert.deepEqual((await view(first)).usage, reported, "Pre-response snapshot was lost");
    original.emit({ ...reported, contextTokens: 40000, bobcoins: 13, futureField: true }, undefined, true);
    let streamed = await next();

    while (streamed.usage?.bobcoins !== 13) streamed = await next();
    assert.deepEqual(streamed.usage, { ...reported, contextTokens: 40000, bobcoins: 13 });
    await reader.cancel();

    for (const invalid of [{ ...reported, version: 2 }, { ...reported, contextTokens: "53000" },
      { ...reported, compactionThreshold: 90 }, { version: 1 }]) {
      original.emit(invalid);
      assert.deepEqual((await view(first)).usage, streamed.usage, "Invalid/unsupported metadata replaced a valid report");
    }

    original.emit({ ...reported, bobcoins: 999 }, "unowned-session");
    assert.deepEqual((await view(first)).usage, streamed.usage, "Unowned session contaminated current usage");
    original.emit({ ...reported, contextTokens: 10000, contextWindow: 100000, bobcoins: 15 });
    assert.deepEqual((await view(first)).usage, { ...reported, contextTokens: 10000, contextWindow: 100000, bobcoins: 15 });
    original.emit(unknown, undefined, true);
    const unknownView = await view(first);
    assert.deepEqual(unknownView.usage, unknown, "Explicit null retained a stale limit/total");
    const unknownHtml = renderToStaticMarkup(<SessionUsagePanel usage={unknownView.usage} />);
    assert.ok(unknownHtml.includes("— / —"));
    assert.ok(unknownHtml.includes('aria-valuetext="Unknown"'));

    const second = await create();
    await prepare(second);
    assert.equal(original.listeners.size, 0);
    assert.equal((await view(first)).usage, null, "Retired session appeared current");
    assert.deepEqual((await view(second)).usage, reported);
    await prepare(first);
    const resumed = await view(first);
    assert.deepEqual(resumed.usage, { ...unknown, bobcoins: 12.34 }, "Resume accumulated historical totals or limits");
    original.emit({ ...reported, bobcoins: 999 }, undefined, false, true);
    assert.deepEqual((await view(first)).usage, resumed.usage, "Old-connection callback overwrote replacement state");
    assert.equal((await view(second)).usage, null);
    const current = connections.at(-1);
    assert.ok(current);
    current.emit(reported); // Asynchronous report after the resume response.
    const html = renderToStaticMarkup(<SessionUsagePanel usage={(await view(first)).usage} />);
    assert.ok(html.includes("53K / 200K"));
    assert.ok(html.includes("26.5%"));
    assert.ok(html.includes("12.34"));
    assert.ok(html.includes("90% (advisory)"));
    assert.ok(html.includes("16,000"));
    current.emit({ ...reported, contextTokens: 220000 });
    const over = renderToStaticMarkup(<SessionUsagePanel usage={(await view(first)).usage} />);
    assert.ok(over.includes('value="100"'));
    assert.ok(over.includes("110%"));
    current.emit({ ...reported, contextWindow: 0, bobcoins: 0 });
    const zero = renderToStaticMarkup(<SessionUsagePanel usage={(await view(first)).usage} />);
    assert.ok(zero.includes('aria-valuetext="Unknown"'));
    assert.ok(zero.includes("<strong>0</strong>"));
    current.emit(reported);
    await writeFile("/data/tmp/usage-session.json", JSON.stringify({ cookie, csrf, first, second }));
    console.log("Session usage passed: actual HTTP/SSE to UI, early/late initialization, both subtypes, validation, replacement, isolation, resume, retired callbacks, null/decreasing/changing limits, and formatting.");
  });

  // Optional interactive acceptance against the same real routes and built UI.
  // Synthetic prompts: compact, unknown, over-limit, or any text for baseline.
  if (process.argv.includes("--serve")) yield* Effect.never;
})));
