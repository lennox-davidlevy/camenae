import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { Configuration } from "./configuration.js";
import { Installation } from "./installation.js";
import { Workspace } from "./workspace.js";
import { AuthRoutes } from "./auth-routes.js";
import { ChatRoutes } from "./chat-routes.js";
import { FileRoutes } from "./files.js";

const Routes = HttpRouter.use(Effect.fn("Health.routes")(function* (router) {
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
    maxRequestBodySize: 16 * 1024,
    gracefulShutdownTimeout: "10 seconds",
  });
}));

export const ServerLive = HttpRouter.serve(Layer.mergeAll(Routes, AuthRoutes, ChatRoutes, FileRoutes), { disableLogger: true }).pipe(
  Layer.provide(Transport),
);
