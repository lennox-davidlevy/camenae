import { createHash } from "node:crypto";

const startMarker = /^[ \t]*\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*$/m;

const endMarker = /^[ \t]*\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*$/m;

export interface Paragraph {
  text: string;
  locator: string;
}

// The book itself, without the Project Gutenberg licence and header.
export function bookBody(raw: string) {
  const text = raw.replace(/^﻿/, "").replaceAll("\r\n", "\n");
  const start = startMarker.exec(text);
  const end = endMarker.exec(text);

  if (!start || !end || end.index <= start.index) throw new Error("Project Gutenberg markers not found");

  return text.slice(start.index + start[0].length, end.index);
}

// "Title: …" lines from the header, for checking we fetched the book we meant to.
export function headerField(raw: string, field: string) {
  const match = new RegExp(`^${field}:\\s*(.+)$`, "mi").exec(raw.slice(0, 4000));

  return match?.[1]?.trim() ?? "";
}

// "XXVII. To stir…": the printed section number is not part of the sentence.
export const withoutNumeral = (text: string) => text.replace(/^[IVXLCDM]+\.(?:-{1,2}|\s)\s*(?=[A-Z])/, "");

// "ON CONSTANCY (OR FIRMNESS).—The being of the good…": a run-in chapter title before the prose.
export const withoutHeading = (text: string) => text.replace(/^[A-Z][A-Z0-9 ,'’()\-:;]{8,}\.—\s*/, "");

// "Melians. But we know…": a speaker label in a dialogue.
export const withoutSpeaker = (text: string) => text.replace(/^(?:Melians|Athenians|Corinthians|Syracusans|Lacedaemonians|Plataeans|Thebans)\.\s+(?=[A-Z])/, "");

export const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const headingWords = /^(?:the \w+ book|book|chapter|letter|canto|part|section|act|scene|discourse|fragment|volume|preface|introduction)\b/i;

const majorHeading = /\b(?:book|part|volume|canto)\b/i;

const roman = /^[IVXLCDM]+\.?$/;

// A short line standing alone: a book or chapter title rather than prose.
export function isHeading(line: string) {
  const text = squash(line);

  if (text.length === 0 || text.length > 70 || /[a-z]{4,}.*[.!?]$/.test(text)) return false;

  return headingWords.test(text) || roman.test(text) || (text === text.toUpperCase() && /[A-Z]{3}/.test(text));
}

// Verse stanzas: blocks whose lines keep their breaks, without the printed indentation.
export function stanzas(body: string) {
  return blocks(body, (block) => block.split("\n").map(squash).filter((line) => line !== "").join("\n"));
}

// Prose paragraphs, each unwrapped to one line and tagged with the nearest heading above it.
export function paragraphs(body: string) {
  return blocks(body, squash);
}

function blocks(body: string, render: (block: string) => string) {
  const found: Paragraph[] = [];
  let locator = "";
  let part = "";
  let summary = false;

  // A blank line may carry stray spaces; it still ends the block.
  for (const block of body.replace(/[ \t]+$/gm, "").split(/\n{2,}/)) {
    const text = render(block);

    if (text === "") continue;

    if (summary) {
      summary = false;
      continue;
    }

    if (isHeading(squash(text))) {
      // "THE ARGUMENT." introduces an editor's summary of the book, not the book.
      if (/^the argument\b/i.test(squash(text))) {
        summary = true;
        continue;
      }

      // A new book replaces the locator; a chapter heading is shown within its book.
      if (majorHeading.test(text)) {
        part = squash(text);
        locator = part;
      } else locator = [part, squash(text)].filter(Boolean).join(", ");

      continue;
    }

    found.push({ text, locator });
  }

  return found;
}

const abbreviation = /\b(?:Mr|Mrs|Dr|St|Mt|vs|viz|cf|No|Gen|Capt|i\.e|e\.g)\.$/;

// Sentences of one paragraph, in order. Splits after . ! ? and an optional closing quote.
export function sentences(paragraph: string) {
  const pieces = paragraph.split(/(?<=[.!?]["”’']?)\s+(?=["“‘']?[A-Z])/);
  const joined: string[] = [];

  for (const piece of pieces) {
    const previous = joined.at(-1);

    if (previous !== undefined && abbreviation.test(previous)) joined[joined.length - 1] = `${previous} ${piece}`;
    else joined.push(piece);
  }

  return joined;
}

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

// Stable across runs: the same passage from the same edition always has the same id.
export const quoteId = (source: number, text: string) => sha256(`${source}\n${squash(text)}`).slice(0, 12);

const plain = (word: string) => /^[A-Za-z]+$/.test(word);

// Up to five consecutive plain words from one end of the passage, for a browser text fragment.
const run = (words: readonly string[], fromEnd: boolean) => {
  const ordered = fromEnd ? [...words].reverse() : words;

  for (let start = 0; start + 4 <= ordered.length; start++) {
    const slice = ordered.slice(start, start + 5);

    if (slice.every(plain)) return (fromEnd ? [...slice].reverse() : slice).join(" ");
  }

  return "";
};

// "#:~:text=…" so a browser scrolls to and highlights the passage; "" when no run of plain words exists.
// Verse lines are separate elements in the HTML, so only the opening words are used there.
export function textFragment(text: string, firstLineOnly: boolean) {
  const words = (firstLineOnly ? text.split("\n")[0] ?? "" : text).replaceAll("\n", " ").split(" ");
  const start = run(words, false);
  const end = firstLineOnly ? "" : run(words, true);

  if (!start) return "";

  return start === end || !end ? `#:~:text=${encodeURIComponent(start)}` : `#:~:text=${encodeURIComponent(start)},${encodeURIComponent(end)}`;
}
