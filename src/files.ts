import { constants } from "node:fs";
import { open, opendir, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { z } from "zod";
import { Identity } from "./identity.js";
import { Workspace } from "./workspace.js";
import { filePreviewLimit, type FilePreview } from "./file-contract.js";

class FileError extends Schema.TaggedError<FileError>()("FileError", {}) {}

const Upload = z.object({ csrf: z.string(), name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
  text: z.string().max(8000).refine((text) => Buffer.byteLength(text) <= 8000) });

const textExtensions = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".conf", ".log",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".css", ".scss", ".html", ".htm", ".xml", ".svg", ".sh", ".bash", ".zsh", ".sql", ".rb", ".php", ".swift", ".kt", ".vue", ".svelte",
]);

const textNames = new Set(["dockerfile", "makefile", "readme", "license", ".gitignore", ".dockerignore"]);

// Linux deployment: each component is opened relative to an already-open
// directory inode. A concurrent tool cannot redirect traversal through a link.
async function directory(root: string, parts: string[]): Promise<FileHandle> {
  let handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

  try {
    for (const part of parts) {
      const next = await open(`/proc/self/fd/${handle.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await handle.close();
      handle = next;
    }

    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export const FileRoutes = HttpRouter.use(Effect.fn("Files.routes")(function* (router) {
  const identity = yield* Identity;
  const paths = yield* Workspace;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const previewResponse = (body: FilePreview) => HttpServerResponse.jsonUnsafe(body, { headers });

  for (const operation of ["list", "download", "upload", "preview"] as const) {
    const handler = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const token = request.cookies[identity.secureCookie ? "__Host-camenae" : "camenae-local"] ?? "";
      yield* identity.session(token);

      if (operation === "upload") {
        if (request.headers.origin !== identity.origin || request.headers["content-type"]?.split(";")[0] !== "application/json") return yield* new FileError();
        const parsed = Upload.safeParse(yield* request.json.pipe(Effect.mapError(() => new FileError())));

        if (!parsed.success) return yield* new FileError();

        yield* identity.authorize(token, parsed.data.csrf);
        const name = `${randomUUID()}-${parsed.data.name}`;
        yield* Effect.tryPromise({ try: async () => {
          const parent = await directory(paths.workspace, ["inbox"]);

          try {
            const file = await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);

            try { await file.writeFile(parsed.data.text); }
            finally { await file.close(); }
          } finally { await parent.close(); }
        }, catch: () => new FileError() });

        return HttpServerResponse.jsonUnsafe({ path: `inbox/${name}` }, { headers });
      }

      const relative = new URL(request.url, "http://camenae.invalid").searchParams.get("path") ?? "";
      const parts = relative === "" ? [] : relative.split("/");

      if (relative.length > 1024 ||
        parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return yield* new FileError();

      return yield* Effect.tryPromise({ try: async () => {
        if (operation === "list") {
          const parent = await directory(paths.workspace, parts);

          try {
            const entries: { name: string; directory: boolean }[] = [];
            let count = 0;

            // Async iteration closes the directory on completion or rejection.
            for await (const entry of await opendir(`/proc/self/fd/${parent.fd}`, { bufferSize: 32 })) {
              if (++count > 200) throw new Error("Directory limit");

              if (entry.isFile() || entry.isDirectory()) entries.push({ name: entry.name, directory: entry.isDirectory() });
            }

            return HttpServerResponse.jsonUnsafe({ entries }, { headers });
          } finally { await parent.close(); }
        }

        const name = parts.pop();

        if (!name) throw new Error("Invalid file");

        const parent = await directory(paths.workspace, parts);

        try {
          const file = await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

          try {
            const info = await file.stat();
            const limit = operation === "preview" ? filePreviewLimit : 8 * 1024 * 1024;

            if (!info.isFile()) throw new Error("Invalid file");

            if (operation === "preview" && !textExtensions.has(extname(name).toLowerCase()) && !textNames.has(name.toLowerCase())) {
              return previewResponse({ kind: "unavailable", reason: "unsupported" });
            }

            if (info.size > limit) {
              if (operation === "preview") return previewResponse({ kind: "unavailable", reason: "too-large" });
              throw new Error("File limit");
            }

            const buffer = Buffer.alloc(limit + 1);
            let size = 0;

            while (size < buffer.length) {
              const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);

              if (!bytesRead) break;
              size += bytesRead;
            }

            if (size > limit) {
              if (operation === "preview") return previewResponse({ kind: "unavailable", reason: "too-large" });
              throw new Error("File limit");
            }

            if (operation === "preview") {
              let text: string;

              try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)); }
              catch { return previewResponse({ kind: "unavailable", reason: "not-text" }); }

              // A text extension is only a hint: reject binary control bytes too.
              for (const character of text) {
                const code = character.charCodeAt(0);

                if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
                  return previewResponse({ kind: "unavailable", reason: "not-text" });
                }
              }

              return previewResponse({ kind: "text", text });
            }

            return HttpServerResponse.uint8Array(buffer.subarray(0, size), { contentType: "application/octet-stream",
              headers: { ...headers, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
          } finally { await file.close(); }
        } finally { await parent.close(); }
      }, catch: () => new FileError() });
    }).pipe(Effect.catchTags({
      AccessDenied: () => Effect.succeed(HttpServerResponse.text("Sign in again", { status: 401, headers })),
      IdentityError: () => Effect.succeed(HttpServerResponse.text("Unavailable", { status: 503, headers })),
      FileError: () => Effect.succeed(HttpServerResponse.text("File unavailable, invalid path, or size limit exceeded", { status: 400, headers })),
    }));

    yield* router.add(operation === "upload" ? "POST" : "GET", operation === "download" || operation === "preview" ? `/api/files/${operation}` : "/api/files", handler);
  }
}));
