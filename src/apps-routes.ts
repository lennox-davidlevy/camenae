import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { z } from "zod";
import { AccessDenied, Identity, IdentityError } from "./identity.js";
import { AddEntry, AppId, FailureCode, failureMessages, RemoveEntry, UpdateEntry } from "./apps-contract.js";
import { AppProblem, Apps, AppsError } from "./apps-store.js";

class InvalidAppRequest extends Schema.TaggedError<InvalidAppRequest>()("InvalidAppRequest", {}) {}

const statuses = { INVALID: 400, NOT_FOUND: 404, TOO_MANY: 409 } satisfies Record<FailureCode, number>;

export const AppRoutes = HttpRouter.use(Effect.fn("Apps.routes")(function* (router) {
  const identity = yield* Identity;
  const apps = yield* Apps;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const cookie = identity.secureCookie ? "__Host-camenae" : "camenae-local";
  const json = <T,>(value: T, status = 200) => HttpServerResponse.jsonUnsafe(value, { status, headers });
  const failure = (code: FailureCode, problems: readonly string[] = []) => json({ code, message: failureMessages[code], problems }, statuses[code]);

  const handled = (handler: Effect.Effect<HttpServerResponse.HttpServerResponse, AppProblem | AppsError | InvalidAppRequest | AccessDenied | IdentityError,
    HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext>) => handler.pipe(Effect.catchTags({
    AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
    IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
    AppsError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
    InvalidAppRequest: () => Effect.succeed(failure("INVALID")),
    AppProblem: (problem) => {
      const parsed = FailureCode.safeParse(problem.code);

      return Effect.succeed(parsed.success ? failure(parsed.data, problem.problems) : failure("INVALID"));
    },
  }));

  const signedIn = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    yield* identity.session(request.cookies[cookie] ?? "");
  });

  const list = Effect.gen(function* () {
    yield* signedIn;

    return json({ apps: yield* apps.list() });
  });

  const view = Effect.gen(function* () {
    yield* signedIn;
    const parsed = AppId.safeParse((yield* HttpRouter.params).id);

    if (!parsed.success) return yield* new InvalidAppRequest();

    return json(yield* apps.view(parsed.data));
  });

  // Session cookie, exact Origin, JSON body and CSRF token, like every other write.
  const write = <S extends z.ZodType<{ csrf: string }>, A>(schema: S, apply: (input: z.output<S>) => Effect.Effect<A, AppProblem | AppsError>) => Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.cookies[cookie] ?? "";
    yield* identity.session(token);

    if (request.headers.origin !== identity.origin || request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return yield* new InvalidAppRequest();
    }

    const parsed = schema.safeParse(yield* request.json.pipe(Effect.mapError(() => new InvalidAppRequest())));

    if (!parsed.success) return yield* new InvalidAppRequest();
    yield* identity.authorize(token, parsed.data.csrf);

    return json(yield* apply(parsed.data));
  });

  yield* router.add("GET", "/api/apps", handled(list));
  yield* router.add("GET", "/api/apps/:id", handled(view));
  yield* router.add("POST", "/api/apps/entries/add", handled(write(AddEntry, (input) => apps.add(input.app, input.collection, input.values).pipe(Effect.map((entry) => ({ entry }))))));
  yield* router.add("POST", "/api/apps/entries/update", handled(write(UpdateEntry, (input) => apps.update(input.app, input.id, input.values).pipe(Effect.map((entry) => ({ entry }))))));
  yield* router.add("POST", "/api/apps/entries/remove", handled(write(RemoveEntry, (input) => apps.remove(input.app, input.id).pipe(Effect.as({ ok: true })))));
}));
