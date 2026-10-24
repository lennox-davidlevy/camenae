import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { z } from "zod";
import type { ChatView, Conversation, Turn } from "../src/chat-contract.js";

const minute = 60_000;

const day = 24 * 60 * minute;

const csrf = "fixture";

// Synthetic data only: nothing here is read from an installation. State lives in this
// dev server's memory and resets when it restarts.
interface Chat {
  conversation: Conversation;
  turns: Turn[];
}

const chats = new Map<string, Chat>();

const listeners = new Map<string, Set<ServerResponse>>();

const approvals = new Map<string, (optionId: string | null) => void>();

const conversation = (id: string, title: string, harness: "opencode", age: number, toolCount: number): Conversation => ({
  id, title, harness, toolCount, createdAt: Date.now() - age - 5 * minute, updatedAt: Date.now() - age,
});

const finished = (ordinal: number, prompt: string, answer: string): Turn => ({
  id: crypto.randomUUID(), ordinal, prompt, answer, activity: [{ id: `seed-${ordinal}`, title: "Read file · notes.md", status: "completed" }],
  permission: null, attachments: [], status: "completed", stop_reason: "end_turn",
});

const seed = (id: string, title: string, harness: "opencode", age: number, turns: Turn[]) =>
  chats.set(id, { conversation: conversation(id, title, harness, age, turns.reduce((sum, turn) => sum + turn.activity.length, 0)), turns });

const ids = Array.from({ length: 6 }, (_, index) => `5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d0${index + 1}`);

seed(ids[0] ?? "", "Plan a game backlog tracker", "opencode", 12 * minute, [
  finished(1, "Sketch a backlog tracker", "Here is a **starting point**:\n\n| Field | Type |\n| --- | --- |\n| title | text |\n| status | todo / playing / done |\n\n```ts\ntype Game = { title: string; status: \"todo\" | \"playing\" | \"done\" };\n```\n\nTry the word `markdown` in a message to see hostile content rendered safely."),
]);

seed(ids[1] ?? "", "Summarize last week's reading notes", "opencode", 3 * 60 * minute, []);

seed(ids[2] ?? "", "Rename the files in the reports folder", "opencode", day + 2 * 60 * minute, [finished(1, "Rename them", "Done.")]);

seed(ids[3] ?? "", "Draft a calendar view with a dark theme", "opencode", 3 * day, [finished(1, "Draft it", "Drafted.")]);

seed(ids[4] ?? "", "Compare two meal tracker layouts", "opencode", 11 * day, [finished(1, "Compare", "Compared.")]);

seed(ids[5] ?? "", "Old experiment with a very long title that should wrap across two lines in the sidebar", "opencode", 45 * day, []);

const view = (chat: Chat): ChatView => ({
  conversation: { ...chat.conversation, toolCount: chat.turns.reduce((sum, turn) => sum + turn.activity.length, 0) },
  harness: chat.conversation.harness, model: null, turns: chat.turns, usage: null,
});

const push = (chat: Chat) => {
  chat.conversation.updatedAt = Date.now();

  for (const response of listeners.get(chat.conversation.id) ?? []) response.write(`data: ${JSON.stringify(view(chat))}\n\n`);
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const hostile = "Hostile markdown, rendered as inert text and safe links:\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror=\"window.__pwned = 2\">\n\n[javascript link](javascript:window.__pwned=3) and [safe link](https://example.com/docs)\n\n![tracking pixel](https://example.com/pixel.png)\n\n| a | b |\n| - | - |\n| 1 | 2 |";

const words = (prompt: string) => (prompt.includes("markdown") ? hostile : `You said: "${prompt}". This is a synthetic streamed reply that arrives one word at a time, so you can watch the message grow, scroll, and finish.`).split(/(\s+)/);

const run = async (chat: Chat, turn: Turn) => {
  const live = () => turn.status === "running";

  await sleep(250);
  turn.activity.push({ id: `${turn.id}-read`, title: "Read file · notes.md", status: "completed" });
  push(chat);

  if (turn.prompt.includes("approve")) {
    turn.permission = { id: `${turn.id}-permission`, title: "Write file · report.md", kind: "edit", resources: ["/workspace/report.md"],
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "reject-once", name: "Reject", kind: "reject_once" }] };
    push(chat);
    const choice = await new Promise<string | null>((resolve) => approvals.set(turn.id, resolve));
    turn.permission = null;
    turn.activity.push({ id: `${turn.id}-write`, title: "Write file · report.md", status: choice === "allow-once" ? "completed" : "rejected" });
    push(chat);
  }

  for (const word of words(turn.prompt)) {
    if (!live()) return;
    turn.answer += word;
    push(chat);
    await sleep(70);
  }

  if (live()) {
    turn.status = "completed";
    turn.stop_reason = "end_turn";
    push(chat);
  }
};

const body = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  return z.looseObject({}).parse(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
};

const Authorized = z.looseObject({ csrf: z.literal(csrf) });

const Prompt = z.looseObject({ csrf: z.literal(csrf), prompt: z.string().trim().min(1).max(8000) });

const Action = z.looseObject({ csrf: z.literal(csrf), turnId: z.uuid(), optionId: z.string().nullable().optional() });

interface BootstrapReply {
  csrf: string;
  stored: boolean;
  readiness: { opencode: boolean };
  consoleUsage: null;
  harness: "opencode";
  conversations: Conversation[];
}

type Reply = ChatView | BootstrapReply | { id: string } | { error: string } | { ok: true };

const json = (response: ServerResponse, value: Reply, status = 200) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const route = async (request: IncomingMessage, response: ServerResponse, path: string) => {
  const method = request.method ?? "GET";
  const match = /^\/api\/chat\/([0-9a-f-]{36})(\/[a-z-]+)?$/.exec(path);
  const chat = match?.[1] ? chats.get(match[1]) : undefined;

  if (path === "/api/chat" && method === "GET") {
    const conversations = [...chats.values()].map((item) => view(item).conversation);

    return json(response, { csrf, stored: true, readiness: { opencode: true }, consoleUsage: null, harness: "opencode", conversations });
  }

  if (path === "/api/chat" && method === "POST") {
    Authorized.parse(await body(request));
    const id = crypto.randomUUID();
    seed(id, "New conversation", "opencode", 0, []);

    return json(response, { id });
  }

  if (path === "/api/chat/cancel" && method === "POST") {
    const action = Action.parse(await body(request));

    for (const item of chats.values()) {
      const turn = item.turns.find((candidate) => candidate.id === action.turnId);

      if (!turn) continue;
      turn.status = "cancelled";
      turn.stop_reason = "cancelled";
      turn.permission = null;
      approvals.get(turn.id)?.(null);
      push(item);
    }

    return json(response, { ok: true });
  }

  if (path === "/api/chat/approve" && method === "POST") {
    const action = Action.parse(await body(request));
    approvals.get(action.turnId)?.(action.optionId ?? null);

    return json(response, { ok: true });
  }

  if (!chat) return json(response, { error: "Not found" }, 404);

  if (!match?.[2] && method === "GET") return json(response, view(chat));

  if (match?.[2] === "/prepare" && method === "POST") return json(response, { ok: true });

  if (match?.[2] === "/events" && method === "GET") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const set = listeners.get(chat.conversation.id) ?? new Set<ServerResponse>();
    set.add(response);
    listeners.set(chat.conversation.id, set);
    request.on("close", () => set.delete(response));
    response.write(`data: ${JSON.stringify(view(chat))}\n\n`);

    return undefined;
  }

  if (!match?.[2] && method === "POST") {
    const start = Prompt.parse(await body(request));

    if (chat.turns.some((turn) => turn.status === "running")) return json(response, { error: "A turn is already running" }, 409);

    const turn: Turn = { id: crypto.randomUUID(), ordinal: chat.turns.length + 1, prompt: start.prompt, answer: "", activity: [], permission: null,
      attachments: [], status: "running", stop_reason: null };

    chat.turns.push(turn);

    if (chat.conversation.title === "New conversation") chat.conversation.title = start.prompt.slice(0, 60);
    push(chat);
    void run(chat, turn);

    return json(response, { id: turn.id });
  }

  return json(response, { error: "Not found" }, 404);
};

export const fixtureBackend: Plugin = {
  name: "camenae-fixture-backend",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;

      if (!path.startsWith("/api/chat")) return next();
      route(request, response, path).catch(() => { if (!response.headersSent) json(response, { error: "Invalid request" }, 400); });
    });
  },
};
