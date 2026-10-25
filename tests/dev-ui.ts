import assert from "node:assert/strict";

// The proxy is the owner of these transport guarantees; backend policy has its
// own coverage. Exercise the executable rather than exporting test-only seams.
let calls = 0;

const backend = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    calls += 1;

    if (new URL(request.url).pathname === "/api/stream") {
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("first\n")); },
      }), { headers: { "content-type": "text/event-stream" } });
    }

    return Response.json({
      origin: request.headers.get("origin"), cookie: request.headers.get("cookie"),
      body: await request.text(), path: new URL(request.url).pathname,
    }, { headers: { "set-cookie": "camenae-local=fixture; HttpOnly; SameSite=Strict; Path=/" } });
  },
});

const child = Bun.spawn([process.execPath, "scripts/dev-app.ts", "--backend", backend.url.origin], {
  env: process.env,
  stdout: "pipe", stderr: "inherit",
});

const origin = "http://127.0.0.1:5174";

try {
  const reader = child.stdout.getReader();
  let startup = "";

  while (!startup.includes("Proxying")) {
    const chunk = await reader.read();

    if (chunk.done) break;
    startup += new TextDecoder().decode(chunk.value);
  }

  assert.match(startup, /Proxying \/api and \/auth to/);
  reader.releaseLock();

  for (const source of [null, "null", "http://untrusted.invalid"]) {
    const headers = new Headers();

    if (source !== null) headers.set("origin", source);

    const denied = await fetch(`${origin}/auth/login`, { method: "POST", headers, body: "secret" });
    assert.equal(denied.status, 403);
  }

  const rebound = await fetch(`${origin}/api/chat`, { headers: { host: "untrusted.invalid" } });
  assert.equal(rebound.status, 403);
  assert.equal(calls, 0, "rejected requests must never reach the backend");

  const response = await fetch(`${origin}/auth/login`, {
    method: "POST", headers: { origin, cookie: "camenae-local=session", "content-type": "application/x-www-form-urlencoded" },
    body: "csrf=token&value=test",
  });

  assert.deepEqual(await response.json(), {
    origin: backend.url.origin, cookie: "camenae-local=session", body: "csrf=token&value=test", path: "/auth/login",
  });
  assert.match(response.headers.get("set-cookie") ?? "", /camenae-local=fixture; HttpOnly; SameSite=Strict; Path=\//);

  const stream = await fetch(`${origin}/api/stream`, { signal: AbortSignal.timeout(5000) });
  const body = stream.body?.getReader();
  assert.ok(body);
  assert.equal(new TextDecoder().decode((await body.read()).value), "first\n", "stream must arrive without waiting for upstream EOF");
  await body.cancel();

  console.log("Dev proxy origin, cookie, request body, and streaming checks passed");
} finally {
  child.kill();
  await child.exited;
  backend.stop(true);
}
