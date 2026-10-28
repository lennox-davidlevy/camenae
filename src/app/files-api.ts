import { z } from "zod";
import { FailureCode, FileListing, FilePaths, FilePreview, type UploadMode } from "../file-contract.js";

export class FileRequestError extends Error {
  constructor(readonly code: FailureCode | "UNKNOWN", message: string) {
    super(message);
  }
}

const Failure = z.object({ code: FailureCode, message: z.string() });

const Saved = z.object({ path: z.string() });

async function check(response: Response) {
  if (response.ok) return response;

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new FileRequestError("UNKNOWN", "Please sign in again");
  }

  const parsed = Failure.safeParse(await response.json().catch(() => undefined));

  throw parsed.success ? new FileRequestError(parsed.data.code, parsed.data.message) : new FileRequestError("UNKNOWN", "The request failed. Nothing was changed.");
}

export async function listFiles(path: string, hidden: boolean) {
  const query = new URLSearchParams({ path });

  if (hidden) query.set("hidden", "1");

  return FileListing.parse(await (await check(await fetch(`/api/files?${query}`))).json());
}

export async function listPaths() {
  return FilePaths.parse(await (await check(await fetch("/api/files/paths"))).json());
}

export async function previewFile(path: string) {
  return FilePreview.parse(await (await check(await fetch(`/api/files/preview?${new URLSearchParams({ path })}`))).json());
}

export const downloadHref = (path: string) => `/api/files/download?${new URLSearchParams({ path })}`;

// Raw bytes, so a file is never copied through JSON. Resolves with the path it was saved at.
export async function uploadFile(csrf: string, path: string, file: Blob, mode: UploadMode) {
  const response = await fetch(`/api/files/upload?${new URLSearchParams({ path, mode })}`, {
    method: "POST", body: file, headers: { "content-type": "application/octet-stream", "x-camenae-csrf": csrf },
  });

  return Saved.parse(await (await check(response)).json()).path;
}

const edit = async (body: { op: "delete" | "move" | "folder"; csrf: string; path?: string; from?: string; to?: string }) => {
  await check(await fetch("/api/files/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

export const addFolder = (csrf: string, path: string) => edit({ op: "folder", csrf, path });

export const movePath = (csrf: string, from: string, to: string) => edit({ op: "move", csrf, from, to });

export const deletePath = (csrf: string, path: string) => edit({ op: "delete", csrf, path });
