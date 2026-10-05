import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { Installation } from "../src/installation.js";
import { FoundationLive } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";

// Primary owner: actual application layers + actual Docker volumes/database.
// Detects lost mounts and repeated migrations resetting state. The isolated
// worker check owns execution placement, secret exclusion, and scope interruption.
const mode = z.enum(["seed", "verify"]).parse(process.argv[2]);

const watchdog = setTimeout(() => { console.error("foundation_check_timeout"); process.exit(1); }, 60_000);

const check = Effect.scoped(Effect.gen(function* () {
  const installation = yield* Installation;
  const paths = yield* Workspace;
  const artifact = `${paths.workspace}/outputs/foundation-check.txt`;
  const state = `${paths.home}/foundation-check.txt`;
  yield* Effect.promise(async () => {
    if (mode === "seed") {
      await writeFile(artifact, installation.id, { flag: "wx" });
      await writeFile(state, installation.id, { flag: "wx" });
    } else {
      assert.equal(await readFile(artifact, "utf8"), installation.id);
      assert.equal(await readFile(state, "utf8"), installation.id);
    }
  });
  yield* installation.check();

})).pipe(Effect.provide(FoundationLive));

const result = await Effect.runPromiseExit(check);

watchdog.unref();

if (Exit.isFailure(result)) {
  // Do not dump effect causes, environment values, or native SDK payloads.
  console.error(JSON.stringify({ event: "foundation_check_failed", mode }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ event: "foundation_check_passed", mode }));
}
