import { z } from "zod";

export const filePreviewLimit = 64 * 1024;

export const attachmentCountLimit = 4;

const textExtensions = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".conf", ".log",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".css", ".scss", ".html", ".htm", ".xml", ".svg", ".sh", ".bash", ".zsh", ".sql", ".rb", ".php", ".swift", ".kt", ".vue", ".svelte",
]);

const textNames = new Set(["dockerfile", "makefile", "readme", "license", ".gitignore", ".dockerignore"]);

export const textFileName = (name: string) => textNames.has(name.toLowerCase()) || textExtensions.has(name.slice(name.lastIndexOf(".")).toLowerCase());

export function plainText(text: string) {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }

  return true;
}

export const UploadName = z.string().min(1).max(120).refine((name) => name.trim() === name && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") && plainText(name) && [...name].every((character) => character.charCodeAt(0) >= 32) && new TextEncoder().encode(name).length <= 180 && textFileName(name));

export const WorkspaceFilePath = z.string().min(1).max(1024).refine((path) => path.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes("\0")));

export const AttachmentPaths = z.array(WorkspaceFilePath).max(attachmentCountLimit).refine((paths) => new Set(paths).size === paths.length);

export const FileAttachment = z.object({ path: WorkspaceFilePath, text: z.string().max(filePreviewLimit) });

export type FileAttachment = z.infer<typeof FileAttachment>;

export const FilePreview = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(filePreviewLimit) }),
  z.object({ kind: z.literal("unavailable"), reason: z.enum(["unsupported", "too-large", "not-text"]) }),
]);

export type FilePreview = z.infer<typeof FilePreview>;
