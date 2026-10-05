import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { Deferred, Effect, Fiber, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";

const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const request = (path: string, body?: Record<string, string>, authenticated = true) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie: authenticated ? cookie : "", origin: base, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
});

const state = (id: string) => Effect.runPromise(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = z.array(z.object({ native_id: z.string().nullable(), turns: z.number() })).length(1).parse(
    yield* sql`SELECT native_id, (SELECT count(*)::int FROM turn WHERE conversation_id = ${id}) AS turns
      FROM conversation WHERE id = ${id}`);

  return rows[0];
}).pipe(Effect.provide(DatabaseLive)));

let phase = "bootstrap";

const timings: Record<string, number> = {};

// Diagnostic measurements, not latency assertions: this fixture uses a synthetic
// key and real network services, so its timings are not an authenticated-user SLO.
const measured = async <A>(name: string, operation: () => Promise<A>): Promise<A> => {
  const started = performance.now();
  const result = await operation();
  timings[name] = Math.round(performance.now() - started);

  return result;
};

try {
  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());
  const create = async () => z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id;
  const first = await create();
  phase = "authorization";
  assert.equal((await request(`/api/chat/${first}/prepare`, { csrf }, false)).status, 401);
  assert.equal((await request(`/api/chat/${first}/prepare`, { csrf: "wrong" })).status, 401);
  assert.deepEqual(await state(first), { native_id: null, turns: 0 });

  phase = "prepare-without-prompt";

  const prepared = await measured("firstConcurrentPrepareMs", () => Promise.all([
    request(`/api/chat/${first}/prepare`, { csrf }), request(`/api/chat/${first}/prepare`, { csrf }),
  ]));

  assert.ok(prepared.every((response) => response.status === 200), "Preparation endpoint failed");
  const initial = await state(first);
  assert.ok(initial?.native_id);
  assert.equal(initial.turns, 0, "Preparation created a message");
  const bob = new Database("/data/bob-state/home/.bob/db/bob.db", { readonly: true });

  try {
    assert.ok(bob.query("SELECT id FROM tasks WHERE id = ?").get(initial.native_id), "No actual native Bob session exists");
  } finally { bob.close(); }

  phase = "switch-and-resume-without-prompt";
  const second = await create();
  assert.equal((await measured("newOnConnectedBobMs", () => request(`/api/chat/${second}/prepare`, { csrf }))).status, 200);
  const other = await state(second);
  assert.ok(other?.native_id);
  assert.notEqual(other.native_id, initial.native_id);
  assert.equal(other.turns, 0);
  assert.equal((await measured("resumeOnConnectedBobMs", () => request(`/api/chat/${first}/prepare`, { csrf }))).status, 200);
  assert.deepEqual(await state(first), initial, "Opening an existing conversation replaced its native ID or created a message");
  assert.equal((await request(`/api/chat/${crypto.randomUUID()}/prepare`, { csrf })).status, 503);

  phase = "revoked-preparation";
  const waiting = await create();
  const queued = await create();

  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const saved = z.array(z.object({ encrypted_key: z.string() })).length(1).parse(yield* sql`SELECT encrypted_key FROM bob_connection`)[0];
    const locked = yield* Deferred.make<number>();
    const release = yield* Deferred.make<void>();
    // Restore only this disposable fixture's original encrypted credential.
    yield* Effect.addFinalizer(() => sql`INSERT INTO bob_connection (encrypted_key) VALUES (${saved.encrypted_key})
      ON CONFLICT (singleton) DO UPDATE SET encrypted_key = EXCLUDED.encrypted_key`.pipe(Effect.orDie));

    const holder = yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`LOCK TABLE conversation IN ACCESS EXCLUSIVE MODE`;
      const rows = z.array(z.object({ pid: z.number() })).length(1).parse(yield* sql`SELECT pg_backend_pid() AS pid`);
      yield* Deferred.succeed(locked, rows[0].pid);
      yield* Deferred.await(release);
    })).pipe(Effect.forkScoped);

    const blocker = yield* Deferred.await(locked);
    const preparing = request(`/api/chat/${waiting}/prepare`, { csrf });
    // Observe the real preparation blocked in Postgres; no timing guess or
    // test-only production hook controls the lifecycle semaphore.
    yield* Effect.gen(function* () {
      const rows = z.array(z.object({ blocked: z.boolean() })).length(1).parse(
        yield* sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))) AS blocked`);

      return rows[0].blocked;
    }).pipe(Effect.repeat({ schedule: Schedule.spaced("50 millis"), while: (blocked) => !blocked }), Effect.timeout("3 seconds"));

    const next = request(`/api/chat/${queued}/prepare`, { csrf });

    const removed = yield* Effect.promise(() => fetch(base + "/connection/bob/remove", {
      method: "POST", redirect: "manual", headers: { cookie, origin: base }, body: new URLSearchParams({ csrf }),
    }));

    assert.equal(removed.status, 303);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(holder);
    const responses = yield* Effect.promise(() => Promise.all([preparing, next]));
    assert.ok(responses.every((response) => response.status === 503), "Preparation used a revoked Bob credential");
  })).pipe(Effect.provide(DatabaseLive)));

  assert.deepEqual(await state(waiting), { native_id: null, turns: 0 });
  assert.deepEqual(await state(queued), { native_id: null, turns: 0 });
  console.log(JSON.stringify({ event: "synthetic_preparation_timings", ...timings }));
  console.log("Chat preparation passed: authorized native initialization, concurrent open, switch/resume, no prompts or messages.");
} catch {
  console.error(`Chat preparation failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
