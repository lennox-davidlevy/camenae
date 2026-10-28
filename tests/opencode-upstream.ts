import { randomUUID } from "node:crypto";
import { z } from "zod";

const Body = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() });

const receipts: { toolResult: boolean; resumed: boolean }[] = [];

let failures = 0;

let rateLimited = false;

interface Delta { content?: string; reasoning_content?: string; tool_calls?: { index: number; id: string; type: string; function: { name: string; arguments: string } }[] }

function stream(delta: Delta | Delta[], finish: string) {
  const id = randomUUID();
  const chunk = (value: Delta, reason: string | null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "assistant", choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`;

  return new Response([delta].flat().map((value) => chunk(value, null)).join("") + chunk({}, finish) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

Bun.serve({ hostname: "0.0.0.0", port: 3003, async fetch(request) {
  if (new URL(request.url).pathname === "/receipts") return Response.json({ receipts, failures });

  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  const body = Body.parse(await request.json());
  const users = body.messages.flatMap((message) => message.role === "user" ? [JSON.stringify(message.content)] : []);
  const prompt = users.at(-1) ?? "";
  const tool = body.messages.at(-1)?.role === "tool";

  if (prompt.includes("fail-request")) {
    if (body.tools) failures++;

    return new Response("Synthetic refusal", { status: 400 });
  }

  if (prompt.includes("reasoning-task") && body.tools) return stream([{ reasoning_content: "plan A" }, { reasoning_content: " step" }, { content: "Reasoned answer" }], "stop");

  // The first attempt is rate limited with a provider message that must never reach the application.
  if (prompt.includes("retry-task") && body.tools) {
    if (!rateLimited) {
      rateLimited = true;

      return new Response(JSON.stringify({ error: { message: "synthetic-provider-secret" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
    }

    return stream({ content: "Retried answer" }, "stop");
  }

  // Whether the harness offered the skill the application enabled before this turn.
  if (prompt.includes("skill-check") && body.tools) return stream({ content: JSON.stringify(body).includes("chat-probe-skill") ? "Skill visible" : "Skill missing" }, "stop");

  if (prompt.includes("oversized-task") && !tool) return stream({ tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: "function",
    function: { name: "shell", arguments: JSON.stringify({ command: `echo ${"x".repeat(4100)}` }) } }] }, "tool_calls");

  if ((prompt.includes("capability") || prompt.includes("cancel-task") || prompt.includes("approval-task")) && !tool) {
    const name = prompt.includes("capability") ? "camenae_workspace" : "shell";

    if (!body.tools?.some((entry) => entry.function.name === name)) {
      return new Response("Expected tool not offered", { status: 400 });
    }

    const args = name === "shell" ? { command: prompt.includes("cancel-task")
      ? "sleep 120 & child=$!; printf '%s %s' $$ $child > cancellation.pid; echo started > cancellation-started; wait $child; echo late > cancellation-finished"
      : "echo approved" } : {};

    return stream({ tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, "tool_calls");
  }

  const result = JSON.stringify(body.messages.at(-1)?.content);
  const receipt = { toolResult: tool && result.includes("capability-marker.txt"), resumed: users.some((input) => input.includes("remember-marker-17")) && prompt.includes("resume-check") };
  receipts.push(receipt);

  return stream({ content: receipt.resumed ? "Resumed remember-marker-17" : receipt.toolResult ? "Capability saw capability-marker.txt" : "Synthetic answer" }, "stop");
} });
