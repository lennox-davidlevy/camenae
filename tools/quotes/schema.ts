import { z } from "zod";

export const Tradition = z.enum(["rome", "greece", "other"]);

// One Project Gutenberg edition we are allowed to quote from.
export const Source = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  author: z.string().min(1),
  work: z.string().min(1),
  translator: z.string().optional(),
  tradition: Tradition,
  era: z.string().min(1),
  tags: z.array(z.string()).default([]),
  // false when one file holds several works, so the nearest heading would mislead.
  locators: z.boolean().default(true),
  // Poetry: lines are kept, and passages are whole sentences of two to four lines.
  verse: z.boolean().default(false),
});

export type Source = z.infer<typeof Source>;

export const Sources = z.array(Source).min(1);

// sha256 of each downloaded file as it was when sources.lock.json was written.
export const Lock = z.array(z.object({ id: z.number().int().positive(), sha256: z.string().length(64), title: z.string(), retrieved: z.string() }));

export type Lock = z.infer<typeof Lock>;

// What a reviewer approved: a verbatim passage and where it came from.
export const Approved = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  source: z.number().int().positive(),
  locator: z.string(),
  text: z.string().min(20).max(400),
  themes: z.array(z.string().regex(/^[a-z-]+$/)).min(1),
});

export type Approved = z.infer<typeof Approved>;

export const Candidate = Approved.omit({ themes: true }).extend({ score: z.number() });

export type Candidate = z.infer<typeof Candidate>;

// The generated, app-facing record. Text is exactly as printed in the edition.
export const Quote = Approved.extend({
  author: z.string(),
  work: z.string(),
  translator: z.string().optional(),
  tradition: Tradition,
  era: z.string(),
  tags: z.array(z.string()),
  links: z.object({ book: z.url(), text: z.url() }),
});

export type Quote = z.infer<typeof Quote>;

// A saved Lexicanum page that quotes are read from.
export const LorePage = z.object({ id: z.number().int().min(900001), page: z.string().regex(/^[A-Za-z0-9_-]+$/), category: z.string() });

export type LorePage = z.infer<typeof LorePage>;

// App-facing record for Games Workshop quotes. Private: never written to the committed dataset.
export const LoreQuote = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  text: z.string().min(20).max(400),
  speaker: z.string(),
  reference: z.string(),
  category: z.string(),
  tradition: z.literal("40k"),
  themes: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  links: z.object({ page: z.url() }),
});

export type LoreQuote = z.infer<typeof LoreQuote>;
