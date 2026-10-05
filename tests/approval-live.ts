import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
import { ApprovalSettings, type ApprovalPolicy } from "../src/approval-contract.js";
import { ChatView } from "../src/chat-contract.js";

const mode = z.enum(["exercise", "retained"]).parse(process.argv[2]);

const input = z.object({ cookie: z.string(), conversation: z.uuid() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

interface RequestBody { csrf: string; policy?: ApprovalPolicy; prompt?: string; turnId?: string; permissionId?: string; optionId?: string }

const request = (path: string, body?: RequestBody) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie: input.cookie, origin: base, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
});

const allAsk: ApprovalPolicy = { kinds: { edit: "ask", delete: "ask", execute: "ask", search: "ask", fetch: "ask" }, fallback: "ask" };

const allowExecute: ApprovalPolicy = { ...allAsk, kinds: { ...allAsk.kinds, execute: "allow" } };

const settings = async () => ApprovalSettings.parse(await (await request("/api/settings/approvals")).json());

const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

let phase = "bootstrap";

try {
  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());
  let conversation = input.conversation;
  const view = async () => ChatView.parse(await (await request(`/api/chat/${conversation}`)).json());
  const prepare = async () => { assert.equal((await request(`/api/chat/${conversation}/prepare`, { csrf })).status, 200); };

  const save = async (policy: ApprovalPolicy) => {
    assert.equal((await request("/api/settings/approvals", { csrf, policy })).status, 200);
    assert.deepEqual(await settings(), { saved: policy, active: policy });
  };

  await prepare();
  const socket = await lstat("/run/bob/gateway.sock");

  const run = async (behavior: "pending-update" | "manual" | "allow" | "deny" | "fallback-deny") => {
    const token = crypto.randomUUID();
    const file = `/data/workspace/outputs/approval-${token}.txt`;
    const command = `printf '${token}' > ${file}`;
    const toolName = behavior === "fallback-deny" ? "mcp__context7__resolve-library-id" : "execute_command";

    const prompt = behavior === "fallback-deny"
      ? "Call Context7 resolve-library-id once for the public React library. Do not use other tools. If rejected, stop without retrying or using alternatives."
      : `Call execute_command exactly once with this harmless command: ${command}\nUse no other tools or alternative commands. This is a disposable acceptance marker. If rejected, stop without retrying or working around it. Do not infer permission from previous turns; attempt the requested call now.`;

    assert.equal((await request(`/api/chat/${conversation}`, { csrf, prompt })).status, 200);
    const until = Date.now() + 100_000;
    let current = (await view()).turns.at(-1);
    const answered = new Set<string>();

    while (current?.status === "running" && Date.now() < until) {
      const pending = current.permission;

      if (pending && !answered.has(pending.id)) {
        assert.ok(behavior === "manual" || behavior === "pending-update", "Automatic policy unexpectedly asked manually");
        assert.equal(pending.kind, "execute");
        assert.ok(pending.options.length > 0);
        assert.ok(pending.options.every((option) => option.kind === "allow_once" || option.kind === "reject_once"));
        const once = pending.options.find((option) => option.kind === "allow_once");
        assert.ok(once);

        if (behavior === "pending-update") {
          await save(allowExecute);
          const unchanged = (await view()).turns.at(-1);
          assert.equal(unchanged?.status, "running");
          assert.equal(unchanged?.permission?.id, pending.id, "Policy update settled an already-pending request");
          assert.equal(await Bun.file(file).exists(), false);
          assert.equal((await request("/api/chat/approve", { csrf, turnId: current.id, permissionId: pending.id, optionId: "allow_always" })).status, 503);
          assert.equal((await view()).turns.at(-1)?.permission?.id, pending.id);
        }

        assert.equal((await request("/api/chat/approve", { csrf, turnId: current.id, permissionId: pending.id, optionId: once.optionId })).status, 200);
        answered.add(pending.id);
      }

      await pause(); current = (await view()).turns.at(-1);
    }

    assert.equal(current?.status, "completed");
    assert.ok(current);
    assert.equal(answered.size > 0, behavior === "manual" || behavior === "pending-update");
    const ids = new Set(current.activity.map((tool) => tool.id));
    const bob = new Database("/data/bob-state/home/.bob/db/bob.db", { readonly: true });

    try {
      const records = z.array(z.object({ data: z.string() })).parse(bob.query("SELECT data FROM messages WHERE role = 'tool'").all());

      const results = records.map((row) => z.object({ content: z.string(), toolUsage: z.object({ signature: z.object({
        id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()),
      }) }) }).parse(JSON.parse(row.data))).filter((record) => ids.has(record.toolUsage.signature.id));

      const result = results.find((record) => record.toolUsage.signature.name === toolName);
      assert.ok(result, "No actual native tool attempt; model prose is not approval-policy evidence");
      assert.ok(results.every((record) => record.toolUsage.signature.name === toolName), "Unexpected alternative tool execution");

      if (behavior === "manual" || behavior === "pending-update") {
        assert.deepEqual(current.approval_decisions, [], "Manual handling acquired automatic attribution");
      } else {
        const decisions = current.approval_decisions.filter((decision) => decision.toolCallId === result.toolUsage.signature.id);
        assert.ok(decisions.length > 0, "Native tool attempt lacks authoritative automatic attribution");
        assert.ok(decisions.every((decision) => decision.decision === (behavior === "allow" ? "allow" : "deny") &&
          (behavior === "fallback-deny" ? decision.match === "fallback" : decision.match === "category" && decision.kind === "execute")));
      }

      if (behavior !== "fallback-deny") assert.equal(result.toolUsage.signature.arguments.command, command);

      if (behavior === "deny" || behavior === "fallback-deny") {
        assert.match(result.content, /Rejected by user/i, "Failure was not a native permission rejection");
        assert.equal(await Bun.file(file).exists(), false);
      } else assert.equal(await readFile(file, "utf8"), token);
    } finally { bob.close(); }
  };

  if (mode === "exercise") {
    phase = "pending-request-survives-live-policy-update";
    await save(allAsk);
    await run("pending-update");
    phase = "automatic-allow";
    await run("allow");
    phase = "automatic-deny";
    await save({ ...allAsk, kinds: { ...allAsk.kinds, execute: "deny" } });
    await run("deny");
    phase = "explicit-ask-overrides-fallback-deny";
    await save({ ...allAsk, fallback: "deny" });
    await run("manual");
    phase = "fallback-denies-unclassified-mcp";
    await run("fallback-deny");
    await save(allowExecute);
  } else {
    phase = "retained-policy-on-replacement-and-resume";
    assert.deepEqual(await settings(), { saved: allowExecute, active: allowExecute });
    await run("allow");
    phase = "shared-policy-after-conversation-switch";
    conversation = z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id;
    await prepare();
    await run("allow");
    conversation = input.conversation;
    await prepare();
    phase = "return-to-ask-without-native-always-memory";
    await save(allAsk);
    await run("manual");
  }

  const after = await lstat("/run/bob/gateway.sock");
  assert.equal(`${after.ino}:${after.birthtimeMs}`, `${socket.ino}:${socket.birthtimeMs}`, "Policy update replaced the worker");
  console.log(`Approval live ${mode} passed.`);
} catch {
  console.error(`Approval live ${mode} failed at ${phase}; payloads suppressed.`);
  process.exitCode = 1;
}
