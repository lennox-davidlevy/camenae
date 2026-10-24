import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { Approved, LorePage, LoreQuote } from "./schema.js";
import { approvedFor, lexiconDirectory, lexiconPagesPath, lorePath, privateDirectory } from "./paths.js";
import { pageText } from "./lore.js";
import { quoteId, squash, textFragment } from "./text.js";

// Builds data/private/quotes-40k.jsonl from the approved Games Workshop quotes and refuses any
// that is not word for word on the saved page it came from. The output is private (gitignored).
//   bun tools/quotes/lore-build.ts
const pages = LorePage.array().parse(JSON.parse(await readFile(lexiconPagesPath, "utf8")));

const files = (await readdir(lexiconDirectory).catch(() => [])).filter((name) => name.endsWith(".html"));

const texts = new Map<number, string>();

for (const entry of pages) {
  for (const file of files) {
    const html = await readFile(`${lexiconDirectory}/${file}`, "utf8");

    if (html.includes(`"wgPageName":"${entry.page}"`)) {
      texts.set(entry.id, pageText(html));
      break;
    }
  }
}

const approved = (await readFile(approvedFor(900001), "utf8").catch(() => "")).split("\n").filter((line) => line !== "").map((line) => Approved.parse(JSON.parse(line)));

const problems: string[] = [];

const quotes: LoreQuote[] = [];

const ids = new Set<string>();

for (const record of approved) {
  const entry = pages.find((page) => page.id === record.source);
  const page = texts.get(record.source);

  if (!entry || page === undefined) {
    problems.push(`${record.id}: saved page ${record.source} is missing`);
    continue;
  }

  const flat = squash(record.text.replaceAll("\n", " "));
  const [speaker = "", ...referenceParts] = record.locator.split(" | ");

  if (quoteId(record.source, flat) !== record.id) problems.push(`${record.id}: id does not match the text`);
  else if (ids.has(record.id)) problems.push(`${record.id}: listed twice`);
  else if (!page.includes(flat)) problems.push(`${record.id}: not word for word on ${entry.page}`);
  else {
    ids.add(record.id);
    quotes.push(LoreQuote.parse({
      id: record.id,
      text: record.text,
      speaker: speaker.trim(),
      reference: referenceParts.join(" | ").trim().slice(0, 240),
      category: entry.category,
      tradition: "40k",
      themes: record.themes,
      links: { page: `https://wh40k.lexicanum.com/wiki/${entry.page}${textFragment(record.text, false)}` },
    }));
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

await mkdir(privateDirectory, { recursive: true });

await writeFile(lorePath, [...quotes].sort((a, b) => a.id.localeCompare(b.id)).map((quote) => JSON.stringify(quote)).join("\n") + "\n");

console.log(`${quotes.length} 40k quotes verified and written to data/private/quotes-40k.jsonl`);
