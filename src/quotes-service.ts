import { Config, Context, Effect, Layer } from "effect";
import { readQuotes, type QuoteSets } from "./quotes.js";

// The quotes are read once at start-up. Missing files mean no quotes, never a failed start.
// The data directory is separate from CAMENAE_DATA_DIRECTORY (storage): this holds read-only
// files shipped with the application, plus an optional private set mounted next to them.
export class Quotes extends Context.Service<Quotes, QuoteSets>()("camenae/Quotes") {
  static readonly layer = Layer.effect(Quotes, Effect.gen(function* () {
    const directory = yield* Config.String("CAMENAE_QUOTES_DIRECTORY").pipe(Config.withDefault("data"));

    return Quotes.of(yield* Effect.promise(() => readQuotes(directory)));
  }));
}
