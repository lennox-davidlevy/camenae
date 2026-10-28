import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Identity } from "./identity.js";
import { pickQuote } from "./quotes.js";
import { Quotes } from "./quotes-service.js";

// One random quote for the signed-in app. The sign-in page renders its own on the server.
export const QuoteRoutes = HttpRouter.use(Effect.fn("Quotes.routes")(function* (router) {
  const identity = yield* Identity;
  const quotes = yield* Quotes;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const cookie = identity.secureCookie ? "__Host-camenae" : "camenae-local";

  yield* router.add("GET", "/api/quote", Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    yield* identity.session(request.cookies[cookie] ?? "");
    const quote = pickQuote(quotes, Math.random);

    return quote ? HttpServerResponse.jsonUnsafe(quote, { headers }) : HttpServerResponse.text("No quotes", { status: 404, headers });
  }).pipe(Effect.catchTags({
    AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
    IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
  })));
}));
