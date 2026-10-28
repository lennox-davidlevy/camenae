import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { Approved, Candidate, Sources } from "./schema.js";
import { extract } from "./extract.js";
import { approvedFor, approvedPath, cacheDirectory, candidatesPath, dataDirectory, privateDirectory, rejectedFor, rejectedPath, sourcesPath, textPath } from "./paths.js";

// Human (or reviewing agent) selection from the proposed candidates.
//   bun tools/quotes/curate.ts review <source-id> [--limit 40]
//       prints the best undecided candidates as a numbered batch
//   bun tools/quotes/curate.ts find <source-id> <words...>
//       searches the whole book (not just the top candidates) for passages containing the words
//   bun tools/quotes/curate.ts decide 3:courage,fortune 7:death [--reject-rest]
//       approves numbers from the last batch with themes; --reject-rest rejects the others
// Approved quotes land in data/quotes/approved.jsonl, rejected ids in rejected.txt.
// Games Workshop pages (ids from 900001) use data/private/ instead; see lexicanum.ts.
const batchPath = `${cacheDirectory}/batch.json`;

const Batch = z.array(Candidate);

const lines = async (path: string) => (await readFile(path, "utf8").catch(() => "")).split("\n").filter((line) => line !== "");

// Ids already approved or rejected, in the committed and the private lists.
const decided = async () => {
  const approved = [approvedPath, approvedFor(900000)];
  const rejected = [rejectedPath, rejectedFor(900000)];
  const ids = new Set<string>();

  for (const path of approved) for (const line of await lines(path)) ids.add(Approved.parse(JSON.parse(line)).id);

  for (const path of rejected) for (const line of await lines(path)) ids.add(line);

  return ids;
};

// Keyword-based themes for a bare "n" in decide; a reviewer can always spell them out.
const keywordThemes: readonly (readonly [string, RegExp])[] = [
  ["emperor", /\bEmperor/i], ["hate", /\bhate|\bhatred|\babhor|\bloath/i], ["heretics", /\bheret|\btraitor|\bblasphem/i],
  ["aliens", /\balien|\bxeno/i], ["mutants", /\bmutant/i], ["death", /\bdeath|\bdie\b|\bdead|\bdying/i],
  ["faith", /\bfaith|\bpray|\bsoul|\bblessed/i], ["duty", /\bduty|\bservice|\bobey|\bobedien/i], ["war", /\bwar\b|\bbattle|\bfight|\benem/i],
  ["mercy", /\bmerc|\bpity|\bremorse/i], ["courage", /\bcourage|\bbrave|\bfear/i], ["glory", /\bglor|\bvictor|\bhonou?r/i],
];

const guessThemes = (text: string) => {
  const found = keywordThemes.flatMap(([name, pattern]) => pattern.test(text) ? [name] : []).slice(0, 3);

  return found.length > 0 ? found : ["grimdark"];
};

const [command, ...rest] = process.argv.slice(2);

await mkdir(dataDirectory, { recursive: true });

await mkdir(privateDirectory, { recursive: true });

if (command === "review") {
  const source = Number(rest[0]);
  const limitIndex = rest.indexOf("--limit");
  const limit = limitIndex === -1 ? 40 : Number(rest[limitIndex + 1]);
  const done = await decided();
  const batch: Candidate[] = [];

  for (const line of await lines(candidatesPath(source))) {
    const candidate = Candidate.parse(JSON.parse(line));

    if (!done.has(candidate.id) && batch.length < limit) batch.push(candidate);
  }

  await writeFile(batchPath, JSON.stringify(batch));

  batch.forEach((candidate, index) => console.log(`${index + 1} [${candidate.locator}] ${candidate.text.replaceAll("\n", " / ")}`));
  console.log(`-- ${batch.length} shown; ${done.size} decided overall`);
} else if (command === "find") {
  const source = Sources.parse(JSON.parse(await readFile(sourcesPath, "utf8"))).find((entry) => entry.id === Number(rest[0]));
  const words = rest.slice(1).map((word) => word.toLowerCase());

  if (!source || words.length === 0) throw new Error("Usage: curate.ts find <source-id> <words...>");
  const done = await decided();
  const batch = extract(source, await readFile(textPath(source.id), "utf8")).filter((candidate) => !done.has(candidate.id) && words.every((word) => candidate.text.toLowerCase().includes(word))).slice(0, 25);

  await writeFile(batchPath, JSON.stringify(batch));

  batch.forEach((candidate, index) => console.log(`${index + 1} [${candidate.locator}] ${candidate.text.replaceAll("\n", " / ")}`));
  console.log(`-- ${batch.length} found`);
} else if (command === "decide") {
  const batch = Batch.parse(JSON.parse(await readFile(batchPath, "utf8")));
  const chosen = new Map<number, string[]>();

  for (const argument of rest.filter((value) => value !== "--reject-rest")) {
    const [number, themes] = argument.split(":");
    const index = Number(number);
    const candidate = batch[index - 1];

    if (!Number.isInteger(index) || !candidate) throw new Error(`Bad decision "${argument}", expected number[:theme,theme]`);
    // A bare number takes themes from the words in the passage.
    chosen.set(index, themes ? themes.split(",") : guessThemes(candidate.text));
  }

  let approved = 0;
  const rejects: Candidate[] = [];

  for (const [position, candidate] of batch.entries()) {
    const themes = chosen.get(position + 1);

    if (themes) {
      const record = Approved.parse({ id: candidate.id, source: candidate.source, locator: candidate.locator, text: candidate.text, themes });
      await appendFile(approvedFor(record.source), `${JSON.stringify(record)}\n`);
      approved += 1;
    } else if (rest.includes("--reject-rest")) rejects.push(candidate);
  }

  for (const rejected of rejects) await appendFile(rejectedFor(rejected.source), `${rejected.id}\n`);
  console.log(`approved ${approved}, rejected ${rejects.length}`);
} else {
  throw new Error("Usage: curate.ts review <source-id> [--limit N] | find <source-id> <words...> | decide <n:theme,theme>... [--reject-rest]");
}
