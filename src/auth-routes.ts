import { readFile } from "node:fs/promises";
import { Effect, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { AccessDenied, Identity, IdentityError, LoginLimited } from "./identity.js";
import { loginPage, passwordPage } from "./auth-pages.js";
import { pickQuote } from "./quotes.js";
import { Quotes } from "./quotes-service.js";

class InvalidForm extends Schema.TaggedError<InvalidForm>()("InvalidForm", {}) {}

class InvalidOrigin extends Schema.TaggedError<InvalidOrigin>()("InvalidOrigin", {}) {}

const headers = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  // no-referrer makes browser navigation POSTs send Origin:null, breaking login CSRF checks.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

const authPage = (html: string, status = 200) => HttpServerResponse.text(html, { headers, contentType: "text/html", status });

const redirect = (location: string) => HttpServerResponse.empty({ status: 303, headers: { ...headers, location } });

const failure = (status: number, message: string) => Effect.succeed(HttpServerResponse.text(message, { status, headers }));

const Login = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) });

const Csrf = z.object({ csrf: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

const Password = Csrf.extend({
  currentPassword: z.string().min(1).max(256),
  password: z.string().min(15).max(256),
  confirmation: z.string().min(15).max(256),
}).refine((value) => value.password === value.confirmation && value.password !== value.currentPassword);

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
  const quotes = yield* Quotes;
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

  // Each sign-in page carries a fresh quote, chosen on the server: the page itself runs no script.
  const signIn = (message = "", status = 200) => authPage(loginPage(message, pickQuote(quotes, Math.random)), status);

  const login = Effect.gen(function* () {
    const parsed = Login.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    const sessionToken = yield* identity.login(parsed.data.username, Redacted.make(parsed.data.password));

    return HttpServerResponse.setCookieUnsafe(redirect("/chat"), cookieName, sessionToken, {
      ...cookieOptions, maxAge: "8 hours",
    });
  }).pipe(Effect.catchTags({
    InvalidForm: () => Effect.sync(() => signIn("Enter your password to sign in.", 400)),
    AccessDenied: () => Effect.sync(() => signIn("That password was not accepted. Please try again.", 401)),
    LoginLimited: () => Effect.sync(() => signIn("Please wait at least five seconds before trying again.", 429)),
    IdentityError: () => Effect.sync(() => signIn("Sign-in is temporarily unavailable. Please try again shortly.", 503)),
  }));

  const account = (message = "", status = 200, saved = false) => Effect.gen(function* () {
    const csrf = yield* identity.session(yield* token);

    return authPage(passwordPage(csrf, message, saved), status);
  }).pipe(Effect.catchTag("AccessDenied", () => Effect.succeed(redirect("/auth/login"))));

  const changePassword = Effect.gen(function* () {
    const parsed = Password.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    const sessionToken = yield* identity.changePassword(yield* token, parsed.data.csrf,
      Redacted.make(parsed.data.currentPassword), Redacted.make(parsed.data.password));

    return HttpServerResponse.setCookieUnsafe(redirect("/auth/password?saved=1"), cookieName, sessionToken, {
      ...cookieOptions, maxAge: "8 hours",
    });
  }).pipe(Effect.catchTags({
    InvalidForm: () => account("Use a different password of 15–256 characters and make sure both new-password fields match.", 400),
    AccessDenied: () => account("Your current password or session could not be verified. Please try again.", 401),
    LoginLimited: () => account("Please wait at least five seconds before trying again.", 429),
    IdentityError: () => account("Your password could not be changed. Please try again shortly.", 503),
  }));

  const accountPage = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    return yield* account("", 200, new URL(request.url, identity.origin).searchParams.get("saved") === "1");
  });

  const home = Effect.gen(function* () {
    yield* identity.session(yield* token);

    return redirect("/chat");
  }).pipe(Effect.catchTag("AccessDenied", () => Effect.succeed(redirect("/auth/login"))));

  const logout = Effect.gen(function* () {
    const parsed = Csrf.safeParse(yield* form);

    if (!parsed.success) return yield* new InvalidForm();

    yield* identity.logout(yield* token, parsed.data.csrf);

    return HttpServerResponse.setCookieUnsafe(redirect("/auth/login"), cookieName, "", { ...cookieOptions, maxAge: 0 });
  });

  yield* router.add("GET", "/auth/login", Effect.sync(() => signIn()));
  const css = yield* Effect.tryPromise(() => readFile("src/ui/auth.css"));
  yield* router.add("GET", "/auth.css", HttpServerResponse.uint8Array(css, { contentType: "text/css", headers }));

  for (const [method, path, handler] of [
    ["GET", "/", home], ["POST", "/auth/login", login], ["POST", "/auth/logout", logout],
    ["GET", "/auth/password", accountPage], ["POST", "/auth/password", changePassword],
  ] as const) {
    yield* router.add(method, path, respond(handler));
  }
}));
