import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { Config, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";
import { consoleModel } from "../src/console-contract.js";

const mode = z.enum(["seed", "verify"]).parse(process.argv[2]);

const input = await Bun.stdin.text();

const saved = mode === "verify" ? z.object({ password: z.string(), cookie: z.string() }).parse(JSON.parse(input)) : undefined;

let password = saved?.password ?? input.trim();

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

interface KeyRequest {
  csrf: string;
  provider: "console";
  model: string;
  key: string;
}

const postJson = (path: string, body: Partial<KeyRequest>, origin = base) => fetch(base + path, {
  method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body),
  redirect: "manual", signal: AbortSignal.timeout(10_000),
});

const saveKey = (token: string, key: string, origin = base) => postJson("/api/settings/opencode", { csrf: token, provider: "console", model: consoleModel, key }, origin);

const csrf = async () => {
  const response = await get("/auth/password");
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
  assert.equal(response.headers.get("location"), "/chat");
  const header = response.headers.get("set-cookie") ?? "";
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
  assert.match(header, /Max-Age=28800/i);
  assert.match(header, /Path=\//i);
  cookie = header.split(";")[0] ?? "";
  assert.ok(cookie.startsWith("camenae-local="));
};

// Provider-key behavior exists only when the deployment enables Console mode.
let keysEnabled = false;

const detectKeys = async () => {
  keysEnabled = z.object({ enabled: z.boolean() }).parse(await (await get("/api/settings/opencode")).json()).enabled;
};

const status = async (stored: boolean) => {
  if (!keysEnabled) return;
  const response = await get("/api/settings/opencode");
  assert.equal(response.status, 200);
  assert.equal(z.object({ stored: z.boolean() }).parse(await response.json()).stored, stored);
};

const inspectStorage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const file = yield* Config.String("CAMENAE_CREDENTIALS_FILE");
  const secret = z.object({ encryptionKey: z.string() }).parse(JSON.parse(yield* Effect.promise(() => readFile(file, "utf8"))));

  if (keysEnabled) {
    const rows = z.array(z.object({ encrypted_key: z.string(), id: z.string() })).parse(
      yield* sql`SELECT encrypted_key, id FROM console_connection CROSS JOIN installation`);

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row);
    assert.ok(!row.encrypted_key.includes(syntheticKey));
    const bytes = Buffer.from(row.encrypted_key, "base64");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(secret.encryptionKey, "hex"), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    decipher.setAAD(Buffer.from(`camenae:console-key:v1:${row.id}`));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    assert.equal(plaintext, syntheticKey);
  }

  const sessions = z.array(z.object({ token_hash: z.string(), password_hash: z.string() })).parse(
    yield* sql`SELECT token_hash, password_hash FROM login_session CROSS JOIN local_account`);

  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.ok(session);
  const rawToken = cookie.split("=")[1] ?? "";
  assert.equal(session.token_hash, createHash("sha256").update(rawToken).digest("hex"));
  assert.notEqual(session.password_hash, password);
  assert.match(session.password_hash, /^\$argon2id\$/);
  assert.equal(yield* Effect.promise(() => Bun.password.verify(password, session.password_hash)), true);
}).pipe(Effect.provide(DatabaseLive));

if (mode === "seed") {
  assert.equal((await get("/")).status, 303);
  assert.equal((await get("/api/settings/opencode")).status, 401);
  assert.equal((await get("/auth/login")).status, 200);
  assert.equal((await get("/auth/password")).headers.get("location"), "/auth/login");

  for (const [path, type] of [["/auth.css", "text/css"], ["/fonts.css", "text/css"],
    ["/fonts/gloock.ttf", "font/ttf"], ["/assets/camenae-coin.png", "image/png"]]) {
    const response = await get(path ?? "");
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.startsWith(type ?? ""));
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }

  // Valid login fields isolate the transport body bound from field validation.
  assert.equal((await post("/auth/login", new URLSearchParams({
    username: "owner", password, padding: "x".repeat(20_000),
  }))).status, 413);

  const chunked = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode(new URLSearchParams({ username: "owner", password, padding: "x".repeat(20_000) }).toString()));
    controller.close();
  } });

  assert.equal((await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { origin: base, "content-type": "application/x-www-form-urlencoded" }, body: chunked })).status, 413);

  // Fetch forbids GET/HEAD bodies; exercise their transport bounds directly.
  for (const method of ["GET", "HEAD"]) {
    for (const chunked of [false, true]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const outgoing = request(base + "/health/live", {
          method, headers: chunked ? { "transfer-encoding": "chunked" } : { "content-length": "20000" },
        }, (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });

        outgoing.on("error", reject);
        outgoing.setTimeout(10_000, () => outgoing.destroy(new Error("Body-limit request timed out")));
        outgoing.end("x".repeat(20_000));
      });

      assert.equal(status, chunked ? 400 : 413, `${method}, chunked=${chunked}`);
    }
  }

  for (const origin of ["https://attacker.invalid", "null", ""]) {
    assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password }), origin)).status, 403);
  }

  assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password: "wrong" }))).status, 401);
  assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password }))).status, 429);
  await login();
  await detectKeys();
  await status(false);
  const token = await csrf();

  assert.equal((await post("/auth/logout", new URLSearchParams({ csrf: "a".repeat(43) }))).status, 401);
  assert.equal((await post("/auth/logout", new URLSearchParams({ csrf: token }), "https://attacker.invalid")).status, 403);

  if (keysEnabled) {
    const keyFields = { provider: "console", model: consoleModel, key: syntheticKey } as const;

    // The removal route accepts only the CSRF field, so it gets no key fields.
    for (const [path, fields] of [["/api/settings/opencode", keyFields], ["/api/settings/opencode/remove", {}]] as const) {
      assert.equal((await postJson(path, { csrf: "a".repeat(43), ...fields })).status, 401);
      assert.equal((await postJson(path, { csrf: token, ...fields }, "https://attacker.invalid")).status, 400);
    }

    assert.equal((await saveKey(token, "x".repeat(4097))).status, 400);
    assert.equal((await saveKey(token, "first-synthetic-key")).status, 200);
    await status(true);
    assert.equal((await saveKey(token, syntheticKey)).status, 200);
  }

  await Effect.runPromise(inspectStorage);
  await csrf();

  // The real password route owns authorization, validation, rate limiting and rotation.
  // Keep the generated files unchanged: they seed new databases, never reset existing ones.
  const credentialsFile = await Effect.runPromise(Effect.gen(function* () { return yield* Config.String("CAMENAE_CREDENTIALS_FILE"); }));
  const credentialsBefore = await readFile(credentialsFile);
  const originalPassword = password;
  const originalCookie = cookie;
  const nextPassword = "synthetic owner passphrase for authentication checks";
  const fields = { csrf: token, currentPassword: password, password: nextPassword, confirmation: nextPassword };
  cookie = "";
  assert.equal((await post("/auth/password", new URLSearchParams(fields))).headers.get("location"), "/auth/login");
  cookie = originalCookie;
  assert.equal((await post("/auth/password", new URLSearchParams(fields), "https://attacker.invalid")).status, 403);
  assert.equal((await post("/auth/password", new URLSearchParams({ ...fields, csrf: "a".repeat(43) }))).status, 401);

  for (const changes of [
    { password: "too-short", confirmation: "too-short" },
    { confirmation: "a different synthetic passphrase" },
    { password: "x".repeat(257), confirmation: "x".repeat(257) },
    { password, confirmation: password },
  ]) {
    assert.equal((await post("/auth/password", new URLSearchParams({ ...fields, ...changes }))).status, 400);
  }

  await Effect.runPromise(resetAdmission);
  const wrong = await post("/auth/password", new URLSearchParams({ ...fields, currentPassword: "wrong" }));
  assert.equal(wrong.status, 401);
  const errorHtml = await wrong.text();
  assert.ok(!errorHtml.includes(nextPassword));
  assert.ok(!errorHtml.includes(originalPassword));
  assert.equal((await post("/auth/password", new URLSearchParams(fields))).status, 429);
  await Effect.runPromise(inspectStorage);
  await Effect.runPromise(resetAdmission);

  const attempts = await Promise.all([post("/auth/password", new URLSearchParams(fields)), post("/auth/password", new URLSearchParams(fields))]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [303, 429]);
  const changed = attempts.find((response) => response.status === 303);
  assert.ok(changed);
  assert.equal(changed.headers.get("location"), "/auth/password?saved=1");
  assert.equal((await get("/api/settings/opencode")).status, 401);
  cookie = (changed.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert.notEqual(cookie, originalCookie);
  password = nextPassword;
  assert.notEqual(await csrf(), token);
  assert.equal((await post("/auth/password", new URLSearchParams({ ...fields, currentPassword: nextPassword,
    password: "another synthetic owner passphrase", confirmation: "another synthetic owner passphrase" }))).status, 401);
  await status(true);
  await Effect.runPromise(inspectStorage);
  assert.deepEqual(await readFile(credentialsFile), credentialsBefore);
  await Effect.runPromise(resetAdmission);
  assert.equal((await post("/auth/login", new URLSearchParams({ username: "owner", password: originalPassword }))).status, 401);
  await login();
  // The shell captures this in a private host file, never in logs or worker volumes.
  console.log(JSON.stringify({ password, cookie }));
} else {
  await detectKeys();
  await status(true);
  await csrf();
  await Effect.runPromise(inspectStorage);
  const oldCookie = cookie;
  await login();
  const currentCookie = cookie;
  cookie = oldCookie;
  assert.equal((await get("/api/settings/opencode")).status, 401);
  cookie = currentCookie;
  const token = await csrf();

  if (keysEnabled) {
    assert.equal((await postJson("/api/settings/opencode/remove", { csrf: token })).status, 200);
    await status(false);
  }


  assert.equal((await post("/auth/logout", new URLSearchParams({ csrf: token }))).status, 303);
  assert.equal((await get("/api/settings/opencode")).status, 401);

  if (keysEnabled) assert.equal((await saveKey(token, syntheticKey)).status, 401);

  await login();
  const expiringCsrf = await csrf();
  await Effect.runPromise(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE login_session SET expires_at = now() - interval '1 second'`;
  }).pipe(Effect.provide(DatabaseLive)));
  assert.equal((await get("/api/settings/opencode")).status, 401);

  if (keysEnabled) assert.equal((await saveKey(expiringCsrf, syntheticKey)).status, 401);
  console.log("Identity smoke passed: login, password change, CSRF, encryption, replacement, retained passwords/sessions, expiry, and logout.");
}
