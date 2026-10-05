import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { Configuration } from "./configuration.js";

export const DatabaseLive = Layer.unwrap(Effect.gen(function* () {
  const { settings, databasePassword } = yield* Configuration;

  return PgClient.layer({
    host: settings.databaseHost,
    port: settings.databasePort,
    database: settings.databaseName,
    username: settings.databaseUser,
    password: databasePassword,
    applicationName: "camenae",
    maxConnections: 4,
    connectTimeout: "3 seconds",
    startupParameters: { statement_timeout: "5000", lock_timeout: "3000" },
  });
})).pipe(Layer.provide(Configuration.layer));
