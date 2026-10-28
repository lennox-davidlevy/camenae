import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Sources } from "./schema.js";
import { extract } from "./extract.js";
import { candidatesPath, sourcesPath, textPath } from "./paths.js";

// Proposes quotable passages from each cached edition. This only narrows a whole book
// to a reviewable list; nothing here approves a quote.
//   bun tools/quotes/candidates.ts [--per-work 120]
const perWorkIndex = process.argv.indexOf("--per-work");

const perWork = perWorkIndex === -1 ? 120 : Number(process.argv[perWorkIndex + 1]);

if (!Number.isInteger(perWork) || perWork < 1) throw new Error("--per-work needs a positive integer");

const sources = Sources.parse(JSON.parse(await readFile(sourcesPath, "utf8")));

for (const source of sources) {
  const raw = await readFile(textPath(source.id), "utf8").catch(() => "");

  if (raw === "") {
    console.error(`pg${source.id}: not fetched`);
    continue;
  }

  const found = extract(source, raw);
  const best = found.slice(0, perWork);

  await mkdir(dirname(candidatesPath(source.id)), { recursive: true });
  await writeFile(candidatesPath(source.id), best.map((candidate) => JSON.stringify(candidate)).join("\n") + "\n");
  console.log(`pg${source.id}  ${found.length} passages, kept ${best.length}  (${source.work})`);
}
