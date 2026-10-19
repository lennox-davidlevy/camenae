import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { Bob } from "@camenae/bob";
import { Effect, Layer, Redacted, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { HarnessRuntime, HarnessRuntimeError } from "../src/harness-runtime.js";
import { OpenCodeRuntime } from "../src/opencode-runtime.js";
import { Chat } from "../src/chat.js";
import { Workspace } from "../src/workspace.js";
import { DatabaseLive } from "../src/database.js";
import { Identity } from "../src/identity.js";
import { McpPermissions } from "../src/mcp-permissions.js";
import { IdentityLive } from "../src/runtime.js";
import { camenaeMode } from "../src/assistant-mode.js";

// Uses the real packaged Bob/socket SDK with deterministic model replies. Only
// the process-hosting service is replaced: Chat still owns persistence, managed
// gate definitions, session switching, permissions and history. No live key.
const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const token = cookie.slice(cookie.indexOf("=") + 1);

const root = await mkdtemp("/data/tmp/mcp-native-");

const workspace = `${root}/workspace`;

await mkdir(workspace);

await mkdir(`${root}/home/.bob/settings`, { recursive: true });

await Bun.write(`${root}/home/.bob/settings/settings.json`, JSON.stringify({ telemetry: { enabled: false }, bobShell: { autoUpdate: false } }));

let selected: { name: string; token: string; sent: boolean; offered: boolean } | undefined;

const ModelInput = z.object({ stream: z.boolean().optional(), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })) });

let camenaeRequests = 0;

const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (!new URL(request.url).pathname.includes("chat/completions")) return new Response("{}", { status: 404 });
  const body = ModelInput.parse(await request.json());
  // Inspect the actual request from packaged Bob, not our fixture's answer.
  // Every turn (including resumed sessions after replacement) must use the
  // application persona before inference. SDK tests own general mode parsing.
  const system = JSON.stringify(body.messages.filter((message) => message.role === "system"));
  assert.ok(system.includes("You are Camenae, a capable general-purpose assistant."), "Missing Camenae identity at inference");
  assert.ok(system.includes("you are not limited to engineering tasks"), "Missing general-assistant scope");
  assert.ok(system.includes("be honest about uncertainty"), "Missing custom instructions");
  assert.ok(!system.includes("You are Bob, a highly skilled software engineer"), "Default Bob role reached inference");
  camenaeRequests++;
  const call = selected && !selected.sent && body.tools?.length ? selected : undefined;

  if (call) { call.sent = true; call.offered = body.tools?.some((tool) => tool.function.name === call.name) ?? false; }

  const tool = call ? { id: `fixture-${call.token}`, type: "function", function: { name: call.name,
    arguments: JSON.stringify(call.name === "execute_command" ? { command: "printf native-proof" } : { token: call.token }) } } : undefined;

  const finish = call ? "tool_calls" : "stop";

  if (body.stream) {
    const chunks = [
      { role: "assistant", content: call ? undefined : "Finished.", tool_calls: tool ? [{ index: 0, ...tool }] : undefined }, {},
    ].map((delta, index) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", created: 1,
      choices: [{ index: 0, delta, finish_reason: index === 1 ? finish : null }] })}\n\n`).join("");

    return new Response(`${chunks}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  }

  return Response.json({ id: "fixture", model: "fixture", choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: call ? null : "Finished.", tool_calls: tool ? [tool] : undefined } }] });
} });

let generation = 0;

const hostedRuntime = Layer.succeed(HarnessRuntime, HarnessRuntime.of({
  stage: () => Effect.void,
  connect: (key, servers, approvalPolicy) => Effect.gen(function* () {
    const socketPath = `${root}/s${++generation}`;
    const environment: Record<string, string | undefined> = Object.fromEntries(Object.keys(process.env).map((name) => [name, undefined]));
    Object.assign(environment, { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: `${root}/home`,
      XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, XDG_DATA_HOME: `${root}/data`,
      XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: root, TMPDIR: root, TMP: root, TEMP: root,
      BOB_GATEWAY_URL: model.url.href, BOB_WEB_LOGIN_URL: model.url.href });

    yield* Effect.acquireRelease(Effect.sync(() => {
      const controller = new AbortController();

      const worker = Bob.serveOnce({ socketPath, workspace, environment, signal: controller.signal,
        autoApprove: false, disableSubagents: true, managedCustomModes: [camenaeMode], managedMcpServers: [...(servers ?? []), {
          name: "other", type: "http", url: "http://mcp-fixture:3002/mcp", headers: [],
        }] });

      void worker.catch(() => {});

      return { controller, worker };
    }), ({ controller, worker }) => Effect.promise(async () => { controller.abort(); await worker.catch(() => {}); }));

    yield* Effect.promise(async () => stat(socketPath).then((value) => value.isSocket(), () => false)).pipe(
      Effect.repeat({ schedule: Schedule.spaced("20 millis"), while: (ready) => !ready }), Effect.timeout("10 seconds"),
    );

    return yield* Effect.acquireRelease(Effect.tryPromise(() => Bob.connect({ socketPath, workspace,
      credential: { kind: "apiKey", apiKey: Redacted.value(key) }, approvalPolicy })),
    (client) => Effect.promise(() => client.disconnect()));
  }).pipe(Effect.mapError(() => new HarnessRuntimeError())),
}));

let phase = "setup";

try {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const chat = yield* Chat;
    const auth = yield* Identity;
    const csrf = yield* auth.session(token);
    const conversation = yield* chat.create(token, csrf);
    // Seed a real pre-migration session in Bob's default engineering mode. This
    // prevents a resume check from passing merely because a prior test turn had
    // already persisted the Camenae persona in native state.

    const legacyId = yield* Effect.scoped(Effect.gen(function* () {
      const runtime = yield* HarnessRuntime;
      const client = yield* runtime.connect(Redacted.make("initialize-only-not-a-real-key"));
      const session = yield* Effect.tryPromise(() => client.newSession({ mcpServers: [] }));
      assert.equal(session.modes?.currentModeId, "agent");

      return session.sessionId;
    }));

    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE conversation SET native_id = ${legacyId} WHERE id = ${conversation}`;
    const marker = crypto.randomUUID();
    yield* chat.saveMcpSettings(token, csrf, [], { context7: { fallback: "allow", tools: {} } });

    const invoke = Effect.fn("NativeFixture.invoke")(function* (id: string, name: string, suffix: string, ask = false) {
      selected = { name, token: `${marker}-${suffix}`, sent: false, offered: false };
      yield* chat.start(token, csrf, id, "Perform the synthetic fixture operation once.");

      if (ask) {
        const waiting = yield* chat.view(token, id).pipe(
          Effect.repeat({ schedule: Schedule.spaced("30 millis"), while: (view) => view.mcp.pending.length === 0 }), Effect.timeout("15 seconds"),
        );

        assert.equal(waiting.mcp.pending.length, 1, "Ask did not produce exactly one gate question");
        assert.equal(waiting.turns.at(-1)?.permission, null, "Duplicate native ACP prompt");
        yield* chat.approveMcp(token, csrf, id, waiting.mcp.pending[0].permissionId, "allow");
      }

      const done = yield* chat.view(token, id).pipe(
        Effect.tap((view) => Effect.sync(() => { assert.equal(view.turns.at(-1)?.permission, null, "MCP delegation unexpectedly requested native permission"); })),
        Effect.repeat({ schedule: Schedule.spaced("30 millis"), while: (view) => view.turns.at(-1)?.status === "running" }), Effect.timeout("15 seconds"),
      );

      assert.equal(done.turns.at(-1)?.status, "completed");
      assert.equal(selected.sent, true, "Model did not issue the tool call");

      return done;
    });

    phase = "native-allow";
    const allowed = yield* invoke(conversation, "mcp__context7__resolve-library-id", "allow");
    assert.equal(allowed.mcp.decisions.at(-1)?.decision, "allow");
    assert.equal(allowed.mcp.decisions.at(-1)?.match, "fallback");

    phase = "native-ask";
    yield* chat.saveMcpSettings(token, csrf, [], { context7: { fallback: "allow", tools: { "resolve-library-id": "ask" } } });
    const asked = yield* invoke(conversation, "mcp__context7__resolve-library-id", "ask", true);
    assert.equal(asked.mcp.decisions.length, 1, "Ask became automatic history");

    phase = "native-deny";
    yield* chat.saveMcpSettings(token, csrf, [], { context7: { fallback: "allow", tools: { "resolve-library-id": "deny" } } });
    const denied = yield* invoke(conversation, "mcp__context7__resolve-library-id", "deny");
    assert.equal(selected?.offered, true, "Deny hid the enabled tool");
    assert.equal(denied.mcp.decisions.at(-1)?.decision, "deny");
    assert.equal(denied.mcp.decisions.at(-1)?.match, "tool");

    phase = "fresh-conversation-and-worker";
    yield* chat.saveMcpSettings(token, csrf, [], { context7: { fallback: "allow", tools: {} } });
    const fresh = yield* chat.create(token, csrf);
    const trusted = yield* invoke(fresh, "mcp__context7__query-docs", "fresh");
    assert.equal(trusted.mcp.decisions.length, 1);
    assert.equal(trusted.mcp.decisions[0].decision, "allow");
    yield* chat.prepare(token, csrf, conversation);
    assert.equal((yield* chat.view(token, conversation)).mcp.decisions.length, 2, "History crossed conversation scope");

    phase = "unrelated-native-policy";
    yield* chat.saveApprovalSettings(token, csrf, { kinds: { edit: "ask", delete: "ask", execute: "deny", search: "ask", fetch: "ask" }, fallback: "ask" });
    const native = yield* invoke(conversation, "execute_command", "native");
    assert.equal(native.turns.at(-1)?.approval_decisions.at(-1)?.decision, "deny");
    assert.equal(native.mcp.decisions.length, 2);

    phase = "same-name-unrelated-server";
    yield* chat.saveApprovalSettings(token, csrf, { kinds: { edit: "ask", delete: "ask", execute: "deny", search: "ask", fetch: "ask" }, fallback: "deny" });
    const other = yield* invoke(conversation, "mcp__other__query-docs", "other");
    assert.equal(selected?.offered, true);
    assert.equal(other.turns.at(-1)?.approval_decisions.at(-1)?.match, "fallback");
    assert.equal(other.turns.at(-1)?.approval_decisions.at(-1)?.decision, "deny");
    assert.equal(other.mcp.decisions.length, 2, "Another server inherited Context7 delegation");

    phase = "execution-receipts";
    const receipts = yield* Effect.promise(async () => z.array(z.object({ token: z.string() })).parse(await (await fetch("http://mcp-fixture:3002/receipts")).json()));
    assert.deepEqual(receipts.flatMap((receipt) => receipt.token.startsWith(marker) ? [receipt.token] : []), [`${marker}-allow`, `${marker}-ask`, `${marker}-fresh`]);
    assert.ok(generation >= 5, "Native session transitions did not replace workers");
    assert.ok(camenaeRequests >= 7, "Persona was not checked across fresh and resumed turns");
  })).pipe(Effect.provide(Chat.layer), Effect.provide(OpenCodeRuntime.layer), Effect.provide(hostedRuntime), Effect.provide(McpPermissions.layer),
    Effect.provide(Workspace.layer), Effect.provide(IdentityLive), Effect.provide(DatabaseLive), Effect.timeout("120 seconds")));
  console.log("Packaged Bob MCP passed: Camenae persona at inference across fresh/resumed sessions, prompt-free Allow, single Ask, visible Deny without execution, persistent trust in fresh sessions/workers, separate native category history and execution receipts.");
} catch {
  console.error(`Packaged Bob MCP failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
} finally { await model.stop(true); }
