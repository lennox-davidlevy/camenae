import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import {
  candidates, downloadLimit, EditPath, listLimit, pathsLimit, plainText, previewLimit, protectedFolders, secretLike, uploadLimit, WorkspaceFilePath,
  type FailureCode, type FileEdit, type FileEntry, type FileListing, type FilePaths, type FilePreview, type UploadMode,
} from "./file-contract.js";

// Linux deployment: each component is opened relative to an already-open
// directory inode, never through a link. A concurrent tool cannot redirect
// traversal. Nothing here is a sandbox boundary for the agent itself.
export class FileProblem extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

const exists = z.object({ code: z.literal("EEXIST") });

const writeFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export async function openDirectory(root: string, parts: readonly string[], create = false): Promise<FileHandle> {
  let handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);

  try {
    for (const part of parts) {
      const path = `/proc/self/fd/${handle.fd}/${part}`;

      if (create) {
        try { await mkdir(path, { mode: 0o700 }); }
        catch (error) { if (!exists.safeParse(error).success) throw error; }
      }

      const next = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await handle.close();
      handle = next;
    }

    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

const split = (path: string) => {
  const parts = path.split("/");
  const name = parts.pop();

  if (!name) throw new FileProblem("INVALID");

  return { parts, name };
};

const inside = async <A>(root: string, parts: readonly string[], work: (base: string) => Promise<A>, create = false) => {
  const parent = await openDirectory(root, parts, create);

  try { return await work(`/proc/self/fd/${parent.fd}`); }
  finally { await parent.close(); }
};

export async function listDirectory(root: string, parts: readonly string[], showHidden: boolean): Promise<FileListing> {
  return inside(root, parts, async (base) => {
    const entries: FileEntry[] = [];
    let truncated = false;

    // Async iteration closes the directory on completion, break, or rejection.
    for await (const entry of await opendir(base, { bufferSize: 64 })) {
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const hidden = secretLike(entry.name);

      if (hidden && !showHidden) continue;

      if (entries.length >= listLimit) {
        truncated = true;
        break;
      }

      const size = entry.isFile() ? (await lstat(`${base}/${entry.name}`)).size : null;
      entries.push({ name: entry.name, directory: entry.isDirectory(), size, hidden });
    }

    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));

    return { entries, truncated };
  });
}

// Every visible file path, for the @ finder. Skips dependency and repository folders.
export async function listPaths(root: string): Promise<FilePaths> {
  const paths: string[] = [];
  let truncated = false;
  const queue: string[][] = [[]];

  for (let next = queue.shift(); next && !truncated; next = queue.shift()) {
    const parts = next;

    if (parts.length > 12) continue;
    let parent: FileHandle;

    try { parent = await openDirectory(root, parts); }
    catch { continue; }

    try {
      for await (const entry of await opendir(`/proc/self/fd/${parent.fd}`, { bufferSize: 64 })) {
        if (secretLike(entry.name)) continue;

        if (entry.isDirectory()) {
          if (entry.name !== ".git" && entry.name !== "node_modules") queue.push([...parts, entry.name]);
          continue;
        }

        if (!entry.isFile()) continue;

        if (paths.length >= pathsLimit) {
          truncated = true;
          break;
        }

        paths.push([...parts, entry.name].join("/"));
      }
    } finally { await parent.close(); }
  }

  paths.sort();

  return { paths, truncated };
}

async function readRegular(root: string, relative: string, limit: number) {
  const { parts, name } = split(WorkspaceFilePath.parse(relative));

  return inside(root, parts, async (base) => {
    const file = await open(`${base}/${name}`, readFlags);

    try {
      const info = await file.stat();

      if (!info.isFile()) throw new FileProblem("INVALID");

      if (info.size > limit) return { size: info.size, bytes: undefined };
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;

      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);

        if (!bytesRead) break;
        size += bytesRead;
      }

      return { size, bytes: size > limit ? undefined : buffer.subarray(0, size) };
    } finally { await file.close(); }
  });
}

export async function previewFile(root: string, relative: string): Promise<FilePreview> {
  const { size, bytes } = await readRegular(root, relative, previewLimit);

  if (!bytes) return { kind: "unavailable", reason: "too-large", size };
  let text: string;

  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { kind: "unavailable", reason: "not-text", size }; }

  return plainText(text) ? { kind: "text", text, size } : { kind: "unavailable", reason: "not-text", size };
}

export async function downloadFile(root: string, relative: string) {
  const { bytes } = await readRegular(root, relative, downloadLimit);

  if (!bytes) throw new FileProblem("FILE_TOO_LARGE");

  return { name: relative.split("/").at(-1) ?? "file", bytes };
}

// A regular file inside the workspace, without reading it.
export async function fileSize(root: string, relative: string) {
  const { parts, name } = split(WorkspaceFilePath.parse(relative));

  return inside(root, parts, async (base) => {
    const info = await lstat(`${base}/${name}`);

    if (!info.isFile()) throw new FileProblem("INVALID");

    return info.size;
  });
}

// Saves bytes into the workspace and resolves with the path they were saved at.
// fail: refuse an existing name. unique: "name-2.ext" when taken. replace: swap
// a regular file atomically; never a folder or a link.
export async function uploadFile(root: string, relative: string, mode: UploadMode, bytes: Uint8Array) {
  const { parts, name } = split(EditPath.parse(relative));

  if (bytes.length > uploadLimit) throw new FileProblem("FILE_TOO_LARGE");

  return inside(root, parts, async (base) => {
    const write = async (file: FileHandle, path: string) => {
      try { await file.writeFile(bytes); }
      catch (error) {
        await file.close();
        await unlink(path).catch(() => undefined);
        throw error;
      }

      await file.close();
    };

    if (mode === "replace") {
      const current = await lstat(`${base}/${name}`).catch(() => null);

      if (current && !current.isFile()) throw new FileProblem("PATH_NOT_ALLOWED");
      const temporary = `${base}/.upload-${randomUUID()}`;
      await write(await open(temporary, writeFlags, 0o600), temporary);

      try { await rename(temporary, `${base}/${name}`); }
      catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }

      return [...parts, name].join("/");
    }

    for (const candidate of candidates(name, mode === "unique" ? 100 : 1)) {
      const path = `${base}/${candidate}`;
      let file: FileHandle;

      try { file = await open(path, writeFlags, 0o600); }
      catch (error) {
        if (exists.safeParse(error).success) continue;
        throw error;
      }

      await write(file, path);

      return [...parts, candidate].join("/");
    }

    throw new FileProblem("FILE_EXISTS");
  }, true);
}

const protectedTop = (parts: readonly string[]) => parts.length === 1 && protectedFolders.some((folder) => folder === parts[0]);

export async function editWorkspace(root: string, edit: FileEdit): Promise<void> {
  if (edit.op === "folder") {
    const { parts, name } = split(edit.path);

    await inside(root, parts, async (base) => {
      try { await mkdir(`${base}/${name}`, { mode: 0o700 }); }
      catch (error) {
        if (exists.safeParse(error).success) throw new FileProblem("FILE_EXISTS");
        throw error;
      }
    }, true);

    return;
  }

  if (edit.op === "delete") {
    const { parts, name } = split(edit.path);

    if (protectedTop([...parts, name])) throw new FileProblem("PATH_NOT_ALLOWED");

    await inside(root, parts, async (base) => {
      if (!await lstat(`${base}/${name}`).catch(() => null)) throw new FileProblem("NOT_FOUND");

      // A link is removed itself; rm never follows links inside a folder.
      await rm(`${base}/${name}`, { recursive: true });
    });

    return;
  }

  const from = split(edit.from);
  const to = split(edit.to);
  const source = [...from.parts, from.name];

  if (protectedTop(source) || edit.to === edit.from || edit.to.startsWith(`${edit.from}/`)) throw new FileProblem("PATH_NOT_ALLOWED");

  await inside(root, from.parts, (fromBase) => inside(root, to.parts, async (toBase) => {
    if (!await lstat(`${fromBase}/${from.name}`).catch(() => null)) throw new FileProblem("NOT_FOUND");

    // rename replaces a file at the destination; a move never does.
    if (await lstat(`${toBase}/${to.name}`).catch(() => null)) throw new FileProblem("FILE_EXISTS");
    await rename(`${fromBase}/${from.name}`, `${toBase}/${to.name}`);
  }, true));
}
