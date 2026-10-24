# Quotes pipeline

An offline pipeline that builds a dataset of short quotations from antiquity, each tied to
a pinned [Project Gutenberg](https://www.gutenberg.org) edition. It is not part of the
application, is not in any Docker image, and makes no model calls. The welcome and
sign-in screens are expected to read its output later; nothing in the app does yet.

## Rule

A quote is only ever copied from a downloaded edition. Nothing is written from memory.
`build.ts` re-checks every approved quote word for word against the pinned file and
fails the build if one is not found, so a misremembered or altered quote cannot ship.

## Stages

```sh
bun run quotes:fetch        # download listed editions (3 s apart), verify titles, write the lock
bun run quotes:candidates   # propose passages per work into .cache/quotes/candidates/
bun tools/quotes/curate.ts review <source-id> [--limit 40]   # a numbered batch of undecided candidates
bun tools/quotes/curate.ts find <source-id> <words...>       # search a whole book, not just the top candidates
bun tools/quotes/curate.ts decide 3:courage,fortune 7:death --reject-rest
bun run quotes:build        # verify and write data/quotes/quotes.jsonl
bun run test:quotes
```

- `sources.json` lists the editions: Gutenberg id, expected title, author, work, translator
  (copied from the file's own header, never assumed), tradition (`rome`, `greece`, `other`),
  era, tags. Add `"verse": true` for poetry and `"locators": false` when one file holds
  several works.
- `data/quotes/sources.lock.json` records each file's SHA-256. A changed download fails
  until it is accepted with `quotes:fetch -- --update`.
- Candidates are a heuristic filter (one or two sentences, self-contained, general rather
  than narrative, not the translator's introduction). A reviewer approves from them.
  Selection is a judgement call; it is recorded in `data/quotes/approved.jsonl` with themes,
  and rejected ids in `rejected.txt` so a passage is not reviewed twice.

## Dataset

`data/quotes/quotes.jsonl` is generated, one JSON object per line, sorted by id:

| Field | Meaning |
| --- | --- |
| `id` | 12 hex characters from the edition id and the text; stable across rebuilds |
| `text` | Exactly as printed in the edition (verse keeps its line breaks as `\n`; `--` is not converted) |
| `author`, `work`, `translator`, `era`, `tradition`, `tags` | From `sources.json` |
| `locator` | Nearest book or chapter heading; empty when the file mixes works |
| `themes` | Reviewer-chosen lowercase tags |
| `links.book` | The Gutenberg catalogue page |
| `links.text` | The HTML edition with a text-fragment that highlights the passage where the browser supports it; the plain page otherwise |

New quotes append; ids never change for existing text. It is meant to grow to thousands
of lines. When the app reads it, import it into a table keyed by `id` rather than loading
the file at request time.

## Warhammer 40,000 quotes (private)

A second, separate dataset holds Imperium quotes from the Warhammer 40,000 wiki
(Lexicanum). The text belongs to Games Workshop, so it is **never committed or exported**:
everything lives under `data/private/` (gitignored) and `.cache/` (gitignored).

- Nothing is fetched. Lexicanum blocks automated clients, so you save its quote pages from
  your own browser into `.cache/quotes/lexicanum/` (Save As, "Webpage, HTML only"). The pages
  used are listed in `lexicanum-pages.json`; each is matched by the page name saved inside the file.
- `bun run quotes:lore` parses the saved pages into candidates, `curate.ts` works as above
  (a bare `n` takes themes from keywords), and `bun run quotes:build-lore` checks every approved
  quote word for word against its saved page and writes `data/private/quotes-40k.jsonl`.
- Records carry `speaker`, `reference` (book and page as the wiki lists them), `category` (the
  wiki page), `themes` (`humor`, `over-the-top`, `hate`, `faith`, …), `tradition: "40k"`, and a
  link to the wiki page with a text fragment.
- The wiki is not a primary source. A record proves only that the wiki lists the quote with
  that attribution, not that Games Workshop wrote it or that the attribution is right.
- To remove all of it: delete `data/private/` and `.cache/quotes/lexicanum/`.

## Limits

- Translations here are older public-domain ones: some read stiffly, and Casaubon's
  Meditations is in 1634 English. Prefer a source's cleaner translation when one exists.
- Only works that are public domain in the United States and on Project Gutenberg belong
  in the committed dataset. Modern fiction, including Warhammer 40,000 text, is copyrighted
  and only ever kept in the private dataset above; the `grimdark` tag in the committed one
  marks antiquity with that tone (Thucydides, Sun Tzu, Tacitus, Machiavelli).
- Check the licensing rules for your own jurisdiction before showing the text outside the
  United States.
