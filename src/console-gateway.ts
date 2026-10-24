import { timingSafeEqual } from "node:crypto";
import { Config, Effect, Layer, Redacted } from "effect";
import { z } from "zod";
import { Identity, IdentityError } from "./identity.js";
import { openCodeSettings } from "./opencode-runtime.js";
import { ConsoleModel } from "./console-contract.js";

// Explicitly admit only Chat Completions fields; routing/fallback extensions
// must never turn a free-model request into a different billed operation.
const Completion = z.strictObject({
  model: ConsoleModel, messages: z.array(z.unknown()).min(1),
  max_tokens: z.number().int().min(1).max(2048), stream: z.boolean().optional(),
  max_completion_tokens: z.number().int().min(1).max(2048).optional(), store: z.literal(false).optional(),
  stream_options: z.strictObject({ include_usage: z.boolean() }).optional(),
  tools: z.array(z.unknown()).optional(), tool_choice: z.unknown().optional(),
  temperature: z.number().optional(), top_p: z.number().optional(),
  frequency_penalty: z.number().optional(), presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(), seed: z.number().int().optional(),
  parallel_tool_calls: z.boolean().optional(), n: z.literal(1).optional(),
});

export const ConsoleGatewayLive = Layer.effectDiscard(Effect.gen(function* () {
  const settings = yield* openCodeSettings;

  if (!settings.consoleFree) return;

  if (!settings.url || !Redacted.value(settings.password)) return yield* new IdentityError();
  const identity = yield* Identity;
  // Private inference-network listener. Never published by ingress.
  const host = yield* Config.String("CAMENAE_GATEWAY_HOST").pipe(Config.withDefault("127.0.0.1"));
  const expected = Buffer.from(`Bearer ${Redacted.value(settings.password)}`);
  yield* Effect.acquireRelease(Effect.try(() => Bun.serve({
    hostname: host, port: 3003, maxRequestBodySize: 2_000_000, idleTimeout: 120,
    async fetch(request) {
      const authorization = Buffer.from(request.headers.get("authorization") ?? "");

      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return new Response("Unauthorized", { status: 401 });

      const url = new URL(request.url);

      if (request.method !== "POST" || url.pathname !== "/v1/chat/completions" || url.search) return new Response("Endpoint not permitted", { status: 403 });

      try {
        const bytes = await request.text();

        if (!Completion.safeParse(JSON.parse(bytes)).success) return new Response("Free-only policy refused request", { status: 403 });

        // Atomic persistent admission counts failed upstream requests too. Saving
        // or removing a credential never resets the installation allowance.
        const key = await Effect.runPromise(identity.admitConsoleRequest());
        const headers = new Headers({ "content-type": "application/json", authorization: `Bearer ${Redacted.value(key)}` });

        for (const name of ["user-agent", "x-opencode-session", "x-opencode-session-id", "x-opencode-parent-session-id", "x-session-affinity", "x-session-id", "x-parent-session-id", "x-opencode-project", "x-opencode-client"]) {
          const value = request.headers.get(name);

          if (value) headers.set(name, value);
        }

        const response = await fetch("https://opencode.ai/zen/v1/chat/completions", {
          method: "POST", headers, body: bytes, redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
        });

        // Never expose upstream error bodies/headers (which can echo credentials).
        if (!response.ok) {
          await response.body?.cancel();

          return new Response("Console request refused", { status: 502 });
        }

        return new Response(response.body, { headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch {
        return new Response("Console unavailable; check saved key and request allowance", { status: 503 });
      }
    },
  })), (server) => Effect.promise(async () => { await server.stop(true); }));
}));
