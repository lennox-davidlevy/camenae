/** @jsxImportSource solid-js */
import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { Markdown } from "./markdown.js";
import "../ui/editor.css";

// The one text editor the Files and Skills screens share: it fills the column, saves on
// Ctrl+S or Cmd+S, and shows Markdown rendered (sanitized, like chat) or as source.
interface EditorProps {
  label: string;
  value: string;
  original: string;
  markdown: boolean;
  busy: boolean;
  onInput: (value: string) => void;
  onSave: () => void;
}

const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

const lineCount = (text: string) => text === "" ? 0 : text.split("\n").length;

// Front matter (the block between two `---` lines at the top) is shown as what it is, not as Markdown.
const splitFrontMatter = (text: string) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);

  return match ? { front: match[1], body: text.slice(match[0].length) } : { front: undefined, body: text };
};

const sizeLabel = (text: string) => {
  const bytes = new TextEncoder().encode(text).length;

  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
};

export function TextEditor(props: EditorProps) {
  const [mode, setMode] = createSignal<"source" | "preview">("source");
  const dirty = () => props.value !== props.original;

  // Leaving the page with an unsaved edit asks first.
  const guard = (event: BeforeUnloadEvent) => { if (dirty()) event.preventDefault(); };

  window.addEventListener("beforeunload", guard);
  onCleanup(() => window.removeEventListener("beforeunload", guard));

  // A file that is not Markdown has no rendered view.
  createEffect(on(() => props.markdown, (markdown) => { if (!markdown) setMode("source"); }));

  const keys = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();

      if (dirty() && !props.busy) props.onSave();
    }
  };

  return <div class="text-editor">
    <div class="text-editor-bar">
      <Show when={props.markdown}>
        <div class="text-editor-modes" role="tablist" aria-label="View">
          <button role="tab" aria-selected={mode() === "source"} onClick={() => setMode("source")}>Source</button>
          <button role="tab" aria-selected={mode() === "preview"} onClick={() => setMode("preview")}>Rendered</button>
        </div>
      </Show>
      <span class="text-editor-meta">{lineCount(props.value)} lines · {sizeLabel(props.value)}<Show when={dirty()}> · <em>unsaved</em></Show></span>
    </div>
    <Show when={mode() === "source"} fallback={<div class="text-editor-preview" aria-label={`${props.label}, rendered`}>
      <Show when={splitFrontMatter(props.value).front}>{(front) => <pre class="text-editor-front"><span>Front matter</span>{front()}</pre>}</Show>
      <Markdown text={splitFrontMatter(props.value).body} />
    </div>}>
      <textarea class="text-editor-area" aria-label={props.label} spellcheck={false} autocomplete="off" wrap={props.markdown ? "soft" : "off"} value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)} onKeyDown={keys} />
    </Show>
  </div>;
}

export { isMarkdown };

// The header above an open file or skill: where it lives, its name, and the actions that apply.
export function EditorHeader(props: { crumbs: JSX.Element; title: string; detail?: JSX.Element; actions: JSX.Element }) {
  return <header class="editor-header">
    <div class="editor-crumbs">{props.crumbs}</div>
    <div class="editor-title-row">
      <h1 class="editor-title">{props.title}</h1>
      <Show when={props.detail}><div class="editor-detail">{props.detail}</div></Show>
    </div>
    <div class="editor-actions">{props.actions}</div>
  </header>;
}
