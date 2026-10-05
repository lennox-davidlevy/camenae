import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Effect, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { ChatView } from "../src/chat-contract.js";
import { DatabaseLive } from "../src/database.js";

const saved = z.object({ cookie: z.string(), conversation: z.string().optional(), nativeId: z.string().optional() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const bootstrap = z.object({ csrf: z.string(), harness: z.literal("opencode"), stored: z.literal(true) }).parse(await (await fetch(`${base}/api/chat`, { headers: { cookie: saved.cookie } })).json());

async function post(path: string, input: { prompt?: string; turnId?: string; permissionId?: string; optionId?: string }) {
  const response = await fetch(base + path, { method: "POST", headers: { cookie: saved.cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ ...input, csrf: bootstrap.csrf }), signal: AbortSignal.timeout(40_000) });

  assert.equal(response.status, 200, `Request failed: ${path}`);

  return response.json();
}

const view = async (id: string) => ChatView.parse(await (await fetch(`${base}/api/chat/${id}`, { headers: { cookie: saved.cookie } })).json());

async function wait(id: string, ready: (snapshot: ChatView) => boolean) {
  return Effect.runPromise(Effect.tryPromise(() => view(id)).pipe(
    Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (snapshot) => !ready(snapshot) }), Effect.timeout("30 seconds")));
}

async function nativeId(id: string) {
  return Effect.runPromise(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const rows = z.array(z.object({ harness: z.literal("opencode"), native_id: z.string() })).length(1).parse(
      yield* sql`SELECT harness, native_id FROM conversation WHERE id = ${id}`);

    return rows[0].native_id;
  }).pipe(Effect.provide(DatabaseLive)));
}

const conversation = saved.conversation ?? z.object({ id: z.uuid() }).parse(await post("/api/chat", {})).id;

await post(`/api/chat/${conversation}/prepare`, {});

if (process.argv[2] === "failure") {
  await post(`/api/chat/${conversation}`, { prompt: "fail-request" });
  const failed = await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");
  assert.equal(failed.turns.at(-1)?.status, "failed");
  const receipt = z.object({ failures: z.number() }).parse(await (await fetch("http://opencode-fixture:3003/receipts")).json());
  assert.equal(receipt.failures, 1, "Failed prompt was replayed");
} else if (process.argv[2] === "crash") {
  await post(`/api/chat/${conversation}`, { prompt: "cancel-task" });
  const pending = await wait(conversation, (snapshot) => Boolean(snapshot.turns.at(-1)?.permission));
  const turn = pending.turns.at(-1);
  assert.ok(turn?.permission);
  await post("/api/chat/approve", { turnId: turn.id, permissionId: turn.permission.id, optionId: "once" });
  await Effect.runPromise(Effect.tryPromise(() => readFile("/data/workspace/cancellation-started", "utf8")).pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 })));
  console.log(JSON.stringify({ cookie: saved.cookie, conversation, nativeId: await nativeId(conversation) }));
} else if (process.argv[2] === "resume") {
  assert.equal(await nativeId(conversation), saved.nativeId, "Native session was replaced instead of reopened");
  await post(`/api/chat/${conversation}`, { prompt: "resume-check" });
  const resumed = await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");
  assert.equal(resumed.turns.at(-1)?.answer, "Resumed remember-marker-17");
  console.log("OpenCode native session resumed across complete worker/application replacement.");
} else {
  assert.equal((await view(conversation)).harness, "opencode");
  await writeFile("/data/workspace/capability-marker.txt", "synthetic workspace capability marker");
  await post(`/api/chat/${conversation}`, { prompt: "capability" });
  const capability = await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");
  assert.equal(capability.turns.at(-1)?.answer, "Capability saw capability-marker.txt");
  await post(`/api/chat/${conversation}`, { prompt: "approval-task" });
  const pending = await wait(conversation, (snapshot) => Boolean(snapshot.turns.at(-1)?.permission) || snapshot.turns.at(-1)?.status !== "running");
  const turn = pending.turns.at(-1);
  assert.ok(turn?.permission, `Expected native approval; turn status: ${turn?.status}`);
  assert.equal(turn.permission.kind, "shell");
  assert.ok(turn.permission.resources?.some((resource) => resource.includes("echo approved")));
  assert.equal(turn.status, "running", "Prompt admission was mistaken for execution completion");
  await post("/api/chat/approve", { turnId: turn.id, permissionId: turn.permission.id, optionId: "once" });
  const completed = await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");
  assert.equal(completed.turns.at(-1)?.status, "completed");
  assert.equal(completed.turns.at(-1)?.answer, "Synthetic answer");
  assert.ok(completed.turns.at(-1)?.activity.some((activity) => activity.status === "completed"));

  await post(`/api/chat/${conversation}`, { prompt: "oversized-task" });
  const oversized = await wait(conversation, (snapshot) => Boolean(snapshot.turns.at(-1)?.permission));
  const denied = oversized.turns.at(-1);
  assert.ok(denied?.permission);
  assert.equal(denied.permission.detailsTruncated, true);
  assert.deepEqual(denied.permission.options.map((option) => option.optionId), ["reject"]);

  const forbidden = await fetch(`${base}/api/chat/approve`, { method: "POST",
    headers: { cookie: saved.cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ csrf: bootstrap.csrf, turnId: denied.id, permissionId: denied.permission.id, optionId: "once" }) });

  assert.equal(forbidden.ok, false, "An undisclosed operation must not be approvable through the API");
  await post("/api/chat/approve", { turnId: denied.id, permissionId: denied.permission.id, optionId: "reject" });
  await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");

  await post(`/api/chat/${conversation}`, { prompt: "remember-marker-17" });
  await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");

  await post(`/api/chat/${conversation}`, { prompt: "cancel-task" });
  const cancelling = await wait(conversation, (snapshot) => Boolean(snapshot.turns.at(-1)?.permission));
  const cancelTurn = cancelling.turns.at(-1);
  assert.ok(cancelTurn?.permission);
  assert.notDeepEqual(cancelTurn.permission.resources, turn.permission.resources, "Different commands must be distinguishable before approval");
  await post("/api/chat/approve", { turnId: cancelTurn.id, permissionId: cancelTurn.permission.id, optionId: "once" });
  await Effect.runPromise(Effect.tryPromise(() => readFile("/data/workspace/cancellation-started", "utf8")).pipe(
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 })));
  await post("/api/chat/cancel", { turnId: cancelTurn.id });
  const cancelled = await wait(conversation, (snapshot) => snapshot.turns.at(-1)?.status !== "running");
  assert.equal(cancelled.turns.at(-1)?.status, "cancelled");

  console.log(JSON.stringify({ cookie: saved.cookie, conversation, nativeId: await nativeId(conversation) }));
}
