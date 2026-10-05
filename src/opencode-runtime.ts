import { OpenCode } from "@camenae/opencode";
import { randomUUID } from "node:crypto";
import { Config, Context, Effect, Layer, Redacted, Schedule, Scope, Schema } from "effect";
import { z } from "zod";
import { openCodeExecution, type ExecutionClient, type Harness } from "./execution-client.js";

export const openCodeSettings = Config.all({
  harness: Config.String("CAMENAE_HARNESS").pipe(Config.withDefault("bob")),
  url: Config.String("CAMENAE_OPENCODE_URL").pipe(Config.withDefault("")),
  password: Config.Redacted("CAMENAE_OPENCODE_PASSWORD").pipe(Config.withDefault(Redacted.make(""))),
  workspace: Config.String("CAMENAE_OPENCODE_WORKSPACE").pipe(Config.withDefault("/data/workspace")),
  provider: Config.String("CAMENAE_OPENCODE_PROVIDER").pipe(Config.withDefault("camenae")),
  model: Config.String("CAMENAE_OPENCODE_MODEL").pipe(Config.withDefault("assistant")),
});

/** Application-owned lifetime supervision. Native sessions survive worker retirement. */
export class OpenCodeRuntimeError extends Schema.TaggedError<OpenCodeRuntimeError>()("OpenCodeRuntimeError", {}) {}

export class OpenCodeRuntime extends Context.Service<OpenCodeRuntime, {
  readonly harness: Harness;
  readonly configured: boolean;
  readonly credential: Redacted.Redacted<string>;
  readonly connect: () => Effect.Effect<ExecutionClient, OpenCodeRuntimeError, Scope.Scope>;
}>()("camenae/OpenCodeRuntime") {
  static readonly layer = Layer.effect(OpenCodeRuntime, Effect.gen(function* () {
  const settings = yield* openCodeSettings;
  const harness = yield* Effect.try(() => z.enum(["bob", "opencode"]).parse(settings.harness));
  const configured = Boolean(settings.url && Redacted.value(settings.password));
  const owner = randomUUID();
  let retired: string | undefined;

  const connect = Effect.fn("OpenCodeRuntime.connect")(function* () {
    if (!configured) return yield* new OpenCodeRuntimeError();

    const acquire = Effect.tryPromise(async (signal) => {
      const client = await OpenCode.connect({
        baseUrl: settings.url, password: Redacted.value(settings.password), workspace: settings.workspace,
        model: { providerID: settings.provider, id: settings.model },
      });

      try {
        signal.throwIfAborted();
        const request = { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) };
        const result = await client.native.rpc.call({ rpcID: "camenae.runtime", method: "identity", input: {}, location: { directory: settings.workspace } }, request);
        const lifetime = z.uuid().parse(result.output);

        // A failed retirement request quarantines the lifetime, but must not stop
        // later attempts to retire it. Never reclaim a quarantined worker.
        const claim = lifetime === retired ? undefined : await client.native.rpc.call({
          rpcID: "camenae.runtime", method: "claim", input: { owner }, location: { directory: settings.workspace },
        }, request);

        if (claim?.output !== true) {
          retired = lifetime;
          await client.native.rpc.call({ rpcID: "camenae.runtime", method: "retire", input: {}, location: { directory: settings.workspace } },
            { signal: AbortSignal.timeout(2000) });
          throw new Error("Previous OpenCode owner must retire before acquisition");
        }

        return { client, lifetime };
      } catch {
        await client.close();
        throw new Error("OpenCode worker unavailable");
      }
    });

    const owned = yield* Effect.acquireRelease(
      // Retry readiness only. Never submit or replay a model prompt here.
      acquire.pipe(Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 20 }), Effect.timeout("30 seconds"), Effect.interruptible),
      ({ client, lifetime }) => Effect.promise(async () => {
        retired = lifetime;

        try {
          await client.native.rpc.call({ rpcID: "camenae.runtime", method: "retire", input: {}, location: { directory: settings.workspace } },
            { signal: AbortSignal.timeout(2000) });
        } catch { /* A failed request is not cleanup proof; acquisition refuses this lifetime. */ }
        finally { await client.close(); }
      }),
    );

    return openCodeExecution(owned.client);
  }, Effect.mapError(() => new OpenCodeRuntimeError()));

  return OpenCodeRuntime.of({ harness, configured, connect, credential: settings.password });
  }).pipe(Effect.mapError(() => new OpenCodeRuntimeError())));
}
