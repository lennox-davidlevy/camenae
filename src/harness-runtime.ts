import { Bob, type BobApprovalPolicy, type BobRemoteClient, type BobManagedMcpServer } from "@camenae/bob";
import { Context, Effect, Exit, Layer, Redacted, Schedule, Schema, Scope } from "effect";
import { lstat } from "node:fs/promises";
import { z } from "zod";
import { Workspace } from "./workspace.js";
import { managedMcpPath, mcpFingerprint, readManagedServers, readWorkerFingerprint, writeSnapshot } from "./managed-mcp.js";

export class HarnessRuntimeError extends Schema.TaggedError<HarnessRuntimeError>()("HarnessRuntimeError", {}) {}

// Existing deployment path: changing the service name does not migrate IPC/state.
export const harnessSocketPath = "/run/bob/gateway.sock";

// Application-owned worker lifecycle. The current implementation uses the Bob
// SDK contract; this is not yet a shared contract for unimplemented harnesses.
export class HarnessRuntime extends Context.Service<HarnessRuntime, {
  readonly stage: (servers: BobManagedMcpServer[]) => Effect.Effect<void, HarnessRuntimeError>;
  readonly connect: (apiKey: Redacted.Redacted<string>, servers?: BobManagedMcpServer[], approvalPolicy?: BobApprovalPolicy) => Effect.Effect<BobRemoteClient, HarnessRuntimeError, Scope.Scope>;
}>()("camenae/HarnessRuntime") {
  static readonly layer = Layer.effect(HarnessRuntime, Effect.gen(function* () {
    const paths = yield* Workspace;
    let previousSocket: string | undefined;

    // Docker owns replacement. A closed SDK connection is not a ready listener:
    // wait for the worker entrypoint to publish a different socket, without
    // retrying credential bootstrap or replaying any ACP operation.
    const listener = Effect.tryPromise({
      try: async () => {
        try {
          const stat = await lstat(harnessSocketPath);

          return stat.isSocket() ? `${stat.dev}:${stat.ino}:${stat.birthtimeMs}` : undefined;
        } catch (error) {
          if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return undefined;
          throw error;
        }
      },
      catch: () => new HarnessRuntimeError(),
    });

    const open = Effect.fn("HarnessRuntime.open")(function* (apiKey: Redacted.Redacted<string>, approvalPolicy?: BobApprovalPolicy) {
      const socket = yield* listener.pipe(
        Effect.repeat({ schedule: Schedule.spaced("100 millis"), while: (value) => !value || value === previousSocket }),
        Effect.timeout("30 seconds"), Effect.mapError(() => new HarnessRuntimeError()),
      );

      return yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const client = await Bob.connect({
              credential: { kind: "apiKey", apiKey: Redacted.value(apiKey) },
              workspace: paths.workspace, socketPath: harnessSocketPath,
              approvalPolicy,
            });

            previousSocket = socket;

            return client;
          },
          catch: () => new HarnessRuntimeError(),
        }),
        (client) => Effect.tryPromise({
          // Disconnect is not cleanup confirmation. Docker owns worker teardown.
          try: () => client.disconnect(), catch: () => new HarnessRuntimeError(),
        }).pipe(Effect.orDie),
      );
    });

    const stage = Effect.fn("HarnessRuntime.stage")(function* (servers: BobManagedMcpServer[]) {
      yield* Effect.tryPromise({
        try: () => writeSnapshot(managedMcpPath, servers), catch: () => new HarnessRuntimeError(),
      });
    }, Effect.uninterruptible);

    const connect = Effect.fn("HarnessRuntime.connect")(function* (apiKey: Redacted.Redacted<string>, expectedServers?: BobManagedMcpServer[], approvalPolicy?: BobApprovalPolicy) {
      // Diagnostics without an explicit expectation inspect the staged snapshot,
      // rather than assuming that this installation has all tools enabled.
      const servers = expectedServers ?? (yield* Effect.tryPromise({
        try: readManagedServers, catch: () => new HarnessRuntimeError(),
      }));

      const expected = mcpFingerprint(servers);
      // An initially idle listener may predate the application's first snapshot.
      // Bootstrap it only to retire it; never load a session on stale settings.

      for (let attempt = 0; attempt < 2; attempt++) {
        const connectionScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(connectionScope, Exit.void));
        const client = yield* open(apiKey, approvalPolicy).pipe(Scope.provide(connectionScope));
        const actual = yield* Effect.tryPromise({ try: readWorkerFingerprint, catch: () => new HarnessRuntimeError() });

        if (actual === expected) return client;
        yield* Scope.close(connectionScope, Exit.void);
        // open waits for a different socket published only by the replacement
        // container entrypoint, after Docker has killed the old lifetime.
      }

      return yield* new HarnessRuntimeError();
    });

    return HarnessRuntime.of({ connect, stage });
  }).pipe(Effect.mapError(() => new HarnessRuntimeError())));
}
