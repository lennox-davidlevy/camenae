import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { z } from "zod";

const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const origin = process.env.CAMENAE_ORIGIN ?? base;

const get = (path: string) => fetch(base + path, { headers: { cookie } });

const { csrf } = z.object({ csrf: z.string() }).parse(await (await get("/api/chat")).json());

const upload = (token: string, requestOrigin = origin) => fetch(base + "/api/files", {
  method: "POST", headers: { cookie, origin: requestOrigin, "content-type": "application/json" },
  body: JSON.stringify({ csrf: token, name: "input.txt", text: "<script>not executable</script>" }),
});

assert.equal((await fetch(base + "/api/files")).status, 401);

assert.equal((await upload("wrong-csrf")).status, 401);

assert.equal((await upload(csrf, "https://attacker.invalid")).status, 400);

const uploaded = z.object({ path: z.string() }).parse(await (await upload(csrf)).json());

const download = await get(`/api/files/download?path=${encodeURIComponent(uploaded.path)}`);

assert.equal(download.status, 200);

assert.equal(download.headers.get("content-type"), "application/octet-stream");

assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);

assert.equal(await download.text(), "<script>not executable</script>");

// Bob may create artifacts at the workspace root or in its own subdirectories.
await mkdir("/data/workspace/examples/nested", { recursive: true });

for (const path of ["HelloWorld.jsx", "examples/nested/hello.txt"]) {
  await writeFile(`/data/workspace/${path}`, `synthetic artifact: ${path}`);
  const parent = path.split("/").slice(0, -1).join("/");
  const listing = await get(`/api/files?path=${encodeURIComponent(parent)}`);
  assert.equal(listing.status, 200);
  const { entries } = z.object({ entries: z.array(z.object({ name: z.string(), directory: z.boolean() })) }).parse(await listing.json());
  assert.ok(entries.some((entry) => entry.name === path.split("/").at(-1) && !entry.directory));
  const artifact = await get(`/api/files/download?path=${encodeURIComponent(path)}`);
  assert.equal(artifact.status, 200);
  assert.match(artifact.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(await artifact.text(), `synthetic artifact: ${path}`);
}

for (const operation of ["download", "preview"]) {
  assert.equal((await fetch(`${base}/api/files/${operation}?path=HelloWorld.jsx`)).status, 401);
}

for (const [text, status] of [["é".repeat(4000), 200], ["é".repeat(4000) + "x", 400]] as const) {
  const response = await fetch(base + "/api/files", { method: "POST", headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ csrf, name: "multibyte.txt", text }) });

  assert.equal(response.status, status);
}

await mkdir("/data/workspace/outputs/large-directory");

await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(`/data/workspace/outputs/large-directory/${index}`, "")));

assert.equal((await get("/api/files?path=outputs/large-directory")).status, 400);

await mkdir("/data/tmp/file-boundary", { recursive: true });

await writeFile("/data/tmp/file-boundary/private.txt", "synthetic-private-data");

await symlink("/data/tmp/file-boundary/private.txt", "/data/workspace/outputs/file-link");

await symlink("/data/tmp/file-boundary", "/data/workspace/outputs/directory-link");

await symlink("/data/tmp/file-boundary/private.txt", "/data/workspace/root-link");

await symlink("/data/tmp/file-boundary", "/data/workspace/root-directory-link");

execFileSync("mkfifo", ["/data/workspace/outputs/pipe"]);

for (const path of ["", "/etc/passwd", ".", "examples//nested/hello.txt", "HelloWorld.jsx\0", "../tmp/file-boundary/private.txt", "outputs/../inbox/input.txt", "root-link", "root-directory-link/private.txt", "outputs/file-link", "outputs/directory-link/private.txt", "outputs/pipe", "outputs", "missing.txt"]) {
  for (const operation of ["download", "preview"]) {
    const response = await get(`/api/files/${operation}?path=${encodeURIComponent(path)}`);
    assert.equal(response.status, 400, `${operation}: ${path}`);
  }
}

for (const path of ["..", "/", "examples/../outputs", "root-directory-link"]) {
  assert.equal((await get(`/api/files?path=${encodeURIComponent(path)}`)).status, 400);
}

await mkdir("/data/workspace/preview-cases");

const atLimit = "é".repeat(32768);

// These run through the deployed route and Linux filesystem boundary, not a
// preview helper. Formats, byte limits, and content rejection are API contracts.
for (const [name, contents, expected] of [
  ["empty.txt", "", { kind: "text", text: "" }],
  ["notes.MD", "# Notes\nこんにちは\n", { kind: "text", text: "# Notes\nこんにちは\n" }],
  ["report.csv", "cohort,count\r\nA,3\r\n", { kind: "text", text: "cohort,count\r\nA,3\r\n" }],
  ["data.json", '{"hello":"world"}', { kind: "text", text: '{"hello":"world"}' }],
  ["unsafe & #1.jsx", '<script>globalThis.previewExecuted = true</script>\n<div>Example</div>', { kind: "text", text: '<script>globalThis.previewExecuted = true</script>\n<div>Example</div>' }],
  ["Dockerfile", "FROM example\n", { kind: "text", text: "FROM example\n" }],
  ["limit.txt", atLimit, { kind: "text", text: atLimit }],
  ["oversize.txt", atLimit + "x", { kind: "unavailable", reason: "too-large" }],
  ["report.pdf", "%PDF-1.7\n", { kind: "unavailable", reason: "unsupported" }],
  ["binary.txt", Buffer.from([65, 0, 66]), { kind: "unavailable", reason: "not-text" }],
  ["invalid-utf8.txt", Buffer.from([0xc3, 0x28]), { kind: "unavailable", reason: "not-text" }],
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

// Preview rejection does not take away the existing attachment download path.
const largeDownload = await get("/api/files/download?path=preview-cases/oversize.txt");

assert.equal(largeDownload.status, 200);

assert.equal(await largeDownload.text(), atLimit + "x");

await writeFile("/data/workspace/preview-cases/notes.MD", "Updated text");

assert.deepEqual(await (await get("/api/files/preview?path=preview-cases/notes.MD")).json(), { kind: "text", text: "Updated text" });

console.log("Files passed: upload/download/preview authentication, UTF-8 text previews and byte limits, CSRF/origin, attachment headers, traversal, symlinks, and special-file rejection.");
