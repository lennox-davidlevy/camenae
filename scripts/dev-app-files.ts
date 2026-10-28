import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  candidates, downloadLimit, EditPath, FailureCode, failureMessages, FileEdit, listLimit, pathsLimit, plainText, previewLimit, protectedFolders, secretLike,
  UploadMode, uploadLimit, WorkspaceFilePath, type FileEntry,
} from "../src/file-contract.js";

// An in-memory workspace for the dev server. It mirrors the real file routes'
// behavior and status codes (modes, limits, protected folders, hidden names) so
// the Files screen and attachments can be tried without Docker. State resets on restart.
const csrf = "fixture";

const text = (value: string) => new TextEncoder().encode(value);

const files = new Map<string, Uint8Array>([
  ["outputs/summary.md", text("# Weekly summary\n\n- Shipped the Solid chat\n- Settings screen in progress\n")],
  ["outputs/results.csv", text("cohort,count\nA,12\nB,7\nC,31\n")],
  ["outputs/chart.bin", Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 3, 255, 254, 0, 9])],
  ["projects/game-tracker/README.md", text("# Game tracker\n\nA backlog of games to play next.\n")],
  ["projects/game-tracker/tracker.json", text('{ "games": [{ "title": "Hades", "status": "playing" }] }\n')],
  ["scratch/notes.txt", text("remember to rename the files in outputs\n")],
  ["scratch/.env", text("EXAMPLE_TOKEN=not-a-real-secret\n")],
]);

const folders = new Set<string>(["inbox", "projects", "outputs", "scratch", "projects/game-tracker"]);

class Problem extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

const statuses = { FILE_EXISTS: 409, FILE_TOO_LARGE: 413, PATH_NOT_ALLOWED: 400, NOT_FOUND: 404, INVALID: 400 } satisfies Record<FailureCode, number>;

const reply = <T,>(response: ServerResponse, value: T, status = 200) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const fail = (response: ServerResponse, code: FailureCode) => reply(response, { code, message: failureMessages[code] }, statuses[code]);

const parent = (path: string) => path.split("/").slice(0, -1).join("/");

const ensureFolders = (path: string) => {
  const parts = path.split("/");

  for (let index = 1; index <= parts.length; index++) {
    const folder = parts.slice(0, index).join("/");

    if (files.has(folder)) throw new Problem("PATH_NOT_ALLOWED");
    folders.add(folder);
  }
};

const children = (folder: string) => {
  const prefix = folder ? `${folder}/` : "";
  const entries = new Map<string, FileEntry>();

  for (const [path, bytes] of files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const name = rest.split("/")[0] ?? rest;

    if (rest.includes("/")) entries.set(name, { name, directory: true, size: null, hidden: secretLike(name) });
    else entries.set(name, { name, directory: false, size: bytes.length, hidden: secretLike(name) });
  }

  for (const path of folders) {
    if (!path.startsWith(prefix) || path === folder) continue;
    const name = path.slice(prefix.length).split("/")[0] ?? "";

    if (name) entries.set(name, { name, directory: true, size: null, hidden: secretLike(name) });
  }

  return [...entries.values()];
};

const body = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    total += Buffer.from(chunk).length;

    if (total > uploadLimit) throw new Problem("FILE_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const operate = async (request: IncomingMessage, response: ServerResponse, path: string, url: URL) => {
  const method = request.method ?? "GET";

  if (path === "/api/files" && method === "GET") {
    const folder = url.searchParams.get("path") ?? "";

    if (folder && !WorkspaceFilePath.safeParse(folder).success) throw new Problem("INVALID");

    if (folder && !folders.has(folder) && children(folder).length === 0) throw new Problem("NOT_FOUND");
    const hidden = url.searchParams.get("hidden") === "1";
    const all = children(folder).filter((entry) => hidden || !entry.hidden);
    const entries = all.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).slice(0, listLimit);

    return reply(response, { entries, truncated: all.length > listLimit });
  }

  if (path === "/api/files/paths" && method === "GET") {
    const all = [...files.keys()].filter((file) => !file.split("/").some((part) => secretLike(part) || part === ".git" || part === "node_modules")).sort();

    return reply(response, { paths: all.slice(0, pathsLimit), truncated: all.length > pathsLimit });
  }

  if ((path === "/api/files/preview" || path === "/api/files/download") && method === "GET") {
    const file = WorkspaceFilePath.safeParse(url.searchParams.get("path") ?? "");

    if (!file.success) throw new Problem("INVALID");
    const bytes = files.get(file.data);

    if (!bytes) throw new Problem(folders.has(file.data) ? "INVALID" : "NOT_FOUND");

    if (path === "/api/files/download") {
      if (bytes.length > downloadLimit) throw new Problem("FILE_TOO_LARGE");
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.data.split("/").at(-1) ?? "file")}`);
      response.end(Buffer.from(bytes));

      return undefined;
    }

    if (bytes.length > previewLimit) return reply(response, { kind: "unavailable", reason: "too-large", size: bytes.length });

    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

      return reply(response, plainText(decoded) ? { kind: "text", text: decoded, size: bytes.length } : { kind: "unavailable", reason: "not-text", size: bytes.length });
    } catch { return reply(response, { kind: "unavailable", reason: "not-text", size: bytes.length }); }
  }

  if (method !== "POST") throw new Problem("INVALID");

  if (path === "/api/files/upload") {
    if (request.headers["x-camenae-csrf"] !== csrf) return reply(response, { error: "Sign in again" }, 401);
    const query = z.object({ path: EditPath, mode: UploadMode.default("fail") }).safeParse(Object.fromEntries(url.searchParams));

    if (!query.success) throw new Problem("INVALID");
    const bytes = await body(request);

    ensureFolders(parent(query.data.path));
    const taken = (candidate: string) => files.has(candidate) || folders.has(candidate);

    if (query.data.mode === "replace") {
      if (folders.has(query.data.path)) throw new Problem("PATH_NOT_ALLOWED");
      files.set(query.data.path, bytes);

      return reply(response, { path: query.data.path });
    }

    for (const candidate of candidates(query.data.path, query.data.mode === "unique" ? 100 : 1)) {
      if (taken(candidate)) continue;
      files.set(candidate, bytes);

      return reply(response, { path: candidate });
    }

    throw new Problem("FILE_EXISTS");
  }

  if (path === "/api/files/edit") {
    const edit = FileEdit.safeParse(JSON.parse((await body(request)).toString("utf8") || "{}"));

    if (!edit.success) throw new Problem("INVALID");

    if (edit.data.csrf !== csrf) return reply(response, { error: "Sign in again" }, 401);
    const top = (target: string) => protectedFolders.some((folder) => folder === target);

    if (edit.data.op === "folder") {
      if (files.has(edit.data.path) || folders.has(edit.data.path)) throw new Problem("FILE_EXISTS");
      ensureFolders(edit.data.path);
    } else if (edit.data.op === "delete") {
      const target = edit.data.path;

      if (top(target)) throw new Problem("PATH_NOT_ALLOWED");

      if (!files.has(target) && !folders.has(target)) throw new Problem("NOT_FOUND");

      // Deleting from a Map while iterating it is safe.
      for (const file of files.keys()) if (file === target || file.startsWith(`${target}/`)) files.delete(file);

      for (const folder of folders) if (folder === target || folder.startsWith(`${target}/`)) folders.delete(folder);
    } else {
      const { from, to } = edit.data;

      if (top(from) || to === from || to.startsWith(`${from}/`)) throw new Problem("PATH_NOT_ALLOWED");

      if (!files.has(from) && !folders.has(from)) throw new Problem("NOT_FOUND");

      if (files.has(to) || folders.has(to)) throw new Problem("FILE_EXISTS");
      ensureFolders(parent(to));

      // Collect first: the destination keys are added while the source keys are removed.
      const movingFiles = Array.from(files).filter(([file]) => file === from || file.startsWith(`${from}/`));
      const movingFolders = Array.from(folders).filter((folder) => folder === from || folder.startsWith(`${from}/`));

      for (const [file, bytes] of movingFiles) {
        files.delete(file);
        files.set(`${to}${file.slice(from.length)}`, bytes);
      }

      for (const folder of movingFolders) {
        folders.delete(folder);
        folders.add(`${to}${folder.slice(from.length)}`);
      }
    }

    return reply(response, { ok: true });
  }

  throw new Problem("INVALID");
};

// Whether a path exists as a file, for attachments sent with a message.
export const fixtureFileSize = (path: string) => files.get(path)?.length;

export const filesRoute = async (request: IncomingMessage, response: ServerResponse, path: string) => {
  try { await operate(request, response, path, new URL(request.url ?? "/", "http://localhost")); }
  catch (error) {
    if (error instanceof Problem) fail(response, error.code);
    else fail(response, "INVALID");
  }
};
