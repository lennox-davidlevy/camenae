import { Effect, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { AccessDenied, Identity, IdentityError, LoginLimited } from "./identity.js";

class InvalidForm extends Schema.TaggedError<InvalidForm>()("InvalidForm", {}) {}

class InvalidOrigin extends Schema.TaggedError<InvalidOrigin>()("InvalidOrigin", {}) {}

const headers = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  // no-referrer makes browser navigation POSTs send Origin:null, breaking login CSRF checks.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

const page = (body: string) => HttpServerResponse.text(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Camenae</title></head><body><main><h1>Camenae</h1>${body}</main></body></html>`, { headers, contentType: "text/html" });

const redirect = (location: string) => HttpServerResponse.empty({ status: 303, headers: { ...headers, location } });

const failure = (status: number, message: string) => Effect.succeed(HttpServerResponse.text(message, { status, headers }));

const Login = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) });

const Csrf = z.object({ csrf: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

const Key = Csrf.extend({ key: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/) });

const respond = (handler: Effect.Effect<HttpServerResponse.HttpServerResponse,
  InvalidForm | InvalidOrigin | AccessDenied | LoginLimited | IdentityError, HttpServerRequest.HttpServerRequest>) =>
  handler.pipe(Effect.catchTags({
    InvalidForm: () => failure(400, "Invalid form"),
    InvalidOrigin: () => failure(403, "Invalid origin"),
    AccessDenied: () => failure(401, "Authentication or CSRF check failed"),
    LoginLimited: () => failure(429, "Wait at least five seconds before trying again"),
    IdentityError: () => failure(503, "Unavailable"),
  }));

export const AuthRoutes = HttpRouter.use(Effect.fn("Auth.routes")(function* (router) {
  const identity = yield* Identity;
  const cookieName = identity.secureCookie ? "__Host-camenae" : "camenae-local";
  const cookieOptions = { httpOnly: true, secure: identity.secureCookie, sameSite: "strict", path: "/" } as const;
  const token = Effect.map(HttpServerRequest.HttpServerRequest, (request) => request.cookies[cookieName] ?? "");

  const form = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (request.headers.origin !== identity.origin) return yield* new InvalidOrigin();

    if (request.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") {
      return yield* new InvalidForm();
    }

    const body = yield* request.text.pipe(
      Effect.mapError(() => new InvalidForm()),
    );

    return Object.fromEntries(new URLSearchParams(body));
  });

  const login = Effect.gen(function* () {
    const parsed = Login.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    const sessionToken = yield* identity.login(parsed.data.username, Redacted.make(parsed.data.password));

    return HttpServerResponse.setCookieUnsafe(redirect("/"), cookieName, sessionToken, {
      ...cookieOptions, maxAge: "8 hours",
    });
  });

  const home = Effect.gen(function* () {
    const sessionToken = yield* token;
    const csrf = yield* identity.session(sessionToken);
    const connected = yield* identity.status(sessionToken);
    const hidden = `<input type="hidden" name="csrf" value="${csrf}">`;

    return page(`<p><a href="/chat">Open chat</a></p><h2>Harness connection · Bob</h2><p>${connected ? "Key saved (not verified)." : "No key saved."}</p>
      <p>Local development only. Saving a key does not contact Bob or enable agent execution.
      Chat uses an isolated worker with access only to Bob's inference endpoint. Bob/tools can still see a runtime API key when supplied.</p>
      <form method="post" action="/connection/bob">${hidden}<label>Bob API key
      <input type="password" name="key" required maxlength="4096" autocomplete="off"></label>
      <button type="submit">${connected ? "Replace" : "Save"} key</button></form>
      <form method="post" action="/connection/bob/remove">${hidden}<button type="submit">Remove key</button></form>
      <form method="post" action="/auth/logout">${hidden}<button type="submit">Log out</button></form>`);
  }).pipe(Effect.catchTag("AccessDenied", () => Effect.succeed(redirect("/auth/login"))));

  const logout = Effect.gen(function* () {
    const parsed = Csrf.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    yield* identity.logout(yield* token, parsed.data.csrf);

    return HttpServerResponse.setCookieUnsafe(redirect("/auth/login"), cookieName, "", { ...cookieOptions, maxAge: 0 });
  });

  const replace = Effect.gen(function* () {
    const parsed = Key.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    yield* identity.replaceKey(yield* token, parsed.data.csrf, Redacted.make(parsed.data.key));

    return redirect("/");
  });

  const remove = Effect.gen(function* () {
    const parsed = Csrf.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    yield* identity.removeKey(yield* token, parsed.data.csrf);

    return redirect("/");
  });

  const status = Effect.gen(function* () {
    const stored = yield* identity.status(yield* token);

    return HttpServerResponse.jsonUnsafe({ stored, verified: false }, { headers });
  });

  yield* router.add("GET", "/auth/login", page(`<h2>Local login</h2>
    <form method="post" action="/auth/login"><label>Username <input name="username" value="owner" autocomplete="username" required></label>
    <label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
    <button type="submit">Log in</button></form>`));

  for (const [method, path, handler] of [
    ["GET", "/", home], ["POST", "/auth/login", login], ["POST", "/auth/logout", logout],
    ["GET", "/api/connection/bob", status], ["POST", "/connection/bob", replace],
    ["POST", "/connection/bob/remove", remove],
  ] as const) {
    yield* router.add(method, path, respond(handler));
  }
}));
