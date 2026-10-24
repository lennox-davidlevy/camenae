import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

// Downloaded texts and review candidates: reproducible, never committed.
export const cacheDirectory = join(root, ".cache", "quotes");

// Curated records and the generated dataset: committed.
export const dataDirectory = join(root, "data", "quotes");

export const sourcesPath = join(import.meta.dir, "sources.json");

export const lockPath = join(dataDirectory, "sources.lock.json");

export const approvedPath = join(dataDirectory, "approved.jsonl");

export const rejectedPath = join(dataDirectory, "rejected.txt");

export const quotesPath = join(dataDirectory, "quotes.jsonl");

export const textPath = (id: number) => join(cacheDirectory, `pg${id}.txt`);

export const candidatesPath = (id: number) => join(cacheDirectory, "candidates", `pg${id}.jsonl`);

// Games Workshop text from a fan wiki: kept out of the committed dataset.
export const privateDirectory = join(root, "data", "private");

export const lexiconDirectory = join(cacheDirectory, "lexicanum");

export const lexiconPagesPath = join(import.meta.dir, "lexicanum-pages.json");

export const lorePath = join(privateDirectory, "quotes-40k.jsonl");

// Pseudo-source ids from 900001 stand for saved wiki pages.
export const isPrivateSource = (source: number) => source >= 900000;

export const approvedFor = (source: number) => isPrivateSource(source) ? join(privateDirectory, "approved-40k.jsonl") : approvedPath;

export const rejectedFor = (source: number) => isPrivateSource(source) ? join(privateDirectory, "rejected-40k.txt") : rejectedPath;
