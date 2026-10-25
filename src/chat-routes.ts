import { readdir, readFile } from "node:fs/promises";
import { Effect, Redacted, Schedule, Schema, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { Identity } from "./identity.js";
import { Chat, type ChatFailure } from "./chat.js";
import { ChatAction, StartTurn } from "./chat-contract.js";
import { OpenCodeRuntime } from "./opencode-runtime.js";
import { ConsoleModel, consoleModel, SaveConsoleBudget, SaveConsoleSettings } from "./console-contract.js";

class InvalidChatRequest extends Schema.TaggedError<InvalidChatRequest>()("InvalidChatRequest", {}) {}

const headers = {
  "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

const respond = (handler: Effect.Effect<HttpServerResponse.HttpServerResponse, ChatFailure | InvalidChatRequest,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext>) => handler.pipe(Effect.catchTags({
  AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
  IdentityError: () => Effect.succeed(HttpServerResponse.text("Save a valid provider key in connection settings", { status: 503, headers })),
  ChatBusy: () => Effect.succeed(HttpServerResponse.text("Another turn is still running", { status: 409, headers })),
  ChatError: () => Effect.succeed(HttpServerResponse.text("Chat unavailable; check the connection or start a new conversation", { status: 503, headers })),
  AttachmentError: () => Effect.succeed(HttpServerResponse.text("Attachment unavailable or too large. Choose up to four supported UTF-8 text files, 64 KiB total; remove or reselect changed files and try again.", { status: 400, headers })),
  InvalidChatRequest: () => Effect.succeed(HttpServerResponse.text("Invalid request", { status: 400, headers })),
}));

export const ChatRoutes = HttpRouter.use(Effect.fn("Chat.routes")(function* (router) {
  const identity = yield* Identity;
  const chat = yield* Chat;
  const openCode = yield* OpenCodeRuntime;

  const token = Effect.map(HttpServerRequest.HttpServerRequest,
    (request) => request.cookies[identity.secureCookie ? "__Host-camenae" : "camenae-local"] ?? "");

  const id = HttpRouter.params.pipe(Effect.flatMap((params) => Effect.try({
    try: () => z.uuid().parse(params.id), catch: () => new InvalidChatRequest(),
  })));

  const body = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.headers.origin !== identity.origin || request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return yield* new InvalidChatRequest();
    }

    return yield* request.json.pipe(Effect.mapError(() => new InvalidChatRequest()));
  });

  const json = <T,>(value: T) => HttpServerResponse.jsonUnsafe(value, { headers });

  const bootstrap = Effect.gen(function* () {
    const session = yield* token;

    return json({ csrf: yield* identity.session(session), ...yield* chat.connectionStatus(session), conversations: yield* chat.list(session) });
  });

  const create = Effect.gen(function* () {
    const parsed = z.strictObject({ csrf: z.string(), harness: z.enum(["opencode"]).optional() }).safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();

    return json({ id: yield* chat.create(yield* token, parsed.data.csrf, parsed.data.harness) });
  });

  const consoleSettings = Effect.gen(function* () {
    return json({ provider: "console", model: consoleModel, enabled: openCode.configured && openCode.consoleFree,
      ...yield* identity.consoleStatus(yield* token) });
  });

  const saveConsoleSettings = Effect.gen(function* () {
    const parsed = SaveConsoleSettings.safeParse(yield* body);

    if (!parsed.success || !openCode.configured || !openCode.consoleFree) return yield* new InvalidChatRequest();
    yield* identity.replaceConsoleKey(yield* token, parsed.data.csrf, Redacted.make(parsed.data.key));

    return yield* consoleSettings;
  });

  const removeConsoleSettings = Effect.gen(function* () {
    const parsed = z.strictObject({ csrf: z.string() }).safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();
    yield* identity.removeConsoleKey(yield* token, parsed.data.csrf);

    return yield* consoleSettings;
  });

  const saveConsoleBudget = Effect.gen(function* () {
    const parsed = SaveConsoleBudget.safeParse(yield* body);

    if (!parsed.success || !openCode.configured || !openCode.consoleFree) return yield* new InvalidChatRequest();
    const saved = yield* identity.saveConsoleBudget(yield* token, parsed.data);

    if (!saved) return HttpServerResponse.text("Allowance changed elsewhere. Refresh settings before retrying.", { status: 409, headers });

    return yield* consoleSettings;
  });

  const selectModel = Effect.gen(function* () {
    const parsed = z.strictObject({ csrf: z.string(), model: ConsoleModel }).safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();
    const session = yield* token;
    const conversation = yield* id;
    yield* chat.selectModel(session, parsed.data.csrf, conversation, parsed.data.model);

    return json(yield* chat.view(session, conversation));
  });

  const view = Effect.gen(function* () { return json(yield* chat.view(yield* token, yield* id)); });

  const prepare = Effect.gen(function* () {
    const parsed = z.object({ csrf: z.string() }).safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();

    yield* chat.prepare(yield* token, parsed.data.csrf, yield* id);

    return json({ ready: true });
  });

  const start = Effect.gen(function* () {
    const parsed = StartTurn.safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();

    yield* chat.start(yield* token, parsed.data.csrf, yield* id, parsed.data.prompt, parsed.data.attachments);

    return json({ accepted: true });
  });

  const action = (kind: "cancel" | "approve") => Effect.gen(function* () {
    const parsed = ChatAction.safeParse(yield* body);

    if (!parsed.success) return yield* new InvalidChatRequest();

    const session = yield* token;
    const input = parsed.data;

    if (kind === "cancel") yield* chat.cancel(session, input.csrf, input.turnId);
    else {
      if (input.permissionId === undefined || input.optionId === undefined) return yield* new InvalidChatRequest();
      yield* chat.approve(session, input.csrf, input.turnId, input.permissionId, input.optionId);
    }

    return json({ accepted: true });
  });

  const events = Effect.gen(function* () {
    const session = yield* token;
    const conversation = yield* id;
    yield* identity.session(session);
    // Every delivery consults Postgres. Expiry, logout, and DB failure terminate
    // an already-open stream; a browser disconnect does not own the run fiber.

    const stream = Stream.fromEffect(chat.view(session, conversation)).pipe(
      Stream.repeat(Schedule.spaced("250 millis")),
      // Keep the existing view stream open for asynchronous initialization and
      // idle usage updates. Browser disconnect still does not own the harness lifetime.
      Stream.map((snapshot) => `data: ${JSON.stringify(snapshot)}\n\n`),
      Stream.encodeText,
    );

    return HttpServerResponse.stream(stream, { contentType: "text/event-stream", headers: { ...headers, "x-accel-buffering": "no" } });
  });

  for (const [method, path, handler] of [
    ["GET", "/api/settings/opencode", consoleSettings], ["POST", "/api/settings/opencode", saveConsoleSettings],
    ["POST", "/api/settings/opencode/remove", removeConsoleSettings],
    ["POST", "/api/settings/opencode/budget", saveConsoleBudget],
    ["GET", "/api/chat", bootstrap], ["POST", "/api/chat", create],
    ["GET", "/api/chat/:id", view], ["POST", "/api/chat/:id", start],
    ["POST", "/api/chat/:id/prepare", prepare],
    ["POST", "/api/chat/:id/model", selectModel],
    ["GET", "/api/chat/:id/events", events], ["POST", "/api/chat/cancel", action("cancel")],
    ["POST", "/api/chat/approve", action("approve")],
  ] as const) {
    yield* router.add(method, path, respond(handler));
  }

  // The production build of the Solid application (`bun run build:app`): one page and fixed-name hashed assets.
  const shell = yield* Effect.tryPromise(() => readFile("public/app/index.html"));

  const page = Effect.gen(function* () {
    yield* identity.session(yield* token);

    return HttpServerResponse.uint8Array(shell, { contentType: "text/html", headers });
  }).pipe(Effect.catchTags({
    AccessDenied: () => Effect.succeed(HttpServerResponse.empty({ status: 303, headers: { ...headers, location: "/auth/login" } })),
    IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
  }));

  yield* router.add("GET", "/chat", page);

  const fonts = yield* Effect.tryPromise(() => readFile("src/ui/fonts.css"));
  yield* router.add("GET", "/fonts.css", HttpServerResponse.uint8Array(fonts, { contentType: "text/css", headers }));

  const coin = yield* Effect.tryPromise(() => readFile("src/ui/assets/camenae-coin.png"));
  yield* router.add("GET", "/assets/camenae-coin.png", HttpServerResponse.uint8Array(coin, { contentType: "image/png", headers }));

  for (const file of yield* Effect.tryPromise(() => readdir("public/app/assets"))) {
    const content = yield* Effect.tryPromise(() => readFile(`public/app/assets/${file}`));
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : undefined;

    if (contentType) yield* router.add("GET", `/assets/${file}`, HttpServerResponse.uint8Array(content, { contentType, headers }));
  }

  for (const font of ["gloock", "geist", "geist-medium", "geist-semibold", "geist-italic", "geist-mono", "geist-mono-medium"]) {
    const content = yield* Effect.tryPromise(() => readFile(`src/ui/fonts/${font}.ttf`));
    yield* router.add("GET", `/fonts/${font}.ttf`, HttpServerResponse.uint8Array(content, { contentType: "font/ttf", headers }));
  }
}));
