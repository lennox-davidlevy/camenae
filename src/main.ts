import { BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Redacted } from "effect";
import { HarnessRuntime } from "./harness-runtime.js";
import { ChatLive, FoundationLive, IdentityLive } from "./runtime.js";
import { ServerLive } from "./server.js";

const checkRuntime = Effect.scoped(Effect.gen(function* () {
  const runtime = yield* HarnessRuntime;
  const client = yield* runtime.connect(Redacted.make("initialize-only-not-a-real-key"));
  yield* Effect.tryPromise(() => client.newSession({ mcpServers: [] }));
})).pipe(
  Effect.provide(FoundationLive),
  Effect.tap(() => Effect.sync(() => console.log('{"event":"runtime_check_passed"}'))),
);

const mode = process.argv[2] ?? "serve";

const program = Effect.gen(function* () {
  if (mode === "serve") return yield* Layer.launch(ServerLive.pipe(
    Layer.provide(ChatLive), Layer.provide(IdentityLive), Layer.provide(FoundationLive),
  ));

  if (mode === "check-runtime") return yield* checkRuntime;

  return yield* Effect.fail("invalid_command");
});

BunRuntime.runMain(program, {
  disableErrorReporting: true,
  teardown: (exit, onExit) => {
    const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause);
    // Never serialize a cause: native errors can include credentials and paths.
    console[failed ? "error" : "log"](JSON.stringify({ event: failed ? "application_failed" : "application_stopped" }));
    onExit(failed ? 1 : 0);
  },
});
