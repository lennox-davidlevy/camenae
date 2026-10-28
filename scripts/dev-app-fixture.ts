import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { AttachmentPaths } from "../src/file-contract.js";
import { filesRoute, fixtureFileSize } from "./dev-app-files.js";
import { skillsRoute } from "./dev-app-skills.js";
import { appsRoute } from "./dev-app-apps.js";
import { z } from "zod";
import type { ChatView, Conversation, Turn } from "../src/chat-contract.js";
import { ConsoleModel, consoleExhausted, consoleModel, SaveConsoleBudget, SaveConsoleSettings } from "../src/console-contract.js";
import type { WelcomeQuote } from "../src/quotes-contract.js";
import { pickQuote, readQuotes } from "../src/quotes.js";

const minute = 60_000;

const day = 24 * 60 * minute;

const csrf = "fixture";

// Synthetic data only: nothing here is read from an installation. State lives in this
// dev server's memory and resets when it restarts.
interface Chat {
  conversation: Conversation;
  turns: Turn[];
  model: ConsoleModel;
  usage: ChatView["usage"];
}

const chats = new Map<string, Chat>();

const listeners = new Map<string, Set<ServerResponse>>();

const approvals = new Map<string, (optionId: string | null) => void>();

// Provider settings state, shaped like the real endpoints: one saved key and a request allowance.
interface ProviderState {
  stored: boolean;
  used: number;
  limit: number | null;
  revision: number;
}

const provider: ProviderState = { stored: true, used: 3, limit: 20, revision: 0 };

const usage = () => ({ used: provider.used, limit: provider.limit, revision: provider.revision });

const ready = () => provider.stored && !consoleExhausted(usage());

const conversation = (id: string, title: string, harness: "opencode", age: number, toolCount: number): Conversation => ({
  id, title, harness, toolCount, createdAt: Date.now() - age - 5 * minute, updatedAt: Date.now() - age,
});

const finished = (ordinal: number, prompt: string, answer: string): Turn => ({
  id: crypto.randomUUID(), ordinal, prompt, answer, reasoning: "The user wants a reply; keep it short.", retry: null, activity: [{ id: `seed-${ordinal}`, title: "Read file · notes.md", status: "completed" }],
  permission: null, attachments: [], status: "completed", stop_reason: "end_turn",
});

const seed = (id: string, title: string, harness: "opencode", age: number, turns: Turn[]) =>
  chats.set(id, { conversation: conversation(id, title, harness, age, turns.reduce((sum, turn) => sum + turn.activity.length, 0)), turns, model: consoleModel, usage: null });

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
  harness: chat.conversation.harness, model: chat.model, turns: chat.turns, usage: chat.usage,
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

  // A prompt containing "retry" shows the notice for a provider that asked the harness to wait.
  if (turn.prompt.includes("retry")) {
    turn.retry = { attempt: 2, at: Date.now() + 3000, category: "rate-limit", status: 429 };
    push(chat);
    await sleep(3000);
    turn.retry = null;
  }

  for (const word of "Working out what was asked before answering.".split(/(\s+)/)) {
    if (!live()) return;
    turn.reasoning += word;
    push(chat);
    await sleep(40);
  }

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

  const note = turn.attachments.length > 0 ? ` (I can see the attached files: ${turn.attachments.map((file) => file.path).join(", ")})` : "";

  for (const word of words(`${turn.prompt}${note}`)) {
    if (!live()) return;
    turn.answer += word;
    push(chat);
    await sleep(70);
  }

  if (live()) {
    turn.status = "completed";
    turn.stop_reason = "end_turn";
    chat.usage = { harness: "opencode", costUSD: 0, inputTokens: (chat.usage?.inputTokens ?? 0) + turn.prompt.length * 4, outputTokens: (chat.usage?.outputTokens ?? 0) + turn.answer.length };
    push(chat);
  }
};

const body = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  return z.looseObject({}).parse(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
};

const Authorized = z.looseObject({ csrf: z.literal(csrf) });

const Prompt = z.looseObject({ csrf: z.literal(csrf), prompt: z.string().trim().min(1).max(8000), attachments: AttachmentPaths.default([]) });

const Action = z.looseObject({ csrf: z.literal(csrf), turnId: z.uuid(), optionId: z.string().nullable().optional() });

interface SettingsReply {
  provider: "console";
  model: string;
  enabled: boolean;
  stored: boolean;
  used: number;
  limit: number | null;
  revision: number;
}

interface BootstrapReply {
  csrf: string;
  stored: boolean;
  readiness: { opencode: boolean };
  consoleUsage: { used: number; limit: number | null; revision: number };
  harness: "opencode";
  conversations: Conversation[];
}

type Reply = ChatView | BootstrapReply | SettingsReply | WelcomeQuote | { id: string } | { error: string } | { ok: true };

const json = (response: ServerResponse, value: Reply, status = 200) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const settingsReply = (): SettingsReply => ({ provider: "console", model: consoleModel, enabled: true, stored: provider.stored, ...usage() });

const settingsRoute = async (request: IncomingMessage, response: ServerResponse, path: string) => {
  const method = request.method ?? "GET";

  if (path === "/api/settings/opencode" && method === "GET") return json(response, settingsReply());

  if (method !== "POST") return json(response, { error: "Not found" }, 404);

  const input = await body(request);

  Authorized.parse(input);

  if (path === "/api/settings/opencode") {
    SaveConsoleSettings.parse(input);
    provider.stored = true;
  } else if (path === "/api/settings/opencode/remove") {
    provider.stored = false;
  } else if (path === "/api/settings/opencode/budget") {
    const budget = SaveConsoleBudget.parse(input);

    if (budget.revision !== provider.revision) return json(response, { error: "Allowance changed elsewhere" }, 409);
    provider.limit = budget.limit;

    if (budget.refresh) provider.used = 0;
    provider.revision += 1;
  } else return json(response, { error: "Not found" }, 404);

  return json(response, settingsReply());
};

const route = async (request: IncomingMessage, response: ServerResponse, path: string) => {
  const method = request.method ?? "GET";

  if (path.startsWith("/api/settings/opencode")) return settingsRoute(request, response, path);

  const match = /^\/api\/chat\/([0-9a-f-]{36})(\/[a-z-]+)?$/.exec(path);
  const chat = match?.[1] ? chats.get(match[1]) : undefined;

  if (path === "/api/chat" && method === "GET") {
    const conversations = [...chats.values()].map((item) => view(item).conversation);

    return json(response, { csrf, stored: provider.stored, readiness: { opencode: ready() }, consoleUsage: usage(), harness: "opencode", conversations });
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

  if (match?.[2] === "/model" && method === "POST") {
    const input = await body(request);

    Authorized.parse(input);

    if (chat.turns.some((turn) => turn.status === "running")) return json(response, { error: "A turn is still running" }, 409);
    chat.model = ConsoleModel.parse(input.model);

    return json(response, view(chat));
  }

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

    if (!ready()) return json(response, { error: "Provider not ready" }, 503);
    const attached = start.attachments.map((path) => ({ path, size: fixtureFileSize(path) }));

    // Like the real route: every attachment must be a file that exists in the workspace.
    if (attached.some((file) => file.size === undefined)) return json(response, { error: "Attachment unavailable" }, 400);
    provider.used += 1;

    const turn: Turn = { id: crypto.randomUUID(), ordinal: chat.turns.length + 1, prompt: start.prompt, answer: "", reasoning: "", retry: null, activity: [], permission: null,
      attachments: attached.flatMap((file) => file.size === undefined ? [] : [{ path: file.path, size: file.size }]), status: "running", stop_reason: null };

    chat.turns.push(turn);

    if (chat.conversation.title === "New conversation") chat.conversation.title = start.prompt.slice(0, 60);
    push(chat);
    void run(chat, turn);

    return json(response, { id: turn.id });
  }

  return json(response, { error: "Not found" }, 404);
};

// Quotes come from the repository's data directory: the committed set, plus the private 40k set when this
// checkout has it. Read on each request so a rebuilt dataset shows up without restarting the dev server.
const quoteData = new URL("../data", import.meta.url).pathname;

const quoteRoute = async (response: ServerResponse) => {
  const quote = pickQuote(await readQuotes(quoteData), Math.random);

  return quote ? json(response, quote) : json(response, { error: "No quotes" }, 404);
};

export const fixtureBackend: Plugin = {
  name: "camenae-fixture-backend",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;

      if (path === "/api/quote") {
        void quoteRoute(response);

        return undefined;
      }

      if (path.startsWith("/api/apps")) {
        void appsRoute(request, response, path);

        return undefined;
      }

      if (path.startsWith("/api/skills")) {
        void skillsRoute(request, response, path);

        return undefined;
      }

      if (path.startsWith("/api/files")) {
        void filesRoute(request, response, path);

        return undefined;
      }

      if (!path.startsWith("/api/chat") && !path.startsWith("/api/settings/opencode")) return next();
      route(request, response, path).catch(() => { if (!response.headersSent) json(response, { error: "Invalid request" }, 400); });
    });
  },
};
