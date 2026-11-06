/** @jsxImportSource solid-js */
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { protectedFolders, uploadLimit } from "../file-contract.js";
import { EditorHeader, isMarkdown, TextEditor } from "./editor.js";
import { downloadHref } from "./files-api.js";
import type { Files } from "./files-state.js";
import "../ui/files.css";

const sizeLabel = (bytes: number | null) => bytes === null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

const typeLabel = (name: string, directory: boolean) => directory ? "Folder" : name.includes(".") ? name.split(".").at(-1)?.toUpperCase() ?? "File" : "File";

const isProtected = (path: string) => protectedFolders.some((folder) => folder === path);

const nameOf = (path: string) => path.split("/").at(-1) ?? path;

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

// Browsing: the folder you are in, what it holds, and the ways to add to it.
function Browse(props: { files: Files }) {
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
    <span class="files-workspace-label">Shared workspace</span>
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

          return <tr data-hidden={entry.hidden ? "true" : undefined}>
            <th scope="row"><button disabled={files().busy()}
              onClick={() => entry.directory ? files().navigate(child()) : files().open(child())}>{entry.name}{entry.directory ? <span aria-hidden="true"> ›</span> : null}</button></th>
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

// An open file takes the whole column: where it lives, what you can do with it, and its text.
function OpenFile(props: { files: Files; path: string; onAsk: (path: string) => void }) {
  const files = () => props.files;
  const [moving, setMoving] = createSignal(false);
  const parts = () => props.path.split("/");
  const name = () => nameOf(props.path);
  const folders = () => parts().slice(0, -1);

  createEffect(on(() => props.path, () => setMoving(false)));

  // A folder crumb goes back to browsing it; the current folder just closes the file.
  const go = (folder: string) => { if (folder === files().path()) files().close(); else files().navigate(folder); };

  const body = () => {
    const current = files().preview();

    if (!current) return <p role="status">Loading…</p>;

    if (current.kind === "error") return <p role="alert">{current.message}</p>;

    if (current.kind === "unavailable") {
      return <div class="editor-unavailable">
        <p>{current.reason === "too-large" ? "This file is larger than the 1 MiB text limit, so it cannot be edited here." : "This file is not UTF-8 text, so it cannot be edited here."}</p>
        <p>Download it to open it in a suitable application.</p>
      </div>;
    }

    return <TextEditor label={`Contents of ${name()}`} value={files().draft()} original={current.text} markdown={isMarkdown(name())} busy={files().busy()}
      onInput={files().setDraft} onSave={() => void files().save(props.path, files().draft())} />;
  };

  return <section class="editor-screen" aria-label={`Open file ${name()}`}>
    <EditorHeader title={name()}
      crumbs={<><span class="editor-crumb-label">Files</span>
        <span><span aria-hidden="true">›</span><button onClick={() => go("")}>Workspace</button></span>
        <For each={folders()}>{(part, index) => <span><span aria-hidden="true">›</span><button onClick={() => go(folders().slice(0, index() + 1).join("/"))}>{part}</button></span>}</For></>}
      detail={<><span>{typeLabel(name(), false)}</span><code>{props.path}</code></>}
      actions={<>
        <button class="editor-primary" disabled={!files().dirty() || files().busy()} onClick={() => void files().save(props.path, files().draft())}>Save</button>
        <button disabled={!files().dirty() || files().busy()} onClick={() => files().setDraft(files().original() ?? "")}>Revert</button>
        <span class="editor-gap" />
        <a href={downloadHref(props.path)} download="">Download</a>
        <button onClick={() => props.onAsk(props.path)}>Ask about this file</button>
        <button disabled={files().busy()} onClick={() => setMoving((value) => !value)}>Rename or move</button>
        <button class="editor-danger" disabled={files().busy()} onClick={() => { if (window.confirm(`Delete ${props.path}? This cannot be undone.`)) void files().remove(props.path); }}>Delete</button>
        <button class="editor-close" onClick={() => files().close()}>Close ×</button>
      </>} />
    <Show when={moving()}><NameForm label="New path" initial={props.path} action="Move" disabled={files().busy()}
      onSubmit={(name) => files().move(props.path, name)} onCancel={() => setMoving(false)} /></Show>
    <Show when={files().error()}><p role="alert">{files().error()}</p></Show>
    <Show when={files().notice()}><p role="status">{files().notice()}</p></Show>
    {body()}
  </section>;
}

export function FilesScreen(props: { files: Files; onAsk: (path: string) => void }) {
  return <Show when={props.files.selected()} fallback={<Browse files={props.files} />}>
    {(path) => <OpenFile files={props.files} path={path()} onAsk={props.onAsk} />}
  </Show>;
}

// The rail: while browsing, what this screen is for; with a file open, its neighbours and its path.
export function FileInspector(props: { files: Files }) {
  const files = () => props.files;
  const siblings = () => files().listing()?.entries.filter((entry) => !entry.directory) ?? [];

  return <section class="file-inspector">
    <Show when={files().selected()} fallback={<>
      <h2>Files</h2>
      <p>Open a file to edit it here. Folders you are in: <code>{files().path() || "the workspace root"}</code>.</p>
      <small>The assistant works in the same workspace. The inbox folder holds files you attach to messages.</small>
    </>}>{(path) => <>
      <h2>Open file</h2>
      <p class="file-selected-name">{nameOf(path())}</p>
      <small>{files().dirty() ? "Unsaved changes. Ctrl+S or Cmd+S saves." : "Ctrl+S or Cmd+S saves."}</small>
      <Show when={siblings().length > 1}>
        <h2>In this folder</h2>
        <ul class="editor-siblings"><For each={siblings()}>{(entry) => {
          const child = () => files().join(files().path(), entry.name);

          return <li><button aria-current={child() === path() ? "true" : undefined} onClick={() => files().open(child())}>
            <span>{entry.name}</span><small>{sizeLabel(entry.size)}</small></button></li>;
        }}</For></ul>
      </Show>
      <div class="file-path"><span>Workspace-relative path</span><code>{path()}</code></div>
    </>}</Show>
  </section>;
}
