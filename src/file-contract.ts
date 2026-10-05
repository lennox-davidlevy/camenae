import { z } from "zod";

export const filePreviewLimit = 64 * 1024;

export const FilePreview = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(filePreviewLimit) }),
  z.object({ kind: z.literal("unavailable"), reason: z.enum(["unsupported", "too-large", "not-text"]) }),
]);

export type FilePreview = z.infer<typeof FilePreview>;
