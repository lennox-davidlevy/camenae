import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { Installation } from "./installation.js";
import { ConsoleUsage, SaveConsoleBudget } from "./console-contract.js";

export class IdentityError extends Schema.TaggedError<IdentityError>()("IdentityError", {}) {}

export class AccessDenied extends Schema.TaggedError<AccessDenied>()("AccessDenied", {}) {}

export class LoginLimited extends Schema.TaggedError<LoginLimited>()("LoginLimited", {}) {}

const Credentials = z.object({
  passwordHash: z.string().startsWith("$argon2id$"),
  encryptionKey: z.string().regex(/^[a-f0-9]{64}$/),
});

const Sessions = z.array(z.object({ csrf: z.string() }));

const Connections = z.array(z.object({ encrypted_key: z.string() }));

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

const randomToken = () => randomBytes(32).toString("base64url");

export class Identity extends Context.Service<Identity, {
  readonly origin: string;
  readonly secureCookie: boolean;
  readonly login: (username: string, password: Redacted.Redacted<string>) => Effect.Effect<string, IdentityError | AccessDenied | LoginLimited>;
  readonly changePassword: (token: string, csrf: string, current: Redacted.Redacted<string>, password: Redacted.Redacted<string>) => Effect.Effect<string, IdentityError | AccessDenied | LoginLimited>;
  readonly session: (token: string) => Effect.Effect<string, IdentityError | AccessDenied>;
  readonly authorize: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly logout: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly consoleStatus: (token: string) => Effect.Effect<ConsoleUsage & { stored: boolean }, IdentityError | AccessDenied>;
  readonly saveConsoleBudget: (token: string, input: z.infer<typeof SaveConsoleBudget>) => Effect.Effect<boolean, IdentityError | AccessDenied>;
  readonly consoleKey: () => Effect.Effect<Redacted.Redacted<string>, IdentityError>;
  readonly admitConsoleRequest: (paid: boolean) => Effect.Effect<Redacted.Redacted<string>, IdentityError>;
  readonly replaceConsoleKey: (token: string, csrf: string, key: Redacted.Redacted<string>) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly removeConsoleKey: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
}>()("camenae/Identity") {
  static readonly layer = Layer.effect(Identity, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const installation = yield* Installation;
    const originInput = yield* Config.String("CAMENAE_ORIGIN");
    const file = yield* Config.String("CAMENAE_CREDENTIALS_FILE");

    const origin = yield* Effect.try(() => {
      const url = new URL(originInput);

      if (url.origin !== originInput || (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
        throw new Error("Invalid origin");
      }

      return url.origin;
    });

    const credentials = yield* Effect.tryPromise(async () =>
      Credentials.parse(JSON.parse(await readFile(file, "utf8"))));

    const encryptionKey = Buffer.from(credentials.encryptionKey, "hex");
    const aad = Buffer.from(`camenae:console-key:v1:${installation.id}`);

    const decrypt = (encrypted: string) => {
      const bytes = Buffer.from(encrypted, "base64");
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(12, 28));

      return Redacted.make(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    };

    const encrypt = (key: string) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);

      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
    };

    const consoleRow = Effect.fn("Identity.consoleRow")(function* () {
      const rows = yield* sql`SELECT encrypted_key, requests_used - requests_baseline AS used, requests_limit AS "limit",
        budget_revision AS revision FROM console_connection WHERE singleton = true`;

      return yield* Effect.try(() => z.array(ConsoleUsage.extend({ encrypted_key: z.string().nullable() })).length(1).parse(rows)[0]);
    }, Effect.mapError(() => new IdentityError()));

    const savedConsole = (yield* consoleRow()).encrypted_key;

    if (savedConsole) yield* Effect.try(() => decrypt(savedConsole));

    yield* sql`INSERT INTO local_account (password_hash) VALUES (${credentials.passwordHash}) ON CONFLICT DO NOTHING`;

    const session = Effect.fn("Identity.session")(function* (token: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return yield* new AccessDenied();

      const rows = yield* sql`SELECT csrf FROM login_session
        WHERE token_hash = ${digest(token)} AND expires_at > now() FOR UPDATE`
        .pipe(Effect.mapError(() => new IdentityError()));

      const parsed = Sessions.safeParse(rows);

      if (!parsed.success) return yield* new IdentityError();

      const row = parsed.data[0];

      if (!row) return yield* new AccessDenied();

      return row.csrf;
    });

    const authorize = Effect.fn("Identity.authorize")(function* (token: string, csrf: string) {
      if ((yield* session(token)) !== csrf) return yield* new AccessDenied();
    });

    const admitPasswordAttempt = Effect.fn("Identity.admitPasswordAttempt")(function* () {
      // Shared persistent limit for login and password changes, including failed attempts.
      const admitted = yield* sql`UPDATE local_account SET next_login_at = now() + interval '5 seconds'
        WHERE singleton = true AND next_login_at <= now() RETURNING password_hash`
        .pipe(Effect.mapError(() => new IdentityError()));

      const parsed = z.array(z.object({ password_hash: z.string() })).safeParse(admitted);

      if (!parsed.success) return yield* new IdentityError();

      const account = parsed.data[0];

      if (!account) return yield* new LoginLimited();

      return account.password_hash;
    });

    const replaceSession = Effect.fn("Identity.replaceSession")(function* () {
      const token = randomToken();
      yield* sql`DELETE FROM login_session`;
      yield* sql`INSERT INTO login_session (token_hash, csrf, expires_at)
        VALUES (${digest(token)}, ${randomToken()}, now() + interval '8 hours')`;

      return token;
    });

    const lockPassword = Effect.fn("Identity.lockPassword")(function* (hash: string) {
      const rows = yield* sql`SELECT password_hash FROM local_account WHERE singleton = true FOR UPDATE`;
      const parsed = z.array(z.object({ password_hash: z.string() })).safeParse(rows);

      if (!parsed.success) return yield* new IdentityError();

      // A concurrent password change must invalidate an already-started verification.
      if (parsed.data[0]?.password_hash !== hash) return yield* new AccessDenied();
    });

    const login = Effect.fn("Identity.login")(function* (username: string, password: Redacted.Redacted<string>) {
      const hash = yield* admitPasswordAttempt();

      const valid = yield* Effect.tryPromise(() => Bun.password.verify(Redacted.value(password), hash))
        .pipe(Effect.mapError(() => new IdentityError()));

      if (!valid || username !== "owner") return yield* new AccessDenied();

      return yield* sql.withTransaction(Effect.gen(function* () {
        // One active login. Existing tabs share it; a new login revokes the previous one.
        yield* lockPassword(hash);

        return yield* replaceSession();
      })).pipe(Effect.catchTag("SqlError", () => new IdentityError()));
    });

    const changePassword = Effect.fn("Identity.changePassword")(function* (
      token: string, csrf: string, current: Redacted.Redacted<string>, password: Redacted.Redacted<string>,
    ) {
      yield* authorize(token, csrf);
      const hash = yield* admitPasswordAttempt();

      const valid = yield* Effect.tryPromise(() => Bun.password.verify(Redacted.value(current), hash))
        .pipe(Effect.mapError(() => new IdentityError()));

      if (!valid) return yield* new AccessDenied();

      const nextHash = yield* Effect.tryPromise(() => Bun.password.hash(Redacted.value(password), {
        algorithm: "argon2id", memoryCost: 65536, timeCost: 3,
      })).pipe(Effect.mapError(() => new IdentityError()));

      return yield* sql.withTransaction(Effect.gen(function* () {
        // Same lock order as login; reauthorize after expensive work and before writing.
        yield* lockPassword(hash);
        yield* authorize(token, csrf);
        yield* sql`UPDATE local_account SET password_hash = ${nextHash} WHERE singleton = true`;

        return yield* replaceSession();
      })).pipe(Effect.catchTag("SqlError", () => new IdentityError()));
    });

    const logout = Effect.fn("Identity.logout")(function* (token: string, csrf: string) {
      yield* authorize(token, csrf);
      yield* sql`DELETE FROM login_session WHERE token_hash = ${digest(token)}`
        .pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    const consoleStatus = Effect.fn("Identity.consoleStatus")(function* (token: string) {
      yield* session(token);
      const row = yield* consoleRow();

      return { stored: row.encrypted_key !== null, used: row.used, limit: row.limit, revision: row.revision };
    });

    const saveConsoleBudget = Effect.fn("Identity.saveConsoleBudget")(function* (token: string, input: z.infer<typeof SaveConsoleBudget>) {
      const budget = yield* Effect.try(() => SaveConsoleBudget.parse(input)).pipe(Effect.mapError(() => new IdentityError()));
      yield* authorize(token, budget.csrf);

      const rows = yield* sql`UPDATE console_connection SET requests_limit = ${budget.limit},
        requests_baseline = CASE WHEN ${budget.refresh} THEN requests_used ELSE requests_baseline END,
        budget_revision = budget_revision + 1
        WHERE singleton = true AND budget_revision = ${budget.revision} RETURNING singleton`;

      return rows.length === 1;
    }, sql.withTransaction, Effect.catchTag("SqlError", () => new IdentityError()));

    const consoleKey = Effect.fn("Identity.consoleKey")(function* () {
      const row = yield* consoleRow();
      const encrypted = row.encrypted_key;

      if (!encrypted) return yield* new IdentityError();

      return yield* Effect.try(() => decrypt(encrypted));
    }, Effect.mapError(() => new IdentityError()));

    const admitConsoleRequest = Effect.fn("Identity.admitConsoleRequest")(function* (paid: boolean) {
      // The budget survives key replacement/removal and application restarts. A billed model is
      // admitted only while a cap is set, so an uncapped installation can never run up a bill.
      const rows = yield* sql`UPDATE console_connection SET requests_used = requests_used + 1
        WHERE singleton = true AND encrypted_key IS NOT NULL AND (${!paid} OR requests_limit IS NOT NULL)
        AND (requests_limit IS NULL OR requests_used - requests_baseline < requests_limit) RETURNING encrypted_key`;

      const row = yield* Effect.try(() => Connections.length(1).parse(rows)[0]);

      return yield* Effect.try(() => decrypt(row.encrypted_key));
    }, Effect.mapError(() => new IdentityError()));

    const replaceConsoleKey = Effect.fn("Identity.replaceConsoleKey")(function* (token: string, csrf: string, key: Redacted.Redacted<string>) {
      yield* authorize(token, csrf);
      const encrypted = yield* Effect.try(() => encrypt(Redacted.value(key))).pipe(Effect.mapError(() => new IdentityError()));
      yield* sql`UPDATE console_connection SET encrypted_key = ${encrypted} WHERE singleton = true`.pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    const removeConsoleKey = Effect.fn("Identity.removeConsoleKey")(function* (token: string, csrf: string) {
      yield* authorize(token, csrf);
      yield* sql`UPDATE console_connection SET encrypted_key = NULL WHERE singleton = true`.pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    return Identity.of({
      origin, secureCookie: origin.startsWith("https:"), login, changePassword, session, authorize,
      logout: (token, csrf) => logout(token, csrf).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
      consoleStatus, consoleKey, admitConsoleRequest, saveConsoleBudget,
      replaceConsoleKey: (token, csrf, key) => replaceConsoleKey(token, csrf, key).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
      removeConsoleKey: (token, csrf) => removeConsoleKey(token, csrf).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
    });
  }).pipe(Effect.mapError(() => new IdentityError())));
}
