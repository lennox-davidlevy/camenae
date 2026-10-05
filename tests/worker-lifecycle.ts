import { spawn } from "node:child_process";

// Reproduce the worker state after best-effort SDK cleanup: the direct child
// exited, but a reparented descendant still holds its inherited output open.
// Load the real entrypoint afterward; no production injection hook is needed.
const parent = spawn("/usr/local/bin/node", ["-e", `
  const { spawn } = require("node:child_process");
  const { writeFileSync } = require("node:fs");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true, stdio: ["ignore", "inherit", "ignore"]
  });
  child.once("spawn", () => {
    writeFileSync("/data/workspace/survivor-pid", String(child.pid));
    child.unref();
  });
`], { stdio: ["ignore", "pipe", "inherit"] });

parent.stdout.resume();

await new Promise<void>((resolve, reject) => {
  parent.once("error", reject);
  parent.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Fixture parent failed")));
});

await import("../src/worker.js");
