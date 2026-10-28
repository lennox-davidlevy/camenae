import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const origin = process.env.CAMENAE_ORIGIN ?? base;

const mebibyte = 1024 * 1024;

const get = (path: string) => fetch(base + path, { headers: { cookie } });

const { csrf } = z.object({ csrf: z.string() }).parse(await (await get("/api/chat")).json());

interface RawOptions {
  mode?: string;
  token?: string;
  requestOrigin?: string;
  type?: string;
  signed?: boolean;
}

const raw = (path: string, body: BodyInit, options: RawOptions = {}) => {
  const query = new URLSearchParams({ path });
  const headers = new Headers({ origin: options.requestOrigin ?? origin, "content-type": options.type ?? "application/octet-stream", "x-camenae-csrf": options.token ?? csrf });

  if (options.mode) query.set("mode", options.mode);

  if (options.signed !== false) headers.set("cookie", cookie);

  return fetch(`${base}/api/files/upload?${query}`, { method: "POST", body, headers });
};

interface EditBody {
  op: "delete" | "move" | "folder";
  path?: string;
  from?: string;
  to?: string;
}

const edit = (body: EditBody, options: RawOptions = {}) => {
  const headers = new Headers({ origin: options.requestOrigin ?? origin, "content-type": options.type ?? "application/json" });

  if (options.signed !== false) headers.set("cookie", cookie);

  return fetch(base + "/api/files/edit", { method: "POST", headers, body: JSON.stringify({ csrf: options.token ?? csrf, ...body }) });
};

const saved = async (response: Response) => z.object({ path: z.string() }).parse(await response.json()).path;

const code = async (response: Response) => z.object({ code: z.string() }).parse(await response.json()).code;

const download = async (path: string) => Buffer.from(await (await get(`/api/files/download?path=${encodeURIComponent(path)}`)).arrayBuffer());

const listing = async (path: string, extra = "") => z.object({
  entries: z.array(z.object({ name: z.string(), directory: z.boolean(), size: z.number().nullable(), hidden: z.boolean() })), truncated: z.boolean(),
}).parse(await (await get(`/api/files?path=${encodeURIComponent(path)}${extra}`)).json());

// Authentication and request-origin boundaries.
for (const path of ["/api/files", "/api/files/paths", "/api/files/preview?path=a.txt", "/api/files/download?path=a.txt"]) {
  assert.equal((await fetch(base + path)).status, 401, path);
}

assert.equal((await raw("auth/a.txt", "x", { signed: false })).status, 401);

assert.equal((await raw("auth/a.txt", "x", { token: "wrong-csrf" })).status, 401);

assert.equal((await raw("auth/a.txt", "x", { requestOrigin: "https://attacker.invalid" })).status, 400);

assert.equal((await raw("auth/a.txt", "x", { type: "text/plain" })).status, 400);

assert.equal((await edit({ op: "folder", path: "auth-folder" }, { signed: false })).status, 401);

assert.equal((await edit({ op: "folder", path: "auth-folder" }, { token: "wrong-csrf" })).status, 401);

assert.equal((await edit({ op: "folder", path: "auth-folder" }, { requestOrigin: "https://attacker.invalid" })).status, 400);

assert.equal((await edit({ op: "folder", path: "auth-folder" }, { type: "text/plain" })).status, 400);

assert.equal((await get("/api/files?path=auth-folder")).status, 404, "refused requests created nothing");

// Raw upload, byte for byte, with the three clash modes.
const bytes = randomBytes(3000);

assert.equal(await saved(await raw("outputs/data.bin", bytes, { mode: "fail" })), "outputs/data.bin");

assert.deepEqual(await download("outputs/data.bin"), bytes);

const second = await raw("outputs/data.bin", "other", { mode: "fail" });

assert.equal(second.status, 409);

assert.equal(await code(second), "FILE_EXISTS");

assert.deepEqual(await download("outputs/data.bin"), bytes, "a refused upload never touches the existing file");

assert.equal((await raw("outputs/data.bin", "two")).status, 409, "the default mode refuses to overwrite");

assert.equal(await saved(await raw("outputs/data.bin", "two", { mode: "unique" })), "outputs/data-2.bin");

assert.equal(await saved(await raw("outputs/data.bin", "three", { mode: "unique" })), "outputs/data-3.bin");

assert.equal(await saved(await raw("outputs/data.bin", "replaced", { mode: "replace" })), "outputs/data.bin");

assert.equal((await download("outputs/data.bin")).toString(), "replaced");

assert.equal((await download("outputs/data-2.bin")).toString(), "two");

assert.equal(await saved(await raw("scratch/README", "no extension", { mode: "unique" })), "scratch/README");

assert.equal(await saved(await raw("scratch/README", "no extension again", { mode: "unique" })), "scratch/README-2");

// Missing folders are created; invalid requests are refused.
assert.equal(await saved(await raw("projects/new/deep/file.txt", "nested")), "projects/new/deep/file.txt");

assert.equal((await download("projects/new/deep/file.txt")).toString(), "nested");

for (const path of ["../escape.txt", "/etc/passwd", "a//b.txt", "outputs/../x.txt", ".git/config", "project/.git/hooks/x", "bad\0name", ""]) {
  assert.equal((await raw(path, "refused")).status, 400, path);
}

assert.equal((await raw("outputs/data.bin", "x", { mode: "bogus" })).status, 400);

// Size limits: exactly the limit is accepted; one byte more is refused, with or without a length header.
const limit = 15 * mebibyte;

assert.equal((await raw("outputs/at-limit.bin", Buffer.alloc(limit))).status, 200);

assert.equal((await readFile("/data/workspace/outputs/at-limit.bin")).length, limit);

const over = await raw("outputs/over-limit.bin", Buffer.alloc(limit + 1));

assert.equal(over.status, 413);

assert.equal(await code(over), "FILE_TOO_LARGE");

const chunked = new ReadableStream<Uint8Array>({ start(controller) {
  for (let index = 0; index < 16; index++) controller.enqueue(new Uint8Array(mebibyte));
  controller.close();
} });

// SAFETY: Bun's fetch sends a streaming request body, which needs the duplex option the DOM typings omit.
const streamed = await fetch(`${base}/api/files/upload?${new URLSearchParams({ path: "outputs/chunked-over.bin" })}`, {
  method: "POST", body: chunked, duplex: "half", headers: { cookie, origin, "content-type": "application/octet-stream", "x-camenae-csrf": csrf },
} as RequestInit);

assert.equal(streamed.status, 413);

for (const path of ["outputs/over-limit.bin", "outputs/chunked-over.bin"]) assert.equal((await get(`/api/files/download?path=${path}`)).status, 404, `${path} was not left behind`);

// Downloads: attachment headers, and a size ceiling.
const attachment = await get("/api/files/download?path=outputs/data.bin");

assert.match(attachment.headers.get("content-disposition") ?? "", /^attachment;/);

assert.equal(attachment.headers.get("content-type"), "application/octet-stream");

assert.equal(attachment.headers.get("x-content-type-options"), "nosniff");

await writeFile("/data/workspace/outputs/too-big-to-download.bin", Buffer.alloc(25 * mebibyte + 1));

assert.equal((await get("/api/files/download?path=outputs/too-big-to-download.bin")).status, 413);

// Preview is by content, not extension, and says how big the file is.
await mkdir("/data/workspace/preview-cases");

const atLimit = "é".repeat(mebibyte / 2);

for (const [name, contents, expected] of [
  ["empty.txt", "", { kind: "text", text: "", size: 0 }],
  ["notes.MD", "# Notes\nこんにちは\n", { kind: "text", text: "# Notes\nこんにちは\n", size: Buffer.byteLength("# Notes\nこんにちは\n") }],
  ["no-extension", "plain words", { kind: "text", text: "plain words", size: 11 }],
  ["script.weird", "const x = 1;\n", { kind: "text", text: "const x = 1;\n", size: 13 }],
  ["report.pdf", "%PDF-1.7\n", { kind: "text", text: "%PDF-1.7\n", size: 9 }],
  ["unsafe & #1.jsx", "<script>globalThis.previewExecuted = true</script>", { kind: "text", text: "<script>globalThis.previewExecuted = true</script>", size: 50 }],
  ["limit.txt", atLimit, { kind: "text", text: atLimit, size: mebibyte }],
  ["oversize.txt", `${atLimit}x`, { kind: "unavailable", reason: "too-large", size: mebibyte + 1 }],
  ["binary.dat", Buffer.from([65, 0, 66]), { kind: "unavailable", reason: "not-text", size: 3 }],
  ["invalid-utf8.txt", Buffer.from([0xc3, 0x28]), { kind: "unavailable", reason: "not-text", size: 2 }],
] as const) {
  const path = `preview-cases/${name}`;
  await writeFile(`/data/workspace/${path}`, contents);
  const response = await get(`/api/files/preview?path=${encodeURIComponent(path)}`);
  assert.equal(response.status, 200, name);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), expected, name);
}

// Editing a text file is a replace upload of its new bytes.
await raw("preview-cases/notes.MD", "Updated text", { mode: "replace" });

assert.deepEqual(await (await get("/api/files/preview?path=preview-cases/notes.MD")).json(), { kind: "text", text: "Updated text", size: 12 });

// Listing: sizes, folders first, secret-like names hidden unless asked for.
await mkdir("/data/workspace/list-cases/folder", { recursive: true });

for (const name of ["b.txt", "a.txt", ".env", ".env.example", "id_rsa", "server.pem", "my-secret-notes.txt", "plain.txt"]) await writeFile(`/data/workspace/list-cases/${name}`, "12345");

const visible = await listing("list-cases");

assert.deepEqual(visible.entries.map((entry) => entry.name), ["folder", ".env.example", "a.txt", "b.txt", "plain.txt"]);

assert.equal(visible.entries[0]?.directory, true);

assert.equal(visible.entries[0]?.size, null);

assert.equal(visible.entries.find((entry) => entry.name === "a.txt")?.size, 5);

const everything = await listing("list-cases", "&hidden=1");

for (const name of [".env", "id_rsa", "server.pem", "my-secret-notes.txt"]) assert.equal(everything.entries.find((entry) => entry.name === name)?.hidden, true, name);

assert.equal(visible.truncated, false);

await mkdir("/data/workspace/outputs/large-directory");

await Promise.all(Array.from({ length: 1001 }, (_, index) => writeFile(`/data/workspace/outputs/large-directory/${index}`, "")));

const large = await listing("outputs/large-directory");

assert.equal(large.entries.length, 1000);

assert.equal(large.truncated, true);

// The @ finder's path list: nested files, nothing hidden, no repository or dependency folders.
await mkdir("/data/workspace/finder/node_modules/pkg", { recursive: true });

await mkdir("/data/workspace/finder/.git", { recursive: true });

await mkdir("/data/workspace/finder/src/deep", { recursive: true });

for (const path of ["finder/src/deep/mod.ts", "finder/src/index.ts", "finder/.env", "finder/node_modules/pkg/i.js", "finder/.git/HEAD", "finder/README"]) await writeFile(`/data/workspace/${path}`, "x");

const finder = z.object({ paths: z.array(z.string()), truncated: z.boolean() }).parse(await (await get("/api/files/paths")).json());

const found = finder.paths.filter((path) => path.startsWith("finder/"));

assert.deepEqual(found, ["finder/README", "finder/src/deep/mod.ts", "finder/src/index.ts"]);

// Folder, move and delete.
assert.equal((await edit({ op: "folder", path: "projects/made/by/edit" })).status, 200);

assert.deepEqual((await listing("projects/made/by")).entries.map((entry) => entry.name), ["edit"]);

const exists = await edit({ op: "folder", path: "projects/made/by/edit" });

assert.equal(exists.status, 409);

assert.equal(await code(exists), "FILE_EXISTS");

await raw("projects/made/file.txt", "to move");

assert.equal((await edit({ op: "move", from: "projects/made/file.txt", to: "projects/made/by/edit/moved.txt" })).status, 200);

assert.equal((await download("projects/made/by/edit/moved.txt")).toString(), "to move");

assert.equal((await get("/api/files/download?path=projects/made/file.txt")).status, 404);

await raw("projects/made/other.txt", "occupant");

await raw("projects/made/mover.txt", "mover");

assert.equal((await edit({ op: "move", from: "projects/made/mover.txt", to: "projects/made/other.txt" })).status, 409, "a move never replaces a file");

assert.equal((await download("projects/made/other.txt")).toString(), "occupant");

assert.equal((await edit({ op: "move", from: "projects/made", to: "projects/made/by/inside" })).status, 400, "a folder cannot move into itself");

assert.equal((await edit({ op: "move", from: "projects/made/by", to: "projects/renamed-by" })).status, 200);

assert.equal((await download("projects/renamed-by/edit/moved.txt")).toString(), "to move");

assert.equal((await edit({ op: "move", from: "projects/nothing-here", to: "projects/anywhere" })).status, 404);

assert.equal((await edit({ op: "delete", path: "projects/renamed-by" })).status, 200, "folders are removed with their contents");

assert.equal((await get("/api/files?path=projects/renamed-by")).status, 404);

assert.equal((await edit({ op: "delete", path: "projects/renamed-by" })).status, 404);

for (const folder of ["inbox", "projects", "outputs", "scratch"]) {
  assert.equal((await edit({ op: "delete", path: folder })).status, 400, `deleting ${folder}`);
  assert.equal((await edit({ op: "move", from: folder, to: `scratch/${folder}-moved` })).status, 400, `moving ${folder}`);
}

assert.equal((await edit({ op: "delete", path: "finder/.git" })).status, 400, "repository files are not editable here");

assert.equal((await edit({ op: "folder", path: "finder/.git/new" })).status, 400);

assert.equal((await edit({ op: "delete", path: "../tmp" })).status, 400);

// Links and special files are never followed or replaced.
await mkdir("/data/tmp/file-boundary", { recursive: true });

await writeFile("/data/tmp/file-boundary/private.txt", "synthetic-private-data");

await symlink("/data/tmp/file-boundary/private.txt", "/data/workspace/outputs/file-link");

await symlink("/data/tmp/file-boundary", "/data/workspace/outputs/directory-link");

await symlink("/data/tmp/file-boundary/private.txt", "/data/workspace/root-link");

await symlink("/data/tmp/file-boundary", "/data/workspace/root-directory-link");

execFileSync("mkfifo", ["/data/workspace/outputs/pipe"]);

assert.equal((await raw("outputs/directory-link/private.txt", "must not write", { mode: "replace" })).status, 400);

assert.equal((await raw("outputs/file-link", "must not replace", { mode: "replace" })).status, 400);

assert.equal((await raw("outputs/file-link", "must not write", { mode: "fail" })).status, 409);

assert.equal(await saved(await raw("outputs/file-link", "safe copy", { mode: "unique" })), "outputs/file-link-2");

assert.equal((await edit({ op: "folder", path: "outputs/directory-link/new" })).status, 400);

assert.equal((await edit({ op: "move", from: "outputs/file-link", to: "outputs/moved-link" })).status, 200, "a link moves as a link");

assert.equal(await Bun.file("/data/tmp/file-boundary/private.txt").text(), "synthetic-private-data");

assert.equal((await edit({ op: "delete", path: "outputs/directory-link" })).status, 200, "deleting a link removes the link");

assert.equal(await Bun.file("/data/tmp/file-boundary/private.txt").text(), "synthetic-private-data", "its target is untouched");

for (const path of ["", "/etc/passwd", ".", "a//b.txt", "x\0y", "../tmp/file-boundary/private.txt", "outputs/../inbox/x.txt", "root-link", "root-directory-link/private.txt", "outputs/pipe", "outputs/moved-link"]) {
  for (const operation of ["download", "preview"]) {
    const response = await get(`/api/files/${operation}?path=${encodeURIComponent(path)}`);
    assert.equal(response.status, 400, `${operation}: ${path}`);
  }
}

for (const path of ["..", "/", "examples/../outputs", "root-directory-link"]) assert.equal((await get(`/api/files?path=${encodeURIComponent(path)}`)).status, 400, path);

const skipped = await listing("outputs");

for (const name of ["pipe", "moved-link", "file-link-2"]) {
  const entry = skipped.entries.find((item) => item.name === name);
  assert.ok(name === "file-link-2" ? entry : !entry, `${name} in the listing`);
}

console.log("Files passed: raw uploads with fail/unique/replace, size limits, previews by content, listings, path finder, folder/move/delete, CSRF/origin, traversal, links, and special files.");
