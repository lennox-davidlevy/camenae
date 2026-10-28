import { readFile, writeFile } from "node:fs/promises";
import { Approved, Lock, Quote, Sources } from "./schema.js";
import { approvedPath, lockPath, quotesPath, sourcesPath, textPath } from "./paths.js";
import { bookBody, paragraphs, quoteId, sha256, squash, stanzas, textFragment, withoutNumeral } from "./text.js";

// Builds data/quotes/quotes.jsonl from the approved list and refuses anything that is not
// word for word in the pinned Project Gutenberg edition.
//   bun tools/quotes/build.ts
const sources = Sources.parse(JSON.parse(await readFile(sourcesPath, "utf8")));

const lock = Lock.parse(JSON.parse(await readFile(lockPath, "utf8")));

const approved = (await readFile(approvedPath, "utf8").catch(() => ""))
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => Approved.parse(JSON.parse(line)));

const problems: string[] = [];

// Each edition's prose, once, as unwrapped paragraphs.
const prose = new Map<number, string[]>();

for (const source of sources) {
  const bytes = await Bun.file(textPath(source.id)).bytes().catch(() => undefined);
  const pinned = lock.find((entry) => entry.id === source.id);

  if (!bytes || !pinned) continue;

  if (sha256(bytes) !== pinned.sha256) {
    problems.push(`pg${source.id}: cached text differs from sources.lock.json`);
    continue;
  }

  const body = bookBody(new TextDecoder().decode(bytes));

  prose.set(source.id, (source.verse ? stanzas(body) : paragraphs(body)).map((paragraph) => withoutNumeral(paragraph.text)));
}

const ids = new Set<string>();

const quotes: Quote[] = [];

for (const record of approved) {
  const source = sources.find((entry) => entry.id === record.source);
  const paragraphsOfSource = prose.get(record.source);

  if (!source) {
    problems.push(`${record.id}: unknown source ${record.source}`);
    continue;
  }

  if (!paragraphsOfSource) continue;

  if (record.text.split("\n").some((line) => line !== squash(line)) || quoteId(record.source, record.text) !== record.id) problems.push(`${record.id}: id or spacing does not match the text`);
  else if (ids.has(record.id)) problems.push(`${record.id}: listed twice`);
  else if (!paragraphsOfSource.some((paragraph) => paragraph.includes(record.text))) problems.push(`${record.id}: not found word for word in pg${record.source}`);
  else {
    ids.add(record.id);
    quotes.push(Quote.parse({
      ...record,
      author: source.author,
      work: source.work,
      translator: source.translator,
      tradition: source.tradition,
      era: source.era,
      tags: source.tags,
      links: { book: `https://www.gutenberg.org/ebooks/${source.id}`, text: `https://www.gutenberg.org/cache/epub/${source.id}/pg${source.id}-images.html${textFragment(record.text, source.verse)}` },
    }));
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

await writeFile(quotesPath, [...quotes].sort((a, b) => a.id.localeCompare(b.id)).map((quote) => JSON.stringify(quote)).join("\n") + (quotes.length > 0 ? "\n" : ""));

console.log(`${quotes.length} quotes verified and written`);
