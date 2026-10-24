import { squash } from "./text.js";

const entities: ReadonlyMap<string, string> = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"], ["nbsp", " "], ["ndash", "–"], ["mdash", "—"], ["hellip", "…"], ["lsquo", "‘"], ["rsquo", "’"], ["ldquo", "“"], ["rdquo", "”"]]);

const decode = (text: string) => text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
  if (decimal) return String.fromCodePoint(Number(decimal));

  if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));

  return entities.get((name ?? "").toLowerCase()) ?? whole;
});

// A fragment of the saved page as lines of text: footnote marks dropped, <br> as a line break.
export function cellLines(fragment: string) {
  const withoutNotes = fragment.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/\[\d+[a-z]?\]/g, "");
  const lined = withoutNotes.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "");

  return decode(lined).split("\n").map(squash).filter((line) => line !== "");
}

// The whole page as one run of text, for checking a quote really is on it.
export const pageText = (html: string) => squash(cellLines(html.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, "").replace(/\n/g, " ")).join(" "));

export interface LoreRow {
  text: string;
  speaker: string;
  reference: string;
}

const labels = new Set(["quote", "quotes", "speaker", "tome", "notes", "source", "text", "from", "attribution", "reference"]);

const attribution = /^[-–—]\s*/;

// Rows of every table: the bold (else the longest) cell is the quote; other cells say who and where.
export function loreRows(html: string) {
  const rows: LoreRow[] = [];

  for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1] ?? "");

    if (cells.length === 0) continue;
    const texts = cells.map((cell) => cellLines(cell));

    if (texts.every((lines) => lines.length === 1 && labels.has((lines[0] ?? "").toLowerCase()))) continue;
    let quoteIndex = cells.findIndex((cell) => /<b>[\s\S]{20,}?<\/b>/i.test(cell));

    if (quoteIndex === -1) {
      let longest = -1;

      texts.forEach((lines, index) => {
        const length = lines.join(" ").length;

        if (length > longest) {
          longest = length;
          quoteIndex = index;
        }
      });
    }

    const quoteCell = cells[quoteIndex] ?? "";
    const bold = /<b>([\s\S]*?)<\/b>/i.exec(quoteCell);
    const quoteLines = bold ? cellLines(bold[1] ?? "") : cellLines(quoteCell);
    // "- page 1" or "- after dispatching…" printed after the quote in the same cell.
    const trailing = bold ? cellLines(quoteCell.replace(/<b>[\s\S]*?<\/b>/i, "")).map((line) => line.replace(attribution, "")) : [];
    const own = bold ? [] : quoteLines.filter((line) => attribution.test(line)).map((line) => line.replace(attribution, ""));
    const text = (bold ? quoteLines : quoteLines.filter((line) => !attribution.test(line))).join("\n");
    const others = texts.flatMap((lines, index) => index === quoteIndex || lines.length === 0 ? [] : [lines.join(" ")]);
    const speaker = quoteIndex > 0 ? others[0] ?? "" : "";
    const rest = quoteIndex > 0 ? others.slice(1) : others;

    rows.push({ text, speaker, reference: [...rest, ...trailing, ...own].filter((value) => value !== "").join(" · ") });
  }

  return rows;
}
