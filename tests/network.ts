import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const ingressAddress = z.ipv4().parse(process.argv[2]);

// The smoke first reaches this same listener from ingress itself. App must not
// reach its non-internal address or acquire an ordinary outbound default route.
await assert.rejects(fetch(`http://${ingressAddress}:8080/health/ready`, {
  signal: AbortSignal.timeout(3_000),
}));

const routes = await readFile("/proc/net/route", "utf8");

assert.ok(!routes.split("\n").some((line) => line.trim().split(/\s+/)[1] === "00000000"));

console.log("Application network check passed: no default route and no access to frontend listener.");
