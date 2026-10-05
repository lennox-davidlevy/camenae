import assert from "node:assert/strict";
import type { BobEvent, BobRemoteClient, PromptResponse } from "@camenae/bob";
import { Effect, Layer, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { HarnessRuntime } from "../src/harness-runtime.js";
import { Chat } from "../src/chat.js";
import { DatabaseLive } from "../src/database.js";
import { Identity } from "../src/identity.js";
import { IdentityLive } from "../src/runtime.js";
import { McpPermissions } from "../src/mcp-permissions.js";

// Run only in the disposable smoke-mcp project, with its application stopped.
// Gateway owns event correctness; this fixture owns Camenae's event consumption
// and real Postgres retention. It never initializes Bob or uses a live key.
const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const token = cookie.slice(cookie.indexOf("=") + 1);

const unexpected = () => { throw new Error("Unexpected Gateway operation"); };

function gatewayFixture() {
  const listeners = new Set<(event: BobEvent) => void>();
  const started = Promise.withResolvers<string>();
  const finished = Promise.withResolvers<PromptResponse>();
  const answers: string[] = [];

  const client: BobRemoteClient = {
    workspace: "/data/workspace", initializeResult: { protocolVersion: 1, agentCapabilities: {} },
    authenticate: unexpected, listSessions: unexpected, loadSession: unexpected,
    deleteSession: unexpected, setMode: async () => ({}), setConfigOption: unexpected, run: unexpected,
    newSession: async () => ({ sessionId: "native-session" }), resumeSession: async () => ({}),
    closeSession: async () => {}, cancel: unexpected, setApprovalPolicy: () => {},
    prompt: (sessionId) => {
      started.resolve(sessionId);

      return finished.promise;
    },
    respondToPermission: (permissionId, optionId) => { answers.push(`${permissionId}:${optionId}`); },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
    disconnect: async () => { listeners.clear(); },
  };

  return {
    started: started.promise, answers,
    emit: (event: BobEvent) => { for (const listener of listeners) listener(Object.freeze(event)); },
    finish: () => { finished.resolve({ stopReason: "end_turn" }); },
    layer: Layer.succeed(HarnessRuntime, HarnessRuntime.of({
      stage: () => Effect.void,
      connect: () => Effect.acquireRelease(Effect.succeed(client), () => Effect.promise(() => client.disconnect())),
    })),
  };
}

let phase = "setup";

try {
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* Identity;
    const csrf = yield* auth.session(token);
    const first = gatewayFixture();
    const sharedTool = "execute_command-{\"command\":\"synthetic-private-argument\"}";

    const original = yield* Effect.scoped(Effect.gen(function* () {
      const chat = yield* Chat;
      const conversation = yield* chat.create(token, csrf);
      const sql = yield* SqlClient.SqlClient;
      // Existing rows must remain readable with empty history after migration.
      yield* sql`INSERT INTO turn (id, conversation_id, ordinal, prompt, status)
        VALUES (${crypto.randomUUID()}, ${conversation}, 1, 'Old turn', 'completed')`;
      assert.deepEqual((yield* chat.view(token, conversation)).turns[0].approval_decisions, []);
      yield* chat.start(token, csrf, conversation, "Controlled consumer fixture");
      const sessionId = yield* Effect.promise(() => first.started);
      phase = "running-attribution";

      first.emit({ type: "permission_auto_decision", sessionId: "another-session", permissionId: "outside",
        toolCallId: sharedTool, match: "category", kind: "execute", decision: "deny" });
      first.emit({ type: "permission_auto_decision", sessionId, permissionId: "1", toolCallId: sharedTool,
        match: "category", kind: "execute", decision: "deny" });
      first.emit({ type: "permission_auto_decision", sessionId, permissionId: "2", toolCallId: sharedTool,
        match: "category", kind: "execute", decision: "allow" });
      first.emit({ type: "permission_auto_decision", sessionId, permissionId: "3", toolCallId: "no-tool-update",
        match: "fallback", kind: null, decision: "deny" });
      first.emit({ type: "permission_request", permissionId: "manual", request: { sessionId,
        toolCall: { toolCallId: "manual-tool", title: "Manual request", kind: "fetch" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }] } });

      const snapshot = yield* chat.view(token, conversation).pipe(
        Effect.repeat({ schedule: Schedule.spaced("25 millis"), while: (view) => view.turns.at(-1)?.approval_decisions.length !== 3 }),
        Effect.timeout("3 seconds"),
      );

      const running = snapshot.turns.at(-1);
      assert.ok(running);
      assert.equal(running.status, "running");
      assert.equal(running.permission?.id, "manual");
      assert.deepEqual(running.activity, [], "Attribution fabricated tool activity");
      assert.deepEqual(running.approval_decisions, [
        { permissionId: "1", toolCallId: sharedTool, match: "category", kind: "execute", decision: "deny" },
        { permissionId: "2", toolCallId: sharedTool, match: "category", kind: "execute", decision: "allow" },
        { permissionId: "3", toolCallId: "no-tool-update", match: "fallback", kind: null, decision: "deny" },
      ]);
      assert.deepEqual(first.answers, [], "Camenae answered an already-settled automatic event");
      phase = "terminal-persistence";
      yield* chat.saveApprovalSettings(token, csrf, {
        kinds: { edit: "ask", delete: "ask", execute: "ask", search: "ask", fetch: "ask" }, fallback: "ask",
      });
      yield* chat.approve(token, csrf, running.id, "manual", "allow");
      assert.deepEqual(first.answers, ["manual:allow"]);
      first.emit({ type: "session_update", notification: { sessionId, update: {
        sessionUpdate: "tool_call_update", toolCallId: sharedTool, title: "Reported tool", status: "failed",
      } } });
      first.emit({ type: "session_update", notification: { sessionId, update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Rejected by user" },
      } } });
      first.finish();

      const terminal = yield* chat.view(token, conversation).pipe(
        Effect.repeat({ schedule: Schedule.spaced("25 millis"), while: (view) => view.turns.at(-1)?.status === "running" }),
        Effect.timeout("3 seconds"),
      );

      const completed = terminal.turns.at(-1);
      assert.ok(completed);
      assert.equal(completed.status, "completed");
      assert.equal(completed.stop_reason, "end_turn");
      assert.equal(completed.answer, "Rejected by user", "Attribution rewrote Bob's answer");
      assert.equal(completed.permission, null);
      assert.deepEqual(completed.activity, [{ id: sharedTool, title: "Reported tool", status: "failed" }]);
      assert.deepEqual(completed.approval_decisions, running.approval_decisions);

      return { conversation, terminal };
    }).pipe(Effect.provide(Chat.layer.pipe(Layer.provide(first.layer)))));

    phase = "reload-and-client-id-reuse";
    const second = gatewayFixture();
    yield* Effect.scoped(Effect.gen(function* () {
      const chat = yield* Chat;
      assert.deepEqual(yield* chat.view(token, original.conversation), original.terminal);
      yield* chat.start(token, csrf, original.conversation, "New client, reused permission ID");
      const sessionId = yield* Effect.promise(() => second.started);
      second.emit({ type: "permission_auto_decision", sessionId, permissionId: "1", toolCallId: sharedTool,
        match: "fallback", kind: "other", decision: "deny" });
      second.finish();

      const reloaded = yield* chat.view(token, original.conversation).pipe(
        Effect.repeat({ schedule: Schedule.spaced("25 millis"), while: (view) => view.turns.at(-1)?.status === "running" }),
        Effect.timeout("3 seconds"),
      );

      assert.deepEqual(reloaded.turns.slice(0, -1), original.terminal.turns);
      assert.deepEqual(reloaded.turns.at(-1)?.approval_decisions, [
        { permissionId: "1", toolCallId: sharedTool, match: "fallback", kind: "other", decision: "deny" },
      ]);
    }).pipe(Effect.provide(Chat.layer.pipe(Layer.provide(second.layer)))));
  }).pipe(Effect.provide(McpPermissions.layer), Effect.provide(IdentityLive), Effect.provide(DatabaseLive), Effect.timeout("30 seconds")));
  console.log("Approval observability passed: session isolation, independent decisions, real persistence, unchanged manual/tool/answer state, reload and client ID reuse.");
} catch {
  console.error(`Approval observability failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
