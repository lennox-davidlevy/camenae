import { z } from "zod";

// Text shown and edited in the Files view. Larger files are still downloadable.
export const previewLimit = 1024 * 1024;

export const uploadLimit = 15 * 1024 * 1024;

export const downloadLimit = 25 * 1024 * 1024;

export const attachmentCountLimit = 10;

export const listLimit = 1000;

export const pathsLimit = 5000;

// Where attachments are saved when a message is sent.
export const attachmentsDirectory = "inbox";

// Top-level folders the workspace is provisioned with. They cannot be removed or moved.
export const protectedFolders = ["inbox", "projects", "outputs", "scratch"] as const;

export function plainText(text: string) {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }

  return true;
}

// A browser file name as one workspace path segment.
export function safeName(name: string) {
  const cleaned = [...name].map((character) => {
    const code = character.charCodeAt(0);

    return code < 32 || code === 127 || character === "\\" || character === "/" ? "_" : character;
  }).join("").trim();

  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned.slice(0, 200);
}

// The requested path, then "name-2.ext", "name-3.ext", … in the same directory.
export function* candidates(path: string, limit = 100) {
  const slash = path.lastIndexOf("/");
  const directory = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const extension = dot > 0 ? file.slice(dot) : "";
  yield path;

  for (let index = 2; index <= limit; index++) yield `${directory}${stem}-${index}${extension}`;
}

// The first of those not already taken.
export function freePath(path: string, taken: ReadonlySet<string>) {
  for (const candidate of candidates(path)) if (!taken.has(candidate)) return candidate;

  return path;
}

// Convenience, not a secret scanner: these names stay out of the default view.
export const secretLike = (name: string) => /^\.env(?:\..+)?$/i.test(name) && name !== ".env.example" && name !== ".env.sample"
  || /(?:^|[._-])(?:secrets?|credentials?|passwords?|id_rsa|id_ed25519)(?:$|[._-])/i.test(name)
  || /\.(?:pem|key|p12|pfx|keystore|kdb)$/i.test(name);

export const WorkspaceFilePath = z.string().min(1).max(1024).refine((path) => path.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes("\0")));

// Changes made from the Files view and uploads never touch a repository's own files.
export const EditPath = WorkspaceFilePath.refine((path) => !path.split("/").includes(".git"), "Repository files cannot be changed here");

export const UploadMode = z.enum(["fail", "replace", "unique"]);

export type UploadMode = z.infer<typeof UploadMode>;

export const FileEdit = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("delete"), csrf: z.string(), path: EditPath }),
  z.strictObject({ op: z.literal("move"), csrf: z.string(), from: EditPath, to: EditPath }),
  z.strictObject({ op: z.literal("folder"), csrf: z.string(), path: EditPath }),
]);

export type FileEdit = z.infer<typeof FileEdit>;

export const AttachmentPaths = z.array(WorkspaceFilePath).max(attachmentCountLimit).refine((paths) => new Set(paths).size === paths.length);

// Older turns also stored the file's text; it is ignored when read back.
export const FileAttachment = z.object({ path: WorkspaceFilePath, size: z.number().int().nonnegative().optional() });

export type FileAttachment = z.infer<typeof FileAttachment>;

export const FileEntry = z.object({ name: z.string(), directory: z.boolean(), size: z.number().int().nonnegative().nullable(), hidden: z.boolean() });

export const FileListing = z.object({ entries: z.array(FileEntry), truncated: z.boolean() });

export type FileEntry = z.infer<typeof FileEntry>;

export type FileListing = z.infer<typeof FileListing>;

export const FilePaths = z.object({ paths: z.array(z.string()), truncated: z.boolean() });

export type FilePaths = z.infer<typeof FilePaths>;

export const FilePreview = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(previewLimit), size: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("unavailable"), reason: z.enum(["too-large", "not-text"]), size: z.number().int().nonnegative() }),
]);

export type FilePreview = z.infer<typeof FilePreview>;

// Failure codes the Files routes report to the page.
export const FailureCode = z.enum(["FILE_EXISTS", "FILE_TOO_LARGE", "PATH_NOT_ALLOWED", "NOT_FOUND", "INVALID"]);

export type FailureCode = z.infer<typeof FailureCode>;

export const failureMessages = {
  FILE_EXISTS: "A file with that name already exists.",
  FILE_TOO_LARGE: "Files can be at most 15 MB.",
  PATH_NOT_ALLOWED: "That location can’t be changed here.",
  NOT_FOUND: "That file or folder no longer exists.",
  INVALID: "The request was not valid.",
} satisfies Record<FailureCode, string>;
