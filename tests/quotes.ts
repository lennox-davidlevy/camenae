import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LoreQuote, Quote, Sources } from "../tools/quotes/schema.js";
import { cellLines, loreRows, pageText } from "../tools/quotes/lore.js";
import { bookBody, headerField, paragraphs, quoteId, sentences, squash, withoutHeading, withoutNumeral, withoutSpeaker } from "../tools/quotes/text.js";
import { lorePath, quotesPath, sourcesPath } from "../tools/quotes/paths.js";

const raw = [
  "Title: A Book", "Translator: Jane Doe", "", "*** START OF THE PROJECT GUTENBERG EBOOK A BOOK ***", "",
  "THE FIRST BOOK", "", "I.", "", "Dr. Smith said so. Nothing is\nmore certain than change.", "",
  "  *** END OF THE PROJECT GUTENBERG EBOOK A BOOK ***", "Licence text",
].join("\n");

assert.equal(headerField(raw, "Translator"), "Jane Doe");

assert.ok(!bookBody(raw).includes("Licence") && !bookBody(raw).includes("Title:"));

assert.throws(() => bookBody("no markers"));

// Prose is unwrapped and tagged with the nearest heading.
const found = paragraphs(bookBody(raw));

assert.equal(found.length, 1);

assert.equal(found[0]?.text, "Dr. Smith said so. Nothing is more certain than change.");

assert.equal(found[0]?.locator, "THE FIRST BOOK, I.");

// "Dr." is not a sentence end.
assert.deepEqual(sentences(found[0]?.text ?? ""), ["Dr. Smith said so.", "Nothing is more certain than change."]);

// Printed section numbers, run-in chapter titles, and speaker labels are not part of a sentence.
assert.equal(withoutNumeral("XXVII. To stir up a man."), "To stir up a man.");

assert.equal(withoutNumeral("XIV.--But the enemy."), "But the enemy.");

assert.equal(withoutHeading("ON CONSTANCY (OR FIRMNESS).—The being of the good."), "The being of the good.");

assert.equal(withoutSpeaker("Melians. We know that."), "We know that.");

assert.equal(quoteId(1, "Same  text."), quoteId(1, "Same text."));

assert.notEqual(quoteId(1, "Same text."), quoteId(2, "Same text."));

// The committed dataset: every record is valid, unique, spaced as printed, and tied to a listed edition.
const sources = Sources.parse(JSON.parse(await readFile(sourcesPath, "utf8")));

const lines = (await readFile(quotesPath, "utf8")).split("\n").filter((line) => line !== "");

const ids = new Set<string>();

for (const line of lines) {
  const quote = Quote.parse(JSON.parse(line));
  assert.ok(!ids.has(quote.id), `duplicate ${quote.id}`);
  ids.add(quote.id);
  assert.deepEqual(quote.text.split("\n"), quote.text.split("\n").map(squash));
  assert.equal(quote.id, quoteId(quote.source, quote.text));
  assert.ok(sources.some((source) => source.id === quote.source), `unlisted source ${quote.source}`);
  assert.ok(quote.links.book.startsWith("https://www.gutenberg.org/ebooks/") && quote.links.text.startsWith("https://www.gutenberg.org/cache/epub/"));
}

assert.ok(lines.length > 0, "no quotes");

// Lexicanum rows: bold or longest cell is the quote, footnote marks are dropped, <br> breaks lines.
const sample = [
  "<table><tr><td>Speaker</td><td>Quote</td></tr>",
  "<tr><td><i>Codex Imperialis</i></td><td><i><b>Hate! Hate!<br />Let it flow, let it run free!</b><br />- page 1</i><sup id=\"fn_3\"><a href=\"#fn_3\">[3a]</a></sup></td></tr>",
  "<tr><td><i><b>Blessed is the mind too small for doubt.</b></i></td><td>Ancient proverb<sup>[1]</sup></td></tr></table>",
].join("\n");

assert.deepEqual(cellLines("A&amp;B<br/>C <sup>[4]</sup>"), ["A&B", "C"]);

assert.deepEqual(loreRows(sample), [
  { text: "Hate! Hate!\nLet it flow, let it run free!", speaker: "Codex Imperialis", reference: "page 1" },
  { text: "Blessed is the mind too small for doubt.", speaker: "", reference: "Ancient proverb" },
]);

assert.ok(pageText(sample).includes("Hate! Hate! Let it flow, let it run free!"));

// The private Games Workshop dataset is not committed; check it only where it exists.
const lore = (await readFile(lorePath, "utf8").catch(() => "")).split("\n").filter((line) => line !== "");

for (const line of lore) {
  const quote = LoreQuote.parse(JSON.parse(line));
  assert.ok(quote.links.page.startsWith("https://wh40k.lexicanum.com/wiki/"));
}

console.log(`quotes tests passed (${lines.length} quotes, ${lore.length} private)`);
