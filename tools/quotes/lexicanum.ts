import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Candidate } from "./schema.js";
import { LorePage } from "./schema.js";
import { candidatesPath, lexiconDirectory, lexiconPagesPath } from "./paths.js";
import { loreRows } from "./lore.js";
import { quoteId } from "./text.js";

// Reads Lexicanum quote pages you saved from your own browser into .cache/quotes/lexicanum/
// and proposes candidates for review. Nothing is fetched from the site.
//   bun tools/quotes/lexicanum.ts
const pages = LorePage.array().parse(JSON.parse(await readFile(lexiconPagesPath, "utf8")));

const files = await readdir(lexiconDirectory).catch(() => []);

const minimum = 25;

const maximum = 360;

// Words that mark the voice we are after: faith, wrath, duty, contempt for the enemy.
const flavour = /\b(?:Emperor|Emperor's|Imperium|heretic|heresy|xenos|alien|mutant|traitor|faith|duty|purge|burn|death|die|blood|war|enemy|enemies|victory|fear|wrath|sacrifice|glory|blessed|damned|soul|honour|honor|courage|steel|fury|hate|kill|slay|mercy|pain|service|loyal|oath|vow|flesh|machine|Omnissiah|Throne|Chaos|Daemon|Machine)\b/gi;

const score = (text: string) => ([...text.matchAll(flavour)].length * 2) + (text.endsWith("!") ? 2 : 0) + (text.length < 160 ? 3 : text.length < 240 ? 1 : -2);

const seen = new Set<string>();

for (const entry of pages) {
  // Saved pages are named after their title; find the file by the embedded page name.
  let html = "";

  for (const file of files.filter((name) => name.endsWith(".html"))) {
    const content = await readFile(`${lexiconDirectory}/${file}`, "utf8");

    if (content.includes(`"wgPageName":"${entry.page}"`)) {
      html = content;
      break;
    }
  }

  if (html === "") {
    console.error(`${entry.page}: no saved page found`);
    continue;
  }

  const found: Candidate[] = [];

  for (const row of loreRows(html)) {
    const flat = row.text.replaceAll("\n", " ");

    if (flat.length < minimum || flat.length > maximum) continue;
    const key = quoteId(0, flat);

    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ id: quoteId(entry.id, flat), source: entry.id, locator: [row.speaker, row.reference].join(" | "), text: row.text, score: score(flat) });
  }

  const ordered = [...found].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  await mkdir(dirname(candidatesPath(entry.id)), { recursive: true });
  await writeFile(candidatesPath(entry.id), ordered.map((candidate) => JSON.stringify(candidate)).join("\n") + "\n");
  console.log(`${entry.page}: ${ordered.length} candidates`);
}
