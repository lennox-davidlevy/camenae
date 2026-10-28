import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { z } from "zod";
import { Chat } from "./chat.js";
import { AccessDenied, Identity, IdentityError } from "./identity.js";
import { EnableSkill, FailureCode, failureMessages, RemoveSkill, SaveSkill } from "./skills-contract.js";
import { enableSkill, listSkills, removeSkill, saveSkill, SkillProblem } from "./skills-store.js";
import { Workspace } from "./workspace.js";

class SkillFailure extends Schema.TaggedError<SkillFailure>()("SkillFailure", { code: Schema.String }) {}

const statuses = { INVALID: 400, NOT_FOUND: 404, EXISTS: 409, TOO_MANY: 409 } satisfies Record<FailureCode, number>;

export const SkillRoutes = HttpRouter.use(Effect.fn("Skills.routes")(function* (router) {
  const identity = yield* Identity;
  const chat = yield* Chat;
  const { skills } = yield* Workspace;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const cookie = identity.secureCookie ? "__Host-camenae" : "camenae-local";
  const json = <T,>(value: T, status = 200) => HttpServerResponse.jsonUnsafe(value, { status, headers });

  const run = <A,>(work: () => Promise<A>) => Effect.tryPromise({
    try: work,
    catch: (error) => new SkillFailure({ code: error instanceof SkillProblem ? error.code : "INVALID" }),
  });

  const handled = (handler: Effect.Effect<HttpServerResponse.HttpServerResponse, SkillFailure | AccessDenied | IdentityError,
    HttpServerRequest.HttpServerRequest>) => handler.pipe(Effect.catchTags({
    AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
    IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
    SkillFailure: (failure) => {
      const parsed = FailureCode.safeParse(failure.code);
      const code = parsed.success ? parsed.data : "INVALID";

      return Effect.succeed(json({ code, message: failureMessages[code] }, statuses[code]));
    },
  }));

  const list = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    yield* identity.session(request.cookies[cookie] ?? "");

    return json({ skills: yield* run(() => listSkills(skills)) });
  });

  // Session cookie, exact Origin, JSON body and CSRF token, like every other write.
  const write = <S extends z.ZodType<{ csrf: string }>>(schema: S, apply: (input: z.output<S>) => Promise<void>) => Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = request.cookies[cookie] ?? "";
    yield* identity.session(token);

    if (request.headers.origin !== identity.origin || request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return yield* new SkillFailure({ code: "INVALID" });
    }

    const parsed = schema.safeParse(yield* request.json.pipe(Effect.mapError(() => new SkillFailure({ code: "INVALID" }))));

    if (!parsed.success) return yield* new SkillFailure({ code: "INVALID" });
    yield* identity.authorize(token, parsed.data.csrf);
    yield* run(() => apply(parsed.data));
    // The harness picks the change up before its next turn, never during one.
    yield* chat.skillsChanged;

    return json({ ok: true });
  });

  yield* router.add("GET", "/api/skills", handled(list));
  yield* router.add("POST", "/api/skills/save", handled(write(SaveSkill, (input) => saveSkill(skills, input.name, input.content))));
  yield* router.add("POST", "/api/skills/enable", handled(write(EnableSkill, (input) => enableSkill(skills, input.name, input.enabled))));
  yield* router.add("POST", "/api/skills/remove", handled(write(RemoveSkill, (input) => removeSkill(skills, input.name))));
}));
