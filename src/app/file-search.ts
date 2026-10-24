// Fuzzy file finder: every query character in order, favouring the file name,
// consecutive runs and earlier matches.
export function score(path: string, query: string) {
  const lower = path.toLowerCase();
  const nameStart = lower.lastIndexOf("/") + 1;
  let position = -1;
  let total = 0;

  for (const character of query.toLowerCase()) {
    const next = lower.indexOf(character, position + 1);

    if (next < 0) return -1;
    total += (next === position + 1 ? 3 : 0) + (next >= nameStart ? 2 : 0) - next * .01;
    position = next;
  }

  return total;
}

// A workspace path as written in a message: @path, or @"path" when it has spaces.
export const mention = (path: string) => /\s|"/.test(path) ? `@"${path.replaceAll('"', "")}"` : `@${path}`;

// The @reference being typed just before the caret, if any.
export function activeMention(text: string, caret: number) {
  const match = /(?:^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret));

  return match?.[1] === undefined ? undefined : { start: caret - match[1].length - 1, query: match[1] };
}

// Replaces the typed reference with the chosen path and a space after it.
export function insertMention(text: string, start: number, caret: number, path: string) {
  const inserted = `${mention(path)} `;
  const rest = text.slice(caret).replace(/^\S*\s?/, "");

  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length };
}

// Points references at the paths files were actually saved under.
export function renameMentions(text: string, renames: ReadonlyMap<string, string>) {
  let result = text;

  for (const [from, to] of renames) {
    const written = mention(from);
    result = result.replace(new RegExp(`${written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,.;:!?)])`, "g"), mention(to));
  }

  return result;
}

// The positions score() matched, for highlighting the same characters.
export function matchIndices(path: string, query: string) {
  const lower = path.toLowerCase();
  const found = new Set<number>();
  let position = -1;

  for (const character of query.toLowerCase()) {
    position = lower.indexOf(character, position + 1);

    if (position < 0) return new Set<number>();
    found.add(position);
  }

  return found;
}

// With nothing typed yet, what you most likely mean comes first: files attached
// to this message, then uploads, then the rest, shallowest first.
export function suggestionOrder(paths: readonly string[], attached: readonly string[], uploads: string) {
  const rank = (path: string) => attached.includes(path) ? 0 : path.startsWith(`${uploads}/`) ? 1 : 2;
  const depth = (path: string) => path.split("/").length;

  return [...new Set([...attached, ...paths])].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || a.localeCompare(b));
}
