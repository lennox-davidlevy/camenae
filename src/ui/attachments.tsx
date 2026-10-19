import { useEffect, useRef, useState } from "react";
import { attachmentCountLimit, filePreviewLimit, type FileAttachment } from "../file-contract.js";
import { useWorkspaceFiles } from "./files.js";
import "./attachments.css";

export type SelectedAttachment = { path: string; bytes: number };

export type AttachmentUpload = { file: File; error?: string };

export function AttachmentChips({ files, onRemove, disabled }: { files: readonly { path: string }[]; onRemove?: (path: string) => void; disabled?: boolean }) {
  return files.length > 0 && <ul className="attachment-chips" aria-label={onRemove ? "Selected attachments" : "Sent attachments"}>{files.map((file) => <li key={file.path}>
    <span title={file.path}>{file.path.split("/").at(-1)}</span>{onRemove && <button type="button" disabled={disabled} aria-label={`Remove ${file.path}`} onClick={() => onRemove(file.path)}>×</button>}
  </li>)}</ul>;
}

export function AttachmentControl({ selected, onChange, disabled, upload, onUpload, onRemoveUpload }: {
  selected: SelectedAttachment[]; onChange: (files: SelectedAttachment[]) => void; disabled: boolean;
  upload?: AttachmentUpload; onUpload: (file: File) => void; onRemoveUpload: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [browse, setBrowse] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const files = useWorkspaceFiles(opened && browse);
  const total = selected.reduce((sum, file) => sum + file.bytes, 0);
  const text = files.preview?.kind === "text" ? files.preview.text : undefined;
  const bytes = text === undefined ? 0 : new TextEncoder().encode(text).length;
  const already = selected.some((file) => file.path === files.selected);
  const full = selected.length >= attachmentCountLimit || total + bytes > filePreviewLimit;

  useEffect(() => {
    if (opened) dialog.current?.showModal();
    else dialog.current?.close();
  }, [opened]);

  return <>
    <AttachmentChips files={selected} disabled={disabled} onRemove={(path) => onChange(selected.filter((file) => file.path !== path))} />
    {upload && <div className="attachment-upload" role={upload.error ? "alert" : "status"}><span>{upload.file.name}</span>
      {upload.error ? <><span>{upload.error}</span><button type="button" disabled={disabled} onClick={() => onUpload(upload.file)}>Retry</button><button type="button" disabled={disabled} onClick={onRemoveUpload}>Remove</button></> : <span>Uploading…</span>}
    </div>}
    <input hidden ref={input} type="file" aria-label="Upload a file from your computer" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (file) { setOpened(false); onUpload(file); }
    }} />
    <button className="attachment-add" type="button" disabled={disabled || Boolean(upload)} onClick={() => { setBrowse(false); setOpened(true); }}>+ File</button>
    <dialog className="attachment-dialog" ref={dialog} onCancel={() => setOpened(false)} onClose={() => setOpened(false)} aria-labelledby="attachment-title">
      <header><span>Attach files</span><button type="button" aria-label="Close file picker" onClick={() => setOpened(false)}>×</button></header>
      <div className="attachment-dialog-body"><h2 id="attachment-title">Add a file</h2>
        <div className="attachment-sources"><button type="button" disabled={disabled} onClick={() => input.current?.click()}>Upload from computer</button><button type="button" aria-expanded={browse} disabled={disabled} onClick={() => setBrowse(!browse)}>Choose from workspace</button></div>
        <p>Text files only · up to 4 files · 64 KiB total. Uploads are saved in this chat’s inbox folder. Sending shares their contents with your model provider.</p>
        {browse && <>
        <nav aria-label="Attachment folder"><button type="button" onClick={() => files.navigate("")}>Workspace</button><span>{files.path || "/"}</span>
          {files.path && <button type="button" onClick={() => files.navigate(files.path.split("/").slice(0, -1).join("/"))}>Up</button>}<button type="button" onClick={files.refresh}>Refresh</button></nav>
        {files.error && <p role="alert">{files.error}</p>}
        {files.loading ? <p role="status">Loading files…</p> : <ul className="attachment-file-list" aria-label="Workspace files">{files.entries.map((entry) => {
          const path = files.path ? `${files.path}/${entry.name}` : entry.name;

          return <li key={path}><button type="button" aria-pressed={!entry.directory && files.selected === path} onClick={() => entry.directory ? files.navigate(path) : files.select(path)}>
            <span className="attachment-file-type">{entry.directory ? "DIR" : entry.name.split(".").at(-1)?.slice(0, 5).toUpperCase()}</span><span>{entry.name}</span><span>{entry.directory ? "→" : selected.some((file) => file.path === path) ? "Added" : ""}</span>
          </button></li>;
        })}{files.entries.length === 0 && <li>No files in this folder.</li>}</ul>}
        {files.selected && <section aria-label="Attachment preview"><h3>{files.selected}</h3>
          {!files.preview && <p role="status">Loading preview…</p>}
          {text !== undefined && <><small>{bytes.toLocaleString()} bytes</small><pre tabIndex={0}>{text || "Empty text file"}</pre></>}
          {files.preview?.kind === "unavailable" && <p role="status">Only supported UTF-8 text files of up to 64 KiB can be attached. Binary, oversized, and unsupported files are unavailable.</p>}
          {files.preview?.kind === "error" && <p role="alert">{files.preview.message}</p>}
          {full && !already && <p role="status">Remove an attachment to stay within four files and 64 KiB total.</p>}
          <button type="button" disabled={disabled || text === undefined || already || full} onClick={() => {
            if (files.selected && text !== undefined && !already && !full) onChange([...selected, { path: files.selected, bytes }]);
          }}>{already ? "Already added" : "Attach file"}</button>
        </section>}
        </>}
        <AttachmentChips files={selected} disabled={disabled} onRemove={(path) => onChange(selected.filter((file) => file.path !== path))} />
      </div><footer><span>{selected.length} / 4 files · {total.toLocaleString()} / 65,536 bytes</span><button type="button" onClick={() => setOpened(false)}>Done</button></footer>
    </dialog>
  </>;
}

export function ThreadFiles({ attachments }: { attachments: readonly FileAttachment[] }) {
  const paths = [...new Set(attachments.map((file) => file.path))];

  return <section><h2>Files in thread</h2>{paths.length ? <AttachmentChips files={paths.map((path) => ({ path }))} /> : <p>No files attached.</p>}<small>Sent copies are retained with their messages.</small></section>;
}
