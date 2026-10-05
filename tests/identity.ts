import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Config, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";

const mode = z.enum(["seed", "verify"]).parse(process.argv[2]);

const input = await Bun.stdin.text();

const saved = mode === "verify" ? z.object({ password: z.string(), cookie: z.string() }).parse(JSON.parse(input)) : undefined;

const password = saved?.password ?? input.trim();

const base = "http://127.0.0.1:3000";

const syntheticKey = "synthetic-onboarding-key-never-used-for-inference";

let cookie = saved?.cookie ?? "";

const get = (path: string) => fetch(base + path, {
  headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(10_000),
});

const post = (path: string, fields: URLSearchParams, origin = base) => fetch(base + path, {
  method: "POST", headers: { cookie, origin }, body: fields,
  redirect: "manual", signal: AbortSignal.timeout(10_000),
});

const csrf = async () => {
  const response = await get("/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.ok(!html.includes(syntheticKey));
  const match = html.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/);
  assert.ok(match?.[1]);

  return match[1];
};

const resetAdmission = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE local_account SET next_login_at = now() - interval '1 second'`;
}).pipe(Effect.provide(DatabaseLive));

const login = async () => {
  await Effect.runPromise(resetAdmission);
  const response = await post("/auth/login", new URLSearchParams({ username: "owner", password }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const header = response.headers.get("set-cookie") ?? "";
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Max-Age=28800/i);
  assert.match(header, /Path=\//i);
  cookie = header.split(";")[0] ?? "";
  assert.ok(cookie.startsWith("camenae-local="));
};

const status = async (stored: boolean) => {
  const response = await get("/api/connection/bob");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stored, verified: false });
};

const inspectStorage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const file = yield* Config.String("CAMENAE_CREDENTIALS_FILE");
  const secret = z.object({ encryptionKey: z.string() }).parse(JSON.parse(yield* Effect.promise(() => readFile(file, "utf8"))));

  const rows = z.array(z.object({ encrypted_key: z.string(), id: z.string() })).parse(
    yield* sql`SELECT encrypted_key, id FROM bob_connection CROSS JOIN installation`);

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.ok(!row.encrypted_key.includes(syntheticKey));
  const bytes = Buffer.from(row.encrypted_key, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(secret.encryptionKey, "hex"), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  decipher.setAAD(Buffer.from(`camenae:bob-key:v1:${row.id}`));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  assert.equal(plaintext, syntheticKey);

  const sessions = z.array(z.object({ token_hash: z.string(), password_hash: z.string() })).parse(
    yield* sql`SELECT token_hash, password_hash FROM login_session CROSS JOIN local_account`);

  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.ok(session);
  const rawToken = cookie.split("=")[1] ?? "";
  assert.equal(session.token_hash, createHash("sha256").update(rawToken).digest("hex"));
  assert.notEqual(session.password_hash, password);
  assert.match(session.password_hash, /^\$argon2id\$/);
}).pipe(Effect.provide(DatabaseLive));

if (mode === "seed") {
  assert.equal((await get("/")).status, 303);
  assert.equal((await get("/api/connection/bob")).status, 401);
  assert.equal((await get("/auth/login")).status, 200);

  // Valid login fields isolate the transport body bound from field validation.
  assert.equal((await post("/auth/login", new URLSearchParams({
    username: "owner", password, padding: "x".repeat(20_000),
  }))).status, 413);

  for (const origin of ["https://attacker.invalid", "null", ""]) {
    assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password }), origin)).status, 403);
  }

  assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password: "wrong" }))).status, 401);
  assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password }))).status, 429);
  await login();
  await status(false);
  const token = await csrf();

  for (const path of ["/connection/bob", "/connection/bob/remove", "/auth/logout"]) {
    assert.equal((await post(path, new URLSearchParams({ csrf: "a".repeat(43), key: syntheticKey }))).status, 401);
    assert.equal((await post(path, new URLSearchParams({ csrf: token, key: syntheticKey }), "https://attacker.invalid")).status, 403);
  }

  assert.equal((await post("/connection/bob", new URLSearchParams({ csrf: token, key: "x".repeat(4097) }))).status, 400);
  assert.equal((await post("/connection/bob", new URLSearchParams({ csrf: token, key: "first-synthetic-key" }))).status, 303);
  await status(true);
  assert.equal((await post("/connection/bob", new URLSearchParams({ csrf: token, key: syntheticKey }))).status, 303);
  await Effect.runPromise(inspectStorage);
  await csrf();
  // The shell captures this in a private host file, never in logs or Bob's volumes.
  console.log(JSON.stringify({ password, cookie }));
} else {
  await status(true);
  await csrf();
  await Effect.runPromise(inspectStorage);
  const oldCookie = cookie;
  await login();
  const currentCookie = cookie;
  cookie = oldCookie;
  assert.equal((await get("/api/connection/bob")).status, 401);
  cookie = currentCookie;
  const token = await csrf();
  assert.equal((await post("/connection/bob/remove", new URLSearchParams({ csrf: token }))).status, 303);
  await status(false);
  assert.equal((await post("/auth/logout", new URLSearchParams({ csrf: token }))).status, 303);
  assert.equal((await get("/api/connection/bob")).status, 401);
  assert.equal((await post("/connection/bob", new URLSearchParams({ csrf: token, key: syntheticKey }))).status, 401);
  await login();
  const expiringCsrf = await csrf();
  await Effect.runPromise(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE login_session SET expires_at = now() - interval '1 second'`;
  }).pipe(Effect.provide(DatabaseLive)));
  assert.equal((await get("/api/connection/bob")).status, 401);
  assert.equal((await post("/connection/bob", new URLSearchParams({ csrf: expiringCsrf, key: syntheticKey }))).status, 401);
  console.log("Identity smoke passed: login, CSRF, encryption, replacement, retained sessions, expiry, and logout.");
}
