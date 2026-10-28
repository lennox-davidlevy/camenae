import type { Candidate, Source } from "./schema.js";
import { bookBody, paragraphs, quoteId, sentences, squash, stanzas, withoutHeading, withoutNumeral, withoutSpeaker } from "./text.js";

const minimum = 70;

const maximum = 260;

// Openings that lean on a sentence before them.
const dependent = /^(?:He|She|It|They|We|You|His|Her|Its|Their|Our|This|That|These|Those|Such|But|And|Or|Nor|Yet|So|Then|Thus|Therefore|Hence|Whereupon|There|Here|When|While|Now|Also|Again|However|Moreover|Furthermore|Accordingly|Wherefore|Next|After|Before|Afterwards)\b/;

// Words that tend to mark a general truth rather than a story.
const themes = /\b(?:life|death|man|men|mankind|virtue|virtues|soul|wise|wisdom|fortune|nature|time|mind|good|evil|duty|courage|fear|war|glory|truth|justice|friend|friends|friendship|happy|happiness|freedom|power|fate|honour|honor|reason|anger|pleasure|pain|hope|peace|victory|defeat|judgment|opinion|habit|character|excellence|cowardice|enemy|enemies)\b/gi;

const narrative = /\b(?:was|were|had|said|replied|answered|cried|went|came|took|saw|asked|exclaimed|began|rose|fell)\b/gi;

const general = /\b(?:is|are|be|being|will|shall|should|ought|must|can|cannot|never|always|every|all|no one|nothing|whoever)\b/gi;

const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

// Names and places make a passage depend on its story; a few are fine.
const properNouns = (text: string) => count(text.replace(/^["“‘']?[A-Z]/, "x"), /(?<=[a-z,;:] )[A-Z][a-z]+/g);

const clean = (text: string) => !/[_[\]{}<>*|\\0-9]/.test(text) && !/["“”]/.test(text) && !/\bI\b/.test(text.slice(0, 3));

const score = (text: string) => count(text, themes) * 2 + count(text, general) - count(text, narrative) * 3 - properNouns(text) * 2 + (text.length < 180 ? 2 : 0) + (/[.!]$/.test(text) ? 1 : 0);

// Translators' and editors' own writing is not the author's.
const editorial = /introduction|analysis|preface|notes|appendix|contents|biograph|the man and his works|castruccio|the argument/i;

const sentenceEnd = /[.!?]$/;

// Whole sentences of two to four consecutive lines: each starts a stanza or follows a line that ended one.
function verseWindows(stanza: string) {
  const lines = stanza.split("\n");
  const windows: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (index > 0 && !sentenceEnd.test(lines[index - 1] ?? "")) continue;

    for (let length = 2; length <= 4; length++) {
      const window = lines.slice(index, index + length);

      if (window.length === length && sentenceEnd.test(window[length - 1] ?? "")) windows.push(window.join("\n"));
    }
  }

  return windows;
}

// Every passage of an edition that passes the filters, best first. Heuristic, deliberately plain.
export function extract(source: Source, raw: string) {
  const seen = new Set<string>();
  const found: Candidate[] = [];

  if (source.verse) {
    for (const stanza of stanzas(bookBody(raw))) {
      if (editorial.test(stanza.locator)) continue;

      for (const text of verseWindows(stanza.text)) {
        if (text.length < minimum || text.length > maximum + 60 || !/^[A-Z]/.test(text) || dependent.test(text) || !clean(text) || properNouns(text) > 3 || seen.has(text)) continue;
        seen.add(text);
        found.push({ id: quoteId(source.id, text), source: source.id, locator: source.locators ? stanza.locator : "", text, score: score(text) });
      }
    }

    return [...found].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  for (const paragraph of paragraphs(bookBody(raw))) {
    if (editorial.test(paragraph.locator)) continue;
    const parts = sentences(withoutSpeaker(withoutHeading(withoutNumeral(paragraph.text)))).map(withoutNumeral);

    // One sentence, or two when the second completes the thought.
    for (let index = 0; index < parts.length; index++) {
      for (const length of [1, 2]) {
        const text = squash(parts.slice(index, index + length).join(" "));

        if (text.length < minimum || text.length > maximum || !/^[A-Z]/.test(text) || dependent.test(text) || !/[.!?]$/.test(text)) continue;

        if (!clean(text) || properNouns(text) > 2 || seen.has(text)) continue;
        seen.add(text);
        found.push({ id: quoteId(source.id, text), source: source.id, locator: source.locators ? paragraph.locator : "", text, score: score(text) });
      }
    }
  }

  return [...found].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
