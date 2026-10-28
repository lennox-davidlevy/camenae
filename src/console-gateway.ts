import { timingSafeEqual } from "node:crypto";
import { Config, Effect, Layer, Redacted } from "effect";
import { z } from "zod";
import { Identity, IdentityError } from "./identity.js";
import { openCodeSettings } from "./opencode-runtime.js";
import { FreeConsoleModel, PaidConsoleModel } from "./console-contract.js";

// Explicitly admit only Chat Completions fields; routing/fallback extensions
// must never turn a free-model request into a different billed operation.
const Completion = z.strictObject({
  model: FreeConsoleModel, messages: z.array(z.unknown()).min(1),
  max_tokens: z.number().int().min(1).max(2048), stream: z.boolean().optional(),
  max_completion_tokens: z.number().int().min(1).max(2048).optional(), store: z.literal(false).optional(),
  stream_options: z.strictObject({ include_usage: z.boolean() }).optional(),
  tools: z.array(z.unknown()).optional(), tool_choice: z.unknown().optional(),
  temperature: z.number().optional(), top_p: z.number().optional(),
  frequency_penalty: z.number().optional(), presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(), seed: z.number().int().optional(),
  parallel_tool_calls: z.boolean().optional(), n: z.literal(1).optional(),
});

// Billed models: OpenCode owns the Anthropic Messages format, so this checks only what sets the bill.
// Output (and any thinking budget, which must stay below max_tokens) is capped, and billed extras are refused.
const Messages = z.looseObject({
  model: PaidConsoleModel, max_tokens: z.number().int().min(1).max(2048), messages: z.array(z.unknown()).min(1),
  tools: z.array(z.looseObject({ type: z.literal("custom").optional() })).optional(),
  service_tier: z.never().optional(), mcp_servers: z.never().optional(), container: z.never().optional(),
});

// About 100K tokens of input, the boundary above which the paid model's price rises.
const paidBodyLimit = 400_000;

// The betas OpenCode's Anthropic protocol sends. They shape thinking and compaction, not billing;
// Console rejects a request that uses one of these features without its header, so none may be stripped.
const betas = new Set(["interleaved-thinking-2025-05-14", "compact-2026-01-12", "mid-conversation-output-config-2026-07-01", "thinking-binding-controls-2026-08-01"]);

const admits = (schema: z.ZodType, bytes: string) => {
  try { return schema.safeParse(JSON.parse(bytes)).success; } catch { return false; }
};

// OpenCode retries rate limits, 5xx and transport failures. A refusal that another attempt cannot
// change says so, or each attempt would spend more of the allowance.
const final = (body: string, status: number) => new Response(body, { status, headers: { "x-should-retry": "false" } });

// Upstream failures keep their meaning but never their body or headers, which can echo credentials.
const upstreamFailure = (response: Response) => {
  if (response.status === 429) {
    const after = response.headers.get("retry-after") ?? "";

    return new Response("Console rate limit reached", { status: 429, headers: /^\d{1,5}$/.test(after) ? { "retry-after": after } : {} });
  }

  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409) return final("Console request refused", response.status);

  return new Response("Console request failed", { status: 502 });
};

const forwarded = ["user-agent", "x-opencode-session", "x-opencode-session-id", "x-opencode-parent-session-id", "x-session-affinity", "x-session-id", "x-parent-session-id", "x-opencode-project", "x-opencode-client"];

interface Route {
  upstream: string;
  paid: boolean;
  admit: (bytes: string) => boolean;
  headers: (request: Request, key: string) => Headers;
}

const routes = new Map<string, Route>([
  ["/v1/chat/completions", {
    upstream: "https://opencode.ai/zen/v1/chat/completions", paid: false,
    admit: (bytes) => admits(Completion, bytes),
    headers: (_request, key) => new Headers({ "content-type": "application/json", authorization: `Bearer ${key}` }),
  }],
  ["/anthropic/v1/messages", {
    upstream: "https://opencode.ai/inference/anthropic/v1/messages", paid: true,
    admit: (bytes) => Buffer.byteLength(bytes) <= paidBodyLimit && admits(Messages, bytes),
    headers: (request, key) => {
      const headers = new Headers({ "content-type": "application/json", authorization: `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" });
      const requested = (request.headers.get("anthropic-beta") ?? "").split(",").map((beta) => beta.trim()).filter((beta) => betas.has(beta));

      if (requested.length > 0) headers.set("anthropic-beta", requested.join(","));

      return headers;
    },
  }],
]);

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

      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) return final("Unauthorized", 401);

      const url = new URL(request.url);
      const route = routes.get(url.pathname);

      if (request.method !== "POST" || !route || url.search) return final("Endpoint not permitted", 403);

      const bytes = await request.text().catch(() => "");

      if (!route.admit(bytes)) return final("Console policy refused request", 403);

      // Atomic persistent admission counts failed upstream requests too. Saving
      // or removing a credential never resets the installation allowance.
      const key = await Effect.runPromise(identity.admitConsoleRequest(route.paid)).then(Redacted.value, () => undefined);

      if (key === undefined) return final("Console unavailable; check saved key and request allowance", 503);

      const headers = route.headers(request, key);

      for (const name of forwarded) {
        const value = request.headers.get(name);

        if (value) headers.set(name, value);
      }

      try {
        const response = await fetch(route.upstream, {
          method: "POST", headers, body: bytes, redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
        });

        if (!response.ok) {
          await response.body?.cancel();

          return upstreamFailure(response);
        }

        return new Response(response.body, { headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch {
        return new Response("Console unreachable", { status: 502 });
      }
    },
  })), (server) => Effect.promise(async () => { await server.stop(true); }));
}));
