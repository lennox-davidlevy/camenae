import { z } from "zod";
import type { BobSessionUsage } from "@camenae/bob";
import { approvalKinds } from "./approval-contract.js";
import { McpHistory } from "./mcp-contract.js";
import { AttachmentPaths, FileAttachment } from "./file-contract.js";

export const Activity = z.object({ id: z.string(), title: z.string(), status: z.string() });

// Historical SDK decisions, never inferred from current preferences or tool
// status. IDs are opaque and may contain arguments; do not log these records.
export const ApprovalDecision = z.intersection(
  z.object({ permissionId: z.string(), toolCallId: z.string() }),
  z.discriminatedUnion("match", [
    z.object({ match: z.literal("category"), kind: z.enum(approvalKinds), decision: z.enum(["allow", "deny"]) }),
    z.object({ match: z.literal("fallback"), kind: z.string().nullable(), decision: z.literal("deny") }),
  ]),
);

export const Permission = z.object({
  resources: z.array(z.string()).optional(),
  detailsTruncated: z.boolean().optional(),
  id: z.string(), title: z.string(),
  kind: z.string().optional(),
  options: z.array(z.object({ optionId: z.string(), name: z.string(), kind: z.string() })),
});

export const Turn = z.object({
  id: z.uuid(), ordinal: z.number().int(), prompt: z.string(), answer: z.string(),
  activity: z.array(Activity), permission: Permission.nullable(),
  attachments: z.array(FileAttachment).default([]),
  approval_decisions: z.array(ApprovalDecision),
  status: z.enum(["running", "completed", "cancelled", "failed", "interrupted"]),
  stop_reason: z.string().nullable(),
});

export const ThreadTitle = z.string().trim().min(1).max(160);

export const Conversation = z.object({
  id: z.uuid(), title: z.string(), harness: z.enum(["bob", "opencode"]).default("bob"),
  createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(), toolCount: z.number().int().nonnegative(),
});

export type Conversation = z.infer<typeof Conversation>;

// Strip future fields, but never coerce missing/null values into zero or accept
// an unsupported version. This decoder is shared by SDK ingestion and UI.
export const BobUsage = z.object({
  version: z.literal(1),
  contextTokens: z.number().nonnegative().nullable(),
  contextWindow: z.number().nonnegative().nullable(),
  maxOutputTokens: z.number().nonnegative().nullable(),
  compactionThreshold: z.number().min(0).max(1).nullable(),
  autoCompact: z.boolean(),
  bobcoins: z.number().nonnegative().nullable(),
}) satisfies z.ZodType<BobSessionUsage>;

export const SessionUsage = z.union([BobUsage, z.object({
  harness: z.literal("opencode"), costUSD: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
})]);

export type SessionUsage = z.infer<typeof SessionUsage>;

export const ChatView = z.object({ conversation: Conversation, harness: z.enum(["bob", "opencode"]), model: z.string().nullable(), turns: z.array(Turn), mcp: McpHistory, usage: SessionUsage.nullable() });

export const StartTurn = z.object({ csrf: z.string(), prompt: z.string().trim().min(1).max(8000), attachments: AttachmentPaths.default([]) });

export const ChatAction = z.object({ csrf: z.string(), turnId: z.uuid(), permissionId: z.string().optional(), optionId: z.string().nullable().optional() });

export type Turn = z.infer<typeof Turn>;

export type ChatView = z.infer<typeof ChatView>;

export type Permission = z.infer<typeof Permission>;

export type Activity = z.infer<typeof Activity>;
