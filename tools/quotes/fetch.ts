import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Lock, Sources } from "./schema.js";
import { cacheDirectory, dataDirectory, lockPath, sourcesPath, textPath } from "./paths.js";
import { headerField, sha256 } from "./text.js";

// Downloads each listed edition once, slowly, and records its checksum.
// Project Gutenberg asks automated clients to be gentle; the cache means this is rare.
//   bun tools/quotes/fetch.ts            fetch what is missing, verify against the lock
//   bun tools/quotes/fetch.ts --update   also rewrite the lock (after a deliberate re-download)
const pause = 3000;

const update = process.argv.includes("--update");

const sources = Sources.parse(JSON.parse(await readFile(sourcesPath, "utf8")));

const lock = Lock.parse(JSON.parse(await readFile(lockPath, "utf8").catch(() => "[]")));

await mkdir(cacheDirectory, { recursive: true });

await mkdir(dataDirectory, { recursive: true });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const download = async (id: number) => {
  const response = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, { headers: { "user-agent": "camenae-quotes/0.1 (personal project; local cache)" } });

  if (!response.ok) throw new Error(`pg${id}: HTTP ${response.status}`);

  return new Uint8Array(await response.arrayBuffer());
};

const problems: string[] = [];

const next: Lock = [];

for (const source of sources) {
  const path = textPath(source.id);
  let bytes = await Bun.file(path).bytes().catch(() => undefined);

  if (!bytes) {
    try { bytes = await download(source.id); }
    catch (failure) {
      problems.push(failure instanceof Error ? failure.message : `pg${source.id}: download failed`);
      await sleep(pause);
      continue;
    }

    await writeFile(path, bytes);
    await sleep(pause);
  }

  const raw = new TextDecoder().decode(bytes);
  const title = headerField(raw, "Title");
  const digest = sha256(bytes);
  const locked = lock.find((entry) => entry.id === source.id);

  if (!title.toLowerCase().includes(source.title.toLowerCase())) {
    problems.push(`pg${source.id}: expected "${source.title}" but the file says "${title}"`);
    continue;
  }

  if (locked && locked.sha256 !== digest && !update) {
    problems.push(`pg${source.id}: file changed since the lock was written (run with --update to accept)`);
    continue;
  }

  next.push({ id: source.id, sha256: digest, title, retrieved: locked && !update ? locked.retrieved : new Date().toISOString().slice(0, 10) });
  console.log(`pg${source.id}  ${title}  (${source.author}; translator: ${headerField(raw, "Translator") || "not stated"})`);
}

if (problems.length === 0 || update) {
  const kept = lock.filter((entry) => !next.some((fresh) => fresh.id === entry.id));

  await writeFile(lockPath, `${JSON.stringify([...kept, ...next].sort((a, b) => a.id - b.id), undefined, 2)}\n`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
