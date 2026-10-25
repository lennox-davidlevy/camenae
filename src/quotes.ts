import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { WelcomeQuote } from "./quotes-contract.js";

// Reads the datasets built by tools/quotes. Only the fields shown are required here; the
// pipeline's own schema is the authority on the rest.
const Antiquity = z.object({ text: z.string(), author: z.string(), work: z.string(), translator: z.string().optional(), links: z.object({ text: z.url() }) });

const Lore = z.object({ text: z.string(), speaker: z.string(), reference: z.string(), category: z.string(), links: z.object({ page: z.url() }) });

// One pick in this many comes from the private Warhammer 40,000 set, when it exists.
// That set is much larger, so without a weight it would crowd out everything else.
export const loreShare = 1 / 3;

const records = async (path: string) => (await readFile(path, "utf8").catch(() => "")).split("\n").filter((line) => line !== "");

export interface QuoteSets {
  antiquity: readonly WelcomeQuote[];
  lore: readonly WelcomeQuote[];
}

// Missing files are normal: the private set is not part of the repository.
export async function readQuotes(dataDirectory: string): Promise<QuoteSets> {
  const antiquity: WelcomeQuote[] = [];
  const lore: WelcomeQuote[] = [];

  for (const line of await records(join(dataDirectory, "quotes", "quotes.jsonl"))) {
    const record = Antiquity.safeParse(JSON.parse(line));

    if (record.success) antiquity.push({ text: record.data.text, attribution: record.data.author, source: record.data.translator ? `${record.data.work} · trans. ${record.data.translator}` : record.data.work, href: record.data.links.text, kind: "antiquity" });
  }

  for (const line of await records(join(dataDirectory, "private", "quotes-40k.jsonl"))) {
    const record = Lore.safeParse(JSON.parse(line));

    if (record.success) lore.push({ text: record.data.text, attribution: record.data.speaker || record.data.category, source: record.data.reference.split(" · ")[0] || record.data.category, href: record.data.links.page, kind: "lore" });
  }

  return { antiquity, lore };
}

const at = (list: readonly WelcomeQuote[], random: number): WelcomeQuote | undefined => list[Math.min(list.length - 1, Math.floor(random * list.length))];

// `random` is a function so callers (and tests) control randomness: two draws, which set then which quote.
export function pickQuote(sets: QuoteSets, random: () => number): WelcomeQuote | undefined {
  const useLore = sets.lore.length > 0 && (sets.antiquity.length === 0 || random() < loreShare);

  return at(useLore ? sets.lore : sets.antiquity, random());
}
