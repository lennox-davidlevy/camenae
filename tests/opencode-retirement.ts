import assert from "node:assert/strict";
import { OpenCode } from "@camenae/opencode";
import { ConfigProvider, Effect } from "effect";
import { z } from "zod";
import { OpenCodeRuntime } from "../src/opencode-runtime.js";

// Transport fault injection only: identity, ownership and container replacement
// come from the real installed SDK/native worker in the disposable smoke project.
const settings = z.object({ CAMENAE_OPENCODE_URL: z.string(), CAMENAE_OPENCODE_PASSWORD: z.string() }).parse(process.env);

const client = await OpenCode.connect({ baseUrl: settings.CAMENAE_OPENCODE_URL, password: settings.CAMENAE_OPENCODE_PASSWORD,
  workspace: "/data/workspace", model: { providerID: "camenae", id: "assistant" } });

let original: string;

try {
  original = z.uuid().parse((await client.native.rpc.call({ rpcID: "camenae.runtime", method: "identity", input: {}, location: { directory: "/data/workspace" } })).output);
  await client.native.rpc.call({ rpcID: "camenae.runtime", method: "claim", input: { owner: crypto.randomUUID() }, location: { directory: "/data/workspace" } });
} finally { await client.close(); }

let lifetime = original;

let quarantined: string | undefined;

let failRetirement = true;

let failures = 0;

let unsafeClaims = 0;

let prompts = 0;

const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, async fetch(request) {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/prompt")) prompts++;

  if (url.pathname === "/api/rpc/camenae.runtime/claim" && lifetime === quarantined) unsafeClaims++;

  if (url.pathname === "/api/rpc/camenae.runtime/retire" && failRetirement) {
    failRetirement = false;
    quarantined = lifetime;
    failures++;

    return new Response("Synthetic transport failure", { status: 503 });
  }

  try {
    const response = await fetch(new Request(new URL(url.pathname + url.search, settings.CAMENAE_OPENCODE_URL), request));

    if (url.pathname === "/api/rpc/camenae.runtime/identity" && response.ok) {
      lifetime = z.object({ output: z.uuid() }).parse(await response.clone().json()).output;
    }

    return response;
  } catch { return new Response("Worker restarting", { status: 503 }); }
} });

try {
  await Effect.runPromise(Effect.gen(function* () {
    const runtime = yield* OpenCodeRuntime;
    let acquired = original;
    yield* Effect.scoped(Effect.gen(function* () {
      yield* runtime.connect();
      assert.notEqual(lifetime, original, "A foreign owner's lifetime was reused");
      assert.equal(failures, 1, "Foreign-owner retirement did not encounter the injected fault");
      acquired = lifetime;
      // Fail this owner's release, then recover using the same application layer.
      failRetirement = true;
    }));
    assert.equal(failures, 2, "Release did not encounter the injected fault");
    yield* Effect.scoped(Effect.gen(function* () {
      yield* runtime.connect();
      assert.notEqual(lifetime, acquired, "A failed release was mistaken for remote cleanup");
    }));
    assert.equal(unsafeClaims, 0, "A quarantined lifetime was reclaimed before replacement");
    assert.equal(prompts, 0, "Readiness recovery must never submit a prompt");
  }).pipe(Effect.provide(OpenCodeRuntime.layer), Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
    CAMENAE_OPENCODE_URL: proxy.url.origin, CAMENAE_OPENCODE_PASSWORD: settings.CAMENAE_OPENCODE_PASSWORD,
  })))));
  console.log("OpenCode retirement recovered from foreign-owner and release transport failures using new native worker lifetimes.");
} finally { await proxy.stop(true); }
