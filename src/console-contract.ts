import { z } from "zod";

export const consoleModel = "longcat-2.5-preview-free";

export const FreeConsoleModel = z.enum([
  "big-pickle", "fledge-alpha-free", "ling-3.0-flash-fin-free", "ling-3.1-flash-free", "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "space-bunny-free",
]);

// Billed per token by Console. The gateway admits these only while a request cap is set.
export const PaidConsoleModel = z.enum(["claude-haiku-5-5"]);

export const ConsoleModel = z.enum([...FreeConsoleModel.options, ...PaidConsoleModel.options]);

export type ConsoleModel = z.infer<typeof ConsoleModel>;

export const consoleModels = {
  "big-pickle": "Big Pickle",
  "fledge-alpha-free": "Fledge Alpha",
  "ling-3.0-flash-fin-free": "Ling 3.0 Flash Fin",
  "ling-3.1-flash-free": "Ling 3.1 Flash",
  "longcat-2.5-preview-free": "LongCat 2.5 Preview",
  "mimo-v2.6-flash-free": "MiMo-V2.6-Flash",
  "nemotron-3-ultra-free": "Nemotron 3 Ultra",
  "nemotron-3.5-lightning-free": "Nemotron 3.5 Lightning",
  "space-bunny-free": "Space Bunny",
  "claude-haiku-5-5": "Claude Haiku 5.5",
} satisfies Record<ConsoleModel, string>;

export const paidModel = (model: ConsoleModel) => PaidConsoleModel.safeParse(model).success;

// Free models use the OpenAI-compatible route; paid Claude models use the Anthropic Messages route.
export const consoleProvider = (model: ConsoleModel) => paidModel(model) ? "camenae-anthropic" : "camenae";

export const ConsoleSelection = z.strictObject({ provider: z.literal("console"), model: ConsoleModel });

export const RequestCap = z.number().int().min(0).max(2147483647).nullable();

export const ConsoleUsage = z.object({ used: z.number().int().nonnegative(), limit: RequestCap, revision: z.number().int().nonnegative() });

export const ConsoleSettings = ConsoleSelection.extend({ enabled: z.boolean(), stored: z.boolean(), ...ConsoleUsage.shape });

export type ConsoleUsage = z.infer<typeof ConsoleUsage>;

export const SaveConsoleSettings = ConsoleSelection.extend({ csrf: z.string(), key: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/) });

export const SaveConsoleBudget = z.strictObject({ csrf: z.string(), limit: RequestCap, refresh: z.boolean(), revision: ConsoleUsage.shape.revision });

export function consoleExhausted(usage: ConsoleUsage): boolean {
  return usage.limit !== null && usage.used >= usage.limit;
}
