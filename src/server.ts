import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Configuration } from "./configuration.js";
import { Installation } from "./installation.js";
import { Workspace } from "./workspace.js";
import { AuthRoutes } from "./auth-routes.js";
import { ChatRoutes } from "./chat-routes.js";
import { FileRoutes } from "./files.js";
import { ConsoleGatewayLive } from "./console-gateway.js";

const Routes = HttpRouter.use(Effect.fn("Health.routes")(function* (router) {
  yield* router.addGlobalMiddleware((handler) => Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URL(request.url, "http://camenae.invalid").pathname;

    if (request.method === "POST" && path === "/api/files") return yield* handler;

    if (Number(request.headers["content-length"] ?? 0) > 16 * 1024) return HttpServerResponse.empty({ status: 413 });

    // Bun does not expose GET/HEAD bodies to its readers. Refuse chunked
    // framing on these bodyless endpoints rather than accepting unchecked data.
    if ((request.method === "GET" || request.method === "HEAD") && request.headers["transfer-encoding"]) return HttpServerResponse.empty({ status: 400 });
    // Bun's request.text is cached and shared by its JSON/form readers. Check
    // actual bytes too, so chunked requests cannot bypass the non-upload limit.
    const text = yield* request.text.pipe(Effect.orElseSucceed(() => undefined));

    if (text === undefined) return HttpServerResponse.empty({ status: 400 });

    if (Buffer.byteLength(text) > 16 * 1024) return HttpServerResponse.empty({ status: 413 });

    return yield* handler;
  }));
  const installation = yield* Installation;
  yield* Workspace;
  const headers = { "cache-control": "no-store" };
  yield* router.add("GET", "/health/live", HttpServerResponse.text("ok", { headers }));
  yield* router.add("GET", "/health/ready", installation.check().pipe(
    Effect.as(HttpServerResponse.text("ready", { headers })),
    Effect.catchTag("DatabaseError", () => Effect.succeed(
      HttpServerResponse.text("unavailable", { status: 503, headers }),
    )),
  ));
}));

const Transport = Layer.unwrap(Effect.gen(function* () {
  const { settings } = yield* Configuration;

  return BunHttpServer.layer({
    hostname: settings.host, port: settings.port,
    // A 64 KiB text upload can expand sixfold when JSON escapes control characters.
    // Individual route schemas retain their own smaller input limits.
    maxRequestBodySize: 512 * 1024,
    gracefulShutdownTimeout: "10 seconds",
  });
}));

export const ServerLive = HttpRouter.serve(Layer.mergeAll(Routes, AuthRoutes, ChatRoutes, FileRoutes, ConsoleGatewayLive), { disableLogger: true }).pipe(
  Layer.provide(Transport),
);
