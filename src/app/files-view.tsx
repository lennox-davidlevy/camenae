/** @jsxImportSource solid-js */
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";
import { protectedFolders, uploadLimit } from "../file-contract.js";
import { downloadHref } from "./files-api.js";
import type { Files } from "./files-state.js";
import "../ui/files.css";

const sizeLabel = (bytes: number | null) => bytes === null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

const typeLabel = (name: string, directory: boolean) => directory ? "Folder" : name.includes(".") ? name.split(".").at(-1)?.toUpperCase() ?? "File" : "File";

const isProtected = (path: string) => protectedFolders.some((folder) => folder === path);

interface NameFormProps {
  label: string;
  initial?: string;
  action: string;
  disabled: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}

function NameForm(props: NameFormProps) {
  const [name, setName] = createSignal(props.initial ?? "");

  return <form class="files-form" onSubmit={(event) => {
    event.preventDefault();
    const value = name().trim();

    if (value) void props.onSubmit(value).then((done) => { if (done) props.onCancel(); });
  }}>
    <label>{props.label} <input value={name()} maxLength={1024} required autofocus onInput={(event) => setName(event.currentTarget.value)} /></label>
    <button type="submit" disabled={props.disabled || !name().trim()}>{props.action}</button>
    <button type="button" onClick={props.onCancel}>Cancel</button>
  </form>;
}

export function FilesScreen(props: { files: Files }) {
  const files = () => props.files;
  const [creating, setCreating] = createSignal<"file" | "folder" | "rename">();
  const parts = () => files().path() ? files().path().split("/") : [];
  let picker: HTMLInputElement | undefined;

  const choose = (list: FileList | null) => {
    const picked = [...(list ?? [])];

    if (picked.length > 0) void files().upload(picked);
  };

  return <section aria-label="Workspace files" class="workspace-files"
    onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer?.files ?? null); }}>
    <span class="files-workspace-label">Workspace</span>
    <h1>Files</h1>
    <nav class="files-breadcrumb" aria-label="Workspace folder">
      <button disabled={files().busy()} aria-current={!files().path() ? "location" : undefined} onClick={() => files().navigate("")}>Workspace</button>
      <For each={parts()}>{(part, index) => <span><span aria-hidden="true">›</span>
        <button disabled={files().busy()} aria-current={index() === parts().length - 1 ? "location" : undefined} onClick={() => files().navigate(parts().slice(0, index() + 1).join("/"))}>{part}</button></span>}</For>
    </nav>
    <div class="files-toolbar files-actions">
      <button disabled={files().busy()} onClick={() => picker?.click()}>Upload files</button>
      <button disabled={files().busy()} onClick={() => setCreating("file")}>New file</button>
      <button disabled={files().busy()} onClick={() => setCreating("folder")}>New folder</button>
      <Show when={files().path() && !isProtected(files().path())}>
        <button disabled={files().busy()} onClick={() => setCreating("rename")}>Rename folder</button>
        <button disabled={files().busy()} onClick={() => { if (window.confirm(`Delete the folder ${files().path()} and everything in it? This cannot be undone.`)) void files().remove(files().path()).then((done) => { if (done) files().navigate(files().path().split("/").slice(0, -1).join("/")); }); }}>Delete folder</button>
      </Show>
      <button disabled={files().loading() || files().busy()} onClick={() => files().refresh()}>Refresh</button>
      <label class="files-hidden"><input type="checkbox" checked={files().showHidden()} onChange={(event) => files().setShowHidden(event.currentTarget.checked)} /> Show hidden</label>
      <input type="file" multiple hidden ref={(element) => { picker = element; }} onChange={(event) => { choose(event.currentTarget.files); event.currentTarget.value = ""; }} />
    </div>
    <Show when={creating() === "file"}><NameForm label="File name" action="Create file" disabled={files().busy()} onSubmit={files().create} onCancel={() => setCreating(undefined)} /></Show>
    <Show when={creating() === "folder"}><NameForm label="Folder name" action="Create folder" disabled={files().busy()} onSubmit={files().createFolder} onCancel={() => setCreating(undefined)} /></Show>
    <Show when={creating() === "rename"}><NameForm label="New path" initial={files().path()} action="Move folder" disabled={files().busy()}
      onSubmit={(name) => files().move(files().path(), name)} onCancel={() => setCreating(undefined)} /></Show>
    <Show when={files().clash()[0]}>{(pending) => <div class="files-clash" role="alert">
      <p><strong>{pending().target}</strong> already exists. What should happen to the new file?</p>
      <div>
        <button onClick={() => void files().resolveClash("replace")}>Replace it</button>
        <button onClick={() => void files().resolveClash("unique")}>Keep both</button>
        <button onClick={() => void files().resolveClash("skip")}>Skip</button>
      </div>
    </div>}</Show>
    <Show when={files().error()}><p role="alert">{files().error()}</p></Show>
    <Show when={files().notice()}><p role="status">{files().notice()}</p></Show>
    <div aria-busy={files().loading()}>
      <table class="files-table">
        <caption>Files and folders in {files().path() || "the workspace root"}</caption>
        <thead><tr><th scope="col">Name</th><th scope="col" class="files-size">Size</th><th scope="col">Type</th></tr></thead>
        <tbody><For each={files().listing()?.entries}>{(entry) => {
          const child = () => files().join(files().path(), entry.name);

          return <tr data-selected={files().selected() === child() ? "true" : undefined} data-hidden={entry.hidden ? "true" : undefined}>
            <th scope="row"><button disabled={files().busy()} aria-pressed={entry.directory ? undefined : files().selected() === child()}
              onClick={() => entry.directory ? files().navigate(child()) : files().setSelected(child())}>{entry.name}{entry.directory ? <span aria-hidden="true"> ›</span> : null}</button></th>
            <td class="files-size">{sizeLabel(entry.size)}</td>
            <td>{typeLabel(entry.name, entry.directory)}</td>
          </tr>;
        }}</For></tbody>
      </table>
      <Show when={files().listing()?.truncated}><p role="status">Only the first 1,000 entries are shown.</p></Show>
      <Show when={files().loading()}><p role="status">Refreshing files…</p></Show>
      <Show when={!files().loading() && !files().error() && files().listing()?.entries.length === 0}><p class="files-empty">This folder is empty.</p></Show>
    </div>
    <div class="files-upload">
      <p>Drop files anywhere on this page, or choose them with Upload files. Up to {uploadLimit / 1048576} MB each. If a name is taken you choose to replace, keep both, or skip.</p>
    </div>
  </section>;
}

interface InspectorProps {
  files: Files;
  onAsk: (path: string) => void;
}

export function FileInspector(props: InspectorProps) {
  const files = () => props.files;
  const [draft, setDraft] = createSignal("");
  const [moving, setMoving] = createSignal(false);

  const original = () => {
    const current = files().preview();

    return current?.kind === "text" ? current.text : undefined;
  };

  createEffect(on([files().selected, files().preview], () => setDraft(original() ?? "")));
  createEffect(on(files().selected, () => setMoving(false)));

  const dirty = () => original() !== undefined && draft() !== original();

  const status = (): JSX.Element => {
    const current = files().preview();

    if (!current) return <p role="status">Loading preview…</p>;

    if (current.kind === "error") return <p role="alert">{current.message}</p>;

    if (current.kind === "unavailable") return <p>{current.reason === "too-large" ? "This file exceeds the 1 MiB text limit. Download it to open it elsewhere." : "This file is not UTF-8 text. Download it to open it in a suitable application."}</p>;

    return null;
  };

  return <section class="file-inspector">
    <h2>Selected file</h2>
    <Show when={files().selected()} fallback={<p>Select a file to preview it, edit it, download it, or ask about it.</p>}>{(path) => <>
      <p class="file-selected-name">{path().split("/").at(-1)}</p>
      <div class="file-preview">
        <h3>Contents</h3>
        {status()}
        <Show when={original() !== undefined}>
          <textarea class="file-editor" aria-label="File contents" spellcheck={false} value={draft()} onInput={(event) => setDraft(event.currentTarget.value)} />
          <div class="file-actions">
            <button disabled={!dirty() || files().busy()} onClick={() => void files().save(path(), draft())}>Save changes</button>
            <button disabled={!dirty() || files().busy()} onClick={() => setDraft(original() ?? "")}>Revert</button>
          </div>
        </Show>
      </div>
      <div class="file-path"><span>Workspace-relative path</span><code>{path()}</code></div>
      <div class="file-actions">
        <a href={downloadHref(path())} download="">Download</a>
        <button onClick={() => props.onAsk(path())}>Ask about this file</button>
        <button disabled={files().busy()} onClick={() => setMoving((value) => !value)}>Rename or move</button>
        <button disabled={files().busy()} onClick={() => { if (window.confirm(`Delete ${path()}? This cannot be undone.`)) void files().remove(path()); }}>Delete</button>
      </div>
      <Show when={moving()}><NameForm label="New path" initial={path()} action="Move" disabled={files().busy()}
        onSubmit={(name) => files().move(path(), name)} onCancel={() => setMoving(false)} /></Show>
    </>}</Show>
  </section>;
}
