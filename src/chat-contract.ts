import { z } from "zod";
import { AttachmentPaths, FileAttachment } from "./file-contract.js";

export const Activity = z.object({ id: z.string(), title: z.string(), status: z.string() });

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
  status: z.enum(["running", "completed", "cancelled", "failed", "interrupted"]),
  stop_reason: z.string().nullable(),
});

export const ThreadTitle = z.string().trim().min(1).max(160);

export const Conversation = z.object({
  id: z.uuid(), title: z.string(), harness: z.enum(["opencode"]).default("opencode"),
  createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(), toolCount: z.number().int().nonnegative(),
});

export type Conversation = z.infer<typeof Conversation>;

export const SessionUsage = z.object({
  harness: z.literal("opencode"), costUSD: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
});

export type SessionUsage = z.infer<typeof SessionUsage>;

export const ChatView = z.object({ conversation: Conversation, harness: z.enum(["opencode"]), model: z.string().nullable(), turns: z.array(Turn), usage: SessionUsage.nullable() });

export const StartTurn = z.object({ csrf: z.string(), prompt: z.string().trim().min(1).max(8000), attachments: AttachmentPaths.default([]) });

export const ChatAction = z.object({ csrf: z.string(), turnId: z.uuid(), permissionId: z.string().optional(), optionId: z.string().nullable().optional() });

export type Turn = z.infer<typeof Turn>;

export type ChatView = z.infer<typeof ChatView>;

export type Permission = z.infer<typeof Permission>;

export type Activity = z.infer<typeof Activity>;
