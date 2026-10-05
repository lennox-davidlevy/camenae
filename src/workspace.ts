import { Config, Context, Effect, Layer, Schema } from "effect";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()("WorkspaceError", {}) {}

export interface WorkspacePaths {
  readonly workspace: string;
  readonly home: string;
  readonly config: string;
  readonly cache: string;
  readonly data: string;
  readonly state: string;
  readonly runtime: string;
  readonly temporary: string;
}

const prepare = Effect.fn("Workspace.prepare")(function* (root: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      async function directory(path: string) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        const info = await lstat(path);

        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid storage directory");
      }

      await directory(root);
      const base = await realpath(root);
      // Preserve the existing state directory until an explicit storage migration.
      const harnessState = join(base, "bob-state");
      await directory(harnessState);

      const paths: WorkspacePaths = {
        workspace: join(base, "workspace"),
        home: join(harnessState, "home"), config: join(harnessState, "config"),
        cache: join(harnessState, "cache"), data: join(harnessState, "data"), state: join(harnessState, "state"),
        runtime: join(base, "tmp", "runtime"), temporary: join(base, "tmp"),
      };

      // Check parents before children. Nothing here is a sandbox boundary.
      await directory(paths.temporary);

      for (const path of Object.values(paths)) await directory(path);

      for (const name of ["inbox", "projects", "outputs", "scratch"]) {
        await directory(join(paths.workspace, name));
      }

      return paths;
    },
    catch: () => new WorkspaceError(),
  });
});

export class Workspace extends Context.Service<Workspace, WorkspacePaths>()("camenae/Workspace") {
  static readonly layer = Layer.effect(Workspace, Effect.gen(function* () {
    const directory = yield* Config.String("CAMENAE_DATA_DIRECTORY").pipe(Config.withDefault("/data"));

    if (!isAbsolute(directory)) return yield* new WorkspaceError();

    return Workspace.of(yield* prepare(directory));
  }).pipe(Effect.mapError(() => new WorkspaceError())));
}
