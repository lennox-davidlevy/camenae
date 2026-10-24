import { z } from "zod";
import { Conversation } from "./chat-contract.js";
import { ConsoleUsage } from "./console-contract.js";

export const Bootstrap = z.object({ csrf: z.string(), stored: z.boolean(), readiness: z.object({ opencode: z.boolean() }), consoleUsage: ConsoleUsage.nullable(), harness: z.enum(["opencode"]).default("opencode"), conversations: z.array(Conversation) });

export type Bootstrap = z.infer<typeof Bootstrap>;
