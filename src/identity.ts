import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { Installation } from "./installation.js";

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
  readonly session: (token: string) => Effect.Effect<string, IdentityError | AccessDenied>;
  readonly authorize: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly key: (token: string, csrf: string) => Effect.Effect<Redacted.Redacted<string>, IdentityError | AccessDenied>;
  readonly status: (token: string) => Effect.Effect<boolean, IdentityError | AccessDenied>;
  readonly logout: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly replaceKey: (token: string, csrf: string, key: Redacted.Redacted<string>) => Effect.Effect<void, IdentityError | AccessDenied>;
  readonly removeKey: (token: string, csrf: string) => Effect.Effect<void, IdentityError | AccessDenied>;
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
    const aad = Buffer.from(`camenae:bob-key:v1:${installation.id}`);

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

    const connectionRows = Effect.fn("Identity.connectionRows")(function* () {
      const rows = yield* sql`SELECT encrypted_key FROM bob_connection WHERE singleton = true`;

      return yield* Effect.try(() => Connections.parse(rows));
    }, Effect.mapError(() => new IdentityError()));

    // Fail closed on a lost/wrong encryption key; never silently overwrite unreadable data.
    for (const row of yield* connectionRows()) {
      yield* Effect.try(() => decrypt(row.encrypted_key));
    }

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

    const key = Effect.fn("Identity.key")(function* (token: string, csrf: string) {
      yield* authorize(token, csrf);
      const row = (yield* connectionRows())[0];

      if (!row) return yield* new IdentityError();

      return yield* Effect.try(() => decrypt(row.encrypted_key)).pipe(Effect.mapError(() => new IdentityError()));
    });

    const login = Effect.fn("Identity.login")(function* (username: string, password: Redacted.Redacted<string>) {
      // Persistent, account-wide admission limit, including invalid usernames and concurrent requests.
      const admitted = yield* sql`UPDATE local_account SET next_login_at = now() + interval '5 seconds'
        WHERE singleton = true AND next_login_at <= now() RETURNING password_hash`
        .pipe(Effect.mapError(() => new IdentityError()));

      const parsed = z.array(z.object({ password_hash: z.string() })).safeParse(admitted);

      if (!parsed.success) return yield* new IdentityError();

      const account = parsed.data[0];

      if (!account) return yield* new LoginLimited();

      const valid = yield* Effect.tryPromise(() => Bun.password.verify(Redacted.value(password), account.password_hash))
        .pipe(Effect.mapError(() => new IdentityError()));

      if (!valid || username !== "owner") return yield* new AccessDenied();

      const token = randomToken();
      yield* sql.withTransaction(Effect.gen(function* () {
        // One active login. Existing tabs share it; a new login revokes the previous one.
        yield* sql`SELECT singleton FROM local_account WHERE singleton = true FOR UPDATE`;
        yield* sql`DELETE FROM login_session`;
        yield* sql`INSERT INTO login_session (token_hash, csrf, expires_at)
          VALUES (${digest(token)}, ${randomToken()}, now() + interval '8 hours')`;
      })).pipe(Effect.mapError(() => new IdentityError()));

      return token;
    });

    const status = Effect.fn("Identity.status")(function* (token: string) {
      yield* session(token);

      return (yield* connectionRows()).length > 0;
    });

    const logout = Effect.fn("Identity.logout")(function* (token: string, csrf: string) {
      yield* authorize(token, csrf);
      yield* sql`DELETE FROM login_session WHERE token_hash = ${digest(token)}`
        .pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    const replaceKey = Effect.fn("Identity.replaceKey")(function* (token: string, csrf: string, key: Redacted.Redacted<string>) {
      yield* authorize(token, csrf);

      const encrypted = yield* Effect.try(() => encrypt(Redacted.value(key)))
        .pipe(Effect.mapError(() => new IdentityError()));

      yield* sql`INSERT INTO bob_connection (encrypted_key) VALUES (${encrypted})
        ON CONFLICT (singleton) DO UPDATE SET encrypted_key = EXCLUDED.encrypted_key`
        .pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    const removeKey = Effect.fn("Identity.removeKey")(function* (token: string, csrf: string) {
      yield* authorize(token, csrf);
      yield* sql`DELETE FROM bob_connection WHERE singleton = true`
        .pipe(Effect.mapError(() => new IdentityError()));
    }, sql.withTransaction);

    return Identity.of({
      origin, secureCookie: origin.startsWith("https:"), login, session, authorize, key, status,
      logout: (token, csrf) => logout(token, csrf).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
      replaceKey: (token, csrf, key) => replaceKey(token, csrf, key).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
      removeKey: (token, csrf) => removeKey(token, csrf).pipe(Effect.catchTag("SqlError", () => new IdentityError())),
    });
  }).pipe(Effect.mapError(() => new IdentityError())));
}
