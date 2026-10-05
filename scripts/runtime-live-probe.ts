import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Bob } from "@camenae/bob";

// Explicitly opt-in. A key arrives on stdin, not image layers, CLI arguments,
// Docker environment metadata, or a mounted host credential directory.
assert.equal(process.argv[2], "--allow-live", "Live inference requires --allow-live");

let apiKey = "";

for await (const chunk of process.stdin) apiKey += chunk.toString();

apiKey = apiKey.trim();

assert.ok(apiKey, "An API key is required on stdin");

const root = "/probe";

const workspace = `${root}/workspace`;

for (const directory of ["home", "config", "cache", "data", "state", "run", "tmp", "workspace"]) {
  await mkdir(`${root}/${directory}`, { recursive: true, mode: 0o700 });
}

const runtime = "bun" in process.versions ? "bun" : "node";

let phase = "start";

const report = (result: string, details: {
  permissionRequests?: number;
  fileCreated?: boolean;
  deniedShellRequests?: number;
  allowedShellRequests?: number;
  state?: string;
  parentPid?: number;
} = {}) =>
  console.log(JSON.stringify({ runtime, phase, result, ...details }));

const watchdog = setTimeout(() => {
  report("timeout");
  process.exit(1);
}, 8 * 60_000);

let gateway: Awaited<ReturnType<typeof Bob.start>> | undefined;

let unsubscribe: (() => void) | undefined;

const options = {
  workspace,
  credential: { kind: "apiKey" as const, apiKey },
  autoApprove: false,
  disableMcp: true,
  disableSubagents: true,
};

let text = "";

let permissionRequests = 0;

let shellCalls = 0;

let allowedShellRequests = 0;

let deniedShellRequests = 0;

let deny = false;

let callbackFailed = false;

let cancelOnText = false;

let cancellation: Promise<void> | undefined;

let sessionId = "";

function subscribe() {
  unsubscribe = gateway!.subscribe((event) => {
    if (event.type === "permission_request") {
      permissionRequests++;
      const kind = deny ? "reject_once" : "allow_once";
      const option = event.request.options.find((candidate) => candidate.kind === kind);

      try {
        gateway!.respondToPermission(event.permissionId, option?.optionId ?? null);

        if (option && event.request.toolCall.kind === "execute") {
          if (deny) deniedShellRequests++;
          else allowedShellRequests++;
        }
      }
      catch { callbackFailed = true; }
    }

    if (event.type === "session_update") {
      const update = event.notification.update;

      if (update.sessionUpdate === "tool_call") {
        if (update.kind === "execute") shellCalls++;
      }

      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        text += update.content.text;

        if (cancelOnText && !cancellation) {
          cancellation = gateway!.cancel(sessionId);
          // Attach a handler immediately; report failure after prompt settlement.
          void cancellation.catch(() => { callbackFailed = true; });
        }
      }
    }
  });
}

async function prompt(value: string) {
  text = "";
  const result = await gateway!.prompt(sessionId, [{ type: "text", text: value }]);
  assert.equal(callbackFailed, false);

  return result;
}

try {
  gateway = await Bob.start(options);
  sessionId = (await gateway.newSession({ mcpServers: [] })).sessionId;
  subscribe();
  phase = "stream-and-context";
  await prompt("Remember the token CAMENAE_PROBE_731. Reply with that exact token. Do not use tools.");
  assert.ok(text.includes("CAMENAE_PROBE_731"));
  report("passed");

  phase = "deny-characterization";
  deny = true;
  let requestsBefore = permissionRequests;
  await prompt("Use your shell command tool to execute: printf DENIED_PROBE > denied.txt. If permission is denied, stop; do not try a different tool or command.");
  const requested = permissionRequests - requestsBefore;
  const wroteDespiteDeny = existsSync(`${workspace}/denied.txt`);
  const denyVerified = deniedShellRequests > 0 && !wroteDespiteDeny;
  report(denyVerified ? "passed" : requested === 0 ? "not-exercised" : "not-enforced", {
    permissionRequests: requested, fileCreated: wroteDespiteDeny,
    deniedShellRequests,
  });

  if (!denyVerified) process.exitCode = 1;

  phase = "shell-and-allow-characterization";
  deny = false;
  requestsBefore = permissionRequests;
  const shellBefore = shellCalls;
  const allowedBefore = allowedShellRequests;
  await prompt("Use your shell command tool to execute: printf CAMENAE_SHELL_OK > allowed.txt. Then reply briefly.");
  assert.equal(await readFile(`${workspace}/allowed.txt`, "utf8"), "CAMENAE_SHELL_OK");
  assert.ok(shellCalls > shellBefore, "No execute-kind tool call observed");
  const allowedThisPrompt = allowedShellRequests - allowedBefore;
  const allowVerified = allowedThisPrompt > 0;
  report(allowVerified ? "passed" : "approval-not-exercised", {
    permissionRequests: permissionRequests - requestsBefore,
    allowedShellRequests: allowedThisPrompt,
  });

  if (!allowVerified) process.exitCode = 1;

  phase = "cancellation";
  cancelOnText = true;
  const cancelled = await prompt("Write a numbered explanation of 500 different programming concepts. Do not use tools.");
  await cancellation;
  cancelOnText = false;
  assert.ok(cancellation);
  assert.equal(cancelled.stopReason, "cancelled");
  report("passed");

  phase = "background-tool";
  await writeFile(`${workspace}/background.cjs`, 'require("node:fs").writeFileSync("owned-tool.pid",String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000);\n');
  await prompt("Use your shell tool to start `node background.cjs` in the background in the current directory. Do not wait for it to exit and do not stop it. Reply briefly after starting it.");
  const deadline = Date.now() + 5000;

  while (!existsSync(`${workspace}/owned-tool.pid`) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const pid = Number(await readFile(`${workspace}/owned-tool.pid`, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  assert.ok(alive(pid));
  report("passed");
  phase = "descendant-cleanup";
  unsubscribe?.();
  await gateway.close();
  // SIGKILL delivery/reaping may complete just after close returns.
  const cleanupDeadline = Date.now() + 2000;

  while (alive(pid) && Date.now() < cleanupDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  if (alive(pid)) {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    report("surviving-process", { state: fields[0], parentPid: Number(fields[1]) });
  }

  assert.equal(alive(pid), false);
  report("passed");

  phase = "restart-resume";
  gateway = await Bob.start(options);
  await gateway.resumeSession(sessionId);
  subscribe();
  await prompt("What token did I ask you to remember at the start of this conversation? Reply with the token only. Do not use tools.");
  assert.ok(text.includes("CAMENAE_PROBE_731"));
  assert.equal(await readFile(`${workspace}/allowed.txt`, "utf8"), "CAMENAE_SHELL_OK");
  report("passed");
} catch {
  // Never print Bob output, tool payloads, credentials, or native error messages.
  report("failed");
  process.exitCode = 1;
} finally {
  unsubscribe?.();

  try { await gateway?.close(); }
  finally {
    phase = "natural-exit";
    watchdog.unref();
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  }
  catch { return false; }
}
