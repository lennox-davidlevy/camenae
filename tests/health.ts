import assert from "node:assert/strict";
import { z } from "zod";

const mode = z.enum(["ready", "database-down"]).parse(process.argv[2]);

const base = "http://127.0.0.1:3000";

const get = (path: string) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });

const live = await get("/health/live");

assert.equal(live.status, 200);

assert.equal(await live.text(), "ok");

const ready = await get("/health/ready");

assert.equal(ready.status, mode === "ready" ? 200 : 503);

assert.equal(await ready.text(), mode === "ready" ? "ready" : "unavailable");

assert.equal(ready.headers.get("cache-control"), "no-store");

// Future data/action routes remain closed.
for (const path of ["/api/sessions", "/files", "/auth/status"]) {
  const response = await get(path);
  assert.equal(response.status, 404);
}

console.log(JSON.stringify({ event: "health_check_passed", mode }));
