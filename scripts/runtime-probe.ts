import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { Bob } from "@camenae/bob";

// No real credential or inference. Run with Docker --network none.
// This checks the published SDK path, not a fake launcher or copied Bob entrypoint.
const root = "/probe";

for (const directory of ["home", "config", "cache", "data", "state", "run", "tmp", "workspace"]) {
  await mkdir(`${root}/${directory}`, { recursive: true, mode: 0o700 });
}

const runtime = "bun" in process.versions ? "bun" : "node";

let phase = "start";

let gateway: Awaited<ReturnType<typeof Bob.start>> | undefined;

const timer = setTimeout(() => {
  console.error(JSON.stringify({ runtime, phase, result: "timeout" }));
  process.exit(1); // Docker owns containment if runtime cleanup itself is broken.
}, 60_000);

try {
  gateway = await Bob.start({
    workspace: `${root}/workspace`,
    credential: { kind: "apiKey", apiKey: "initialize-only-not-a-real-key" },
    autoApprove: false,
    disableMcp: true,
    disableSubagents: true,
  });
  assert.equal(gateway.initializeResult.agentInfo?.name, "bob-shell");
  assert.equal(gateway.initializeResult.agentInfo?.version, "2.0.5");
  console.log(JSON.stringify({ runtime, phase, result: "passed", bob: "2.0.5" }));
  phase = "new-session";
  const session = await gateway.newSession({ mcpServers: [] });
  assert.ok(session.sessionId);
  console.log(JSON.stringify({ runtime, phase, result: "passed" }));
  phase = "close";
  await gateway.close();
  console.log(JSON.stringify({ runtime, phase, result: "passed" }));
  // Do not print command lines/environments. Report only whether Bob remains.
  phase = "process-cleanup";
  const { readdir } = await import("node:fs/promises");

  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    let command: string;

    try { command = await readFile(`/proc/${pid}/cmdline`, "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }

    assert.ok(!command.includes("runtime/bob/dist/bob.js"), "Bob survived SDK close");
  }

  console.log(JSON.stringify({ runtime, phase, result: "passed" }));
} catch {
  // SDK and native errors can contain private payloads; never dump them here.
  console.error(JSON.stringify({ runtime, phase, result: "failed" }));
  process.exitCode = 1;
} finally {
  try { await gateway?.close(); }
  finally {
    phase = "natural-exit";
    // Do not keep a healthy process alive, but catch leaked referenced handles.
    timer.unref();
  }
}
