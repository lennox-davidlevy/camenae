/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { attachmentsDirectory } from "../file-contract.js";
import { activeMention, insertMention, matchIndices, score, suggestionOrder } from "./file-search.js";
import type { WorkspacePaths } from "./workspace-paths.js";

interface Option {
  path: string;
  attached: boolean;
}

const limit = 50;

interface MentionOptions {
  workspace: WorkspacePaths;
  setText: (text: string) => void;
  attached: () => readonly string[];
}

// Typing @ in the composer offers workspace files (and files attached to this
// message, under the names they will be saved as) to reference. The message
// carries the path as text: @path.
export function createMentions(options: MentionOptions) {
  const [typing, setTyping] = createSignal<{ start: number; query: string }>();
  const [index, setIndex] = createSignal(0);
  const id = `mentions-${crypto.randomUUID()}`;
  let textarea: HTMLTextAreaElement | undefined;

  const choices = createMemo((): readonly Option[] => {
    const current = typing();

    if (!current) return [];
    const attached = options.attached();
    const ordered = suggestionOrder(options.workspace.paths(), attached, attachmentsDirectory);
    const option = (path: string) => ({ path, attached: attached.includes(path) });

    if (!current.query) return ordered.slice(0, limit).map(option);
    const scored: { path: string; score: number }[] = [];

    for (const path of ordered) {
      const value = score(path, current.query);

      // Ties go to what was just attached or uploaded.
      if (value >= 0) scored.push({ path, score: value + (attached.includes(path) ? 1 : path.startsWith(`${attachmentsDirectory}/`) ? .25 : 0) });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((result) => option(result.path));
  });

  const close = () => setTyping(undefined);

  // After every edit or caret move: is an @reference being typed here?
  const update = () => {
    if (!textarea) return;
    const found = activeMention(textarea.value, textarea.selectionStart);
    setTyping(found);
    setIndex(0);

    if (found) void options.workspace.load();
  };

  // The footer's @ button: start a reference at the caret.
  const start = () => {
    if (!textarea) return;
    const field = textarea;
    const before = field.value.slice(0, field.selectionStart);
    const inserted = `${before && !/\s$/.test(before) ? " " : ""}@`;
    const next = before.length + inserted.length;
    options.setText(before + inserted + field.value.slice(field.selectionEnd));
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(next, next);
      update();
    });
  };

  const choose = (path: string) => {
    const current = typing();

    if (!current || !textarea) return;
    const field = textarea;
    const next = insertMention(field.value, current.start, field.selectionStart, path);
    options.setText(next.text);
    close();
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(next.caret, next.caret);
    });
  };

  // True when the key was the menu's, so the composer does not also act on it.
  const keyDown = (event: KeyboardEvent) => {
    if (!typing() || event.isComposing) return false;
    const count = choices().length;
    const picked = choices()[index()];

    if (event.key === "Escape") close();
    else if (count === 0) return false;
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    else if ((event.key === "Enter" || event.key === "Tab") && picked) choose(picked.path);
    else return false;
    event.preventDefault();

    return true;
  };

  const optionId = (position: number) => `${id}-${position}`;

  const field = () => ({ "aria-autocomplete": "list" as const, "aria-controls": id, "aria-expanded": Boolean(typing()),
    "aria-activedescendant": typing() && choices().length > 0 ? optionId(index()) : undefined });

  return { bind: (element: HTMLTextAreaElement) => { textarea = element; }, update, keyDown, close, choose, start, typing, choices, index, setIndex, id, optionId, field };
}

export type Mentions = ReturnType<typeof createMentions>;

// The name with the matched characters marked; the folder stays plain.
function Name(props: { path: string; query: string }) {
  const nameStart = () => props.path.lastIndexOf("/") + 1;
  const matched = () => matchIndices(props.path, props.query);

  return <span class="mention-name">{Array.from(props.path.slice(nameStart())).map((character, offset) => matched().has(nameStart() + offset) ? <mark>{character}</mark> : character)}</span>;
}

export function MentionMenu(props: { mentions: Mentions }) {
  const m = props.mentions;
  let list: HTMLDivElement | undefined;

  // Keep the chosen row in view while moving with the keyboard.
  createEffect(on(m.index, (position) => list?.querySelector(`#${CSS.escape(m.optionId(position))}`)?.scrollIntoView({ block: "nearest" })));

  return <Show when={m.typing()}>{(typing) => <div class="mention-menu">
    <header><span>Files</span><Show when={typing().query}><span>{m.choices().length === limit ? `${limit}+` : m.choices().length} {m.choices().length === 1 ? "match" : "matches"}</span></Show></header>
    <div class="mention-list" id={m.id} role="listbox" aria-label="Workspace files" ref={(element) => { list = element; }}>
      <For each={m.choices()} fallback={<p class="mention-empty">{typing().query ? "No matching files." : "No files yet."}</p>}>{(option, position) =>
        <div role="option" id={m.optionId(position())} class="mention-option" aria-selected={position() === m.index()}
          onMouseEnter={() => m.setIndex(position())} onMouseDown={(event) => { event.preventDefault(); m.choose(option.path); }}>
          <Name path={option.path} query={typing().query} />
          <small>{option.attached ? "attached · saved when sent" : option.path.includes("/") ? `${option.path.split("/").slice(0, -1).join("/")}/` : ""}</small>
        </div>}</For>
    </div>
  </div>}</Show>;
}
