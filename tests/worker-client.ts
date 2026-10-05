import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { Cause, Deferred, Effect, Exit, Fiber, Redacted } from "effect";
import { HarnessRuntime } from "../src/harness-runtime.js";
import { FoundationLive } from "../src/runtime.js";

const watchdog = setTimeout(() => { console.error("worker_client_timeout"); process.exit(1); }, 60_000);

const program = Effect.scoped(Effect.gen(function* () {
  assert.ok(process.env.CAMENAE_DATABASE_PASSWORD);
  assert.equal(process.env.CAMENAE_SENTINEL_SECRET, "must-not-reach-bob");
  assert.ok((yield* Effect.promise(() => stat("/run/secrets/local_auth"))).isFile());
  const runtime = yield* HarnessRuntime;
  // Rejection before the listener is claimed must not poison that listener's
  // identity. The next authorized attempt still uses the real waiting worker.
  const rejected = yield* runtime.connect(Redacted.make("")).pipe(Effect.exit);
  assert.ok(Exit.isFailure(rejected));
  const ready = yield* Deferred.make<void>();

  const task = yield* Effect.scoped(Effect.gen(function* () {
    const client = yield* runtime.connect(Redacted.make("initialize-only-not-a-real-key"));
    const session = yield* Effect.tryPromise(() => client.newSession({ mcpServers: [] }));
    assert.ok(session.sessionId);
    assert.ok(session.modes?.availableModes.some((mode) => mode.id === "camenae"), "Worker did not provision the Camenae mode");
    yield* Effect.tryPromise(() => client.setMode(session.sessionId, "camenae"));
    yield* Deferred.succeed(ready, undefined);
    yield* Effect.never;
  })).pipe(Effect.forkScoped);

  yield* Effect.raceFirst(Deferred.await(ready), Fiber.join(task));
  console.log("worker_connected");
  // The Docker smoke inspects the actual Bob process before releasing this scope.
  yield* Effect.promise(() => Bun.stdin.text());
  yield* Fiber.interrupt(task);
  const stopped = yield* Fiber.await(task);

  if (Exit.isFailure(stopped)) assert.ok(Cause.hasInterruptsOnly(stopped.cause));
})).pipe(Effect.provide(FoundationLive));

const result = await Effect.runPromiseExit(program);

watchdog.unref();

if (Exit.isFailure(result)) {
  console.error("worker_client_failed");
  process.exitCode = 1;
}
