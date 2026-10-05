import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

assert.equal(process.env.CAMENAE_DATABASE_PASSWORD, undefined);

assert.equal(process.env.CAMENAE_SENTINEL_SECRET, undefined);

await assert.rejects(readFile("/run/secrets/local_auth"), { code: "ENOENT" });

assert.equal((await readFile("/proc/net/route", "utf8")).split("\n").some((line) => /^\S+\s+00000000\s/.test(line)), false);

const pids: number[] = [];

for (const entry of await readdir("/proc")) {
  if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;

  let command: string;

  try { command = await readFile(`/proc/${entry}/cmdline`, "utf8"); }
  catch { continue; }

  if (command.includes("runtime/bob/dist/bob.js")) pids.push(Number(entry));
}

assert.equal(pids.length, 1);

const pid = pids[0];

assert.ok(pid);

const entries = (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0").filter(Boolean);

const environment = Object.fromEntries(entries.map((entry) => {
  const separator = entry.indexOf("=");

  return [entry.slice(0, separator), entry.slice(separator + 1)];
}));

assert.equal(Object.keys(environment).some((key) => key.startsWith("CAMENAE_")), false);

assert.equal(environment.BOB_API_KEY, "initialize-only-not-a-real-key");

assert.equal(environment.HOME, "/data/bob-state/home");

console.log("Worker boundary passed: actual Bob, filtered environment, no app secret mount, no default route.");
