import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { z } from "zod";

const Settings = z.object({
  host: z.enum(["127.0.0.1", "0.0.0.0"]),
  port: z.coerce.number().int().min(1).max(65535),
  databaseHost: z.string().min(1),
  databasePort: z.coerce.number().int().min(1).max(65535),
  databaseName: z.string().min(1),
  databaseUser: z.string().min(1),
});

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError", {},
) {}

export class Configuration extends Context.Service<Configuration, {
  readonly settings: z.infer<typeof Settings>;
  readonly databasePassword: Redacted.Redacted<string>;
}>()("camenae/Configuration") {
  static readonly layer = Layer.effect(Configuration, Effect.gen(function* () {
    const raw = yield* Config.all({
      host: Config.String("CAMENAE_HOST").pipe(Config.withDefault("127.0.0.1")),
      port: Config.String("CAMENAE_PORT").pipe(Config.withDefault("3000")),
      databaseHost: Config.String("CAMENAE_DATABASE_HOST"),
      databasePort: Config.String("CAMENAE_DATABASE_PORT").pipe(Config.withDefault("5432")),
      databaseName: Config.String("CAMENAE_DATABASE_NAME"),
      databaseUser: Config.String("CAMENAE_DATABASE_USER"),
    });

    const databasePassword = yield* Config.Redacted("CAMENAE_DATABASE_PASSWORD");
    const parsed = Settings.safeParse(raw);

    if (!parsed.success || !Redacted.value(databasePassword).trim()) {
      return yield* new ConfigurationError();
    }

    return Configuration.of({ settings: parsed.data, databasePassword });
  }).pipe(Effect.mapError(() => new ConfigurationError())));
}
