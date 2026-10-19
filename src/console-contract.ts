import { z } from "zod";

export const consoleModel = "longcat-2.5-preview-free";

export const ConsoleModel = z.enum([
  "big-pickle", "fledge-alpha-free", "ling-3.0-flash-fin-free", "ling-3.1-flash-free", "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "space-bunny-free",
]);

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
} satisfies Record<ConsoleModel, string>;

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
