import { BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer } from "effect";
import { AppsLive, ChatLive, FoundationLive, IdentityLive } from "./runtime.js";
import { Quotes } from "./quotes-service.js";
import { ServerLive } from "./server.js";

const mode = process.argv[2] ?? "serve";

const program = Effect.gen(function* () {
  if (mode === "serve") return yield* Layer.launch(ServerLive.pipe(
    Layer.provide(ChatLive), Layer.provide(AppsLive), Layer.provide(IdentityLive), Layer.provide(FoundationLive), Layer.provide(Quotes.layer),
  ));

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
