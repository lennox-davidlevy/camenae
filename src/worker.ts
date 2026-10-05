import { BunRuntime } from "@effect/platform-bun";
import { Bob } from "@camenae/bob";
import { Cause, Config, Effect, Exit, Schema } from "effect";
import { lstat, unlink } from "node:fs/promises";
import { z } from "zod";
import { harnessSocketPath } from "./harness-runtime.js";
import { Workspace } from "./workspace.js";
import { camenaeMode } from "./assistant-mode.js";
import { mcpFingerprint, readManagedServers, workerMcpPath, writeSnapshot } from "./managed-mcp.js";

class WorkerError extends Schema.TaggedError<WorkerError>()("WorkerError", {}) {}

const program = Effect.gen(function* () {
  const paths = yield* Workspace;
  const proxy = yield* Config.String("HTTPS_PROXY");
  // Deployment runs exactly one listener per worker container. This entrypoint
  // starts only after the previous container lifetime (including tools) ended.
  // The IPC volume is private, never a user workspace or a host socket directory.
  yield* Effect.tryPromise({
    try: async () => {
      try {
        const existing = await lstat(harnessSocketPath);

        if (!existing.isSocket()) throw new Error("Invalid IPC entry");

        await unlink(harnessSocketPath);
      } catch (error) {
        if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error;
      }
    },
    catch: () => new WorkerError(),
  });

  const environment: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(process.env).map((name) => [name, undefined]),
  );

  Object.assign(environment, {
    HTTPS_PROXY: proxy,
    PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8",
    HOME: paths.home, XDG_CONFIG_HOME: paths.config, XDG_CACHE_HOME: paths.cache,
    XDG_DATA_HOME: paths.data, XDG_STATE_HOME: paths.state, XDG_RUNTIME_DIR: paths.runtime,
    TMPDIR: paths.temporary, TMP: paths.temporary, TEMP: paths.temporary,
  });

  const managedMcpServers = yield* Effect.tryPromise({ try: readManagedServers, catch: () => new WorkerError() });
  yield* Effect.tryPromise({
    try: () => writeSnapshot(workerMcpPath, mcpFingerprint(managedMcpServers)), catch: () => new WorkerError(),
  });

  yield* Effect.tryPromise({
    try: (signal) => Bob.serveOnce({
      socketPath: harnessSocketPath, workspace: paths.workspace, environment, signal,
      autoApprove: false, disableMcp: false, disableSubagents: true,
      managedMcpServers,
      managedCustomModes: [camenaeMode],
    }),
    catch: () => new WorkerError(),
  });
}).pipe(Effect.provide(Workspace.layer));

BunRuntime.runMain(program, {
  disableErrorReporting: true,
  teardown: (exit) => {
    const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause);
    console[failed ? "error" : "log"](JSON.stringify({ event: failed ? "worker_failed" : "worker_stopped" }));
    // Successful onExit(0) permits live handles to keep Bun running. Force the
    // container lifetime to end even if a surviving tool holds an output pipe.
    process.exit(failed ? 1 : 0);
  },
});
