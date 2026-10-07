import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FilePreview, filePreviewLimit, plainText, UploadName } from "../file-contract.js";
import "./files.css";

const Entries = z.object({ entries: z.array(z.object({ name: z.string(), directory: z.boolean() })) });

const Uploaded = z.object({ path: z.string().startsWith("inbox/") });

export async function uploadWorkspaceFile(file: File, csrf: string, conversation?: string) {
  if (file.size > filePreviewLimit) throw new Error("Choose a text file of up to 64 KiB.");

  if (!UploadName.safeParse(file.name).success) throw new Error("Choose a supported text file with a short filename, without slashes or control characters.");
  let text: string;

  try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error("This file is not valid UTF-8 text."); }

  if (!plainText(text)) throw new Error("This file contains binary data. Choose a text file instead.");
  const response = await fetch("/api/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf, name: file.name, text, conversation }) });

  if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to upload files." : "Upload failed. Please retry; supported text files must be at most 64 KiB.");

  return { path: Uploaded.parse(await response.json()).path, bytes: new TextEncoder().encode(text).length };
}

const shortcuts = ["outputs", "inbox", "projects", "scratch"];

type PreviewResult = FilePreview | { kind: "error"; message: string };

const previewMessages = {
  unsupported: "This file type is not supported for text preview. Download it to open it in a suitable application.",
  "too-large": "This file exceeds the 64 KiB preview limit. Download it to view its contents (downloads are limited to 8 MiB).",
  "not-text": "This file contains binary data or is not valid UTF-8 text. Download it to view it in a suitable application.",
};

export function useWorkspaceFiles(active: boolean, csrf?: string) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<z.infer<typeof Entries>["entries"]>([]);
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<{ path: string; result: PreviewResult }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploaded, setUploaded] = useState("");
  const uploadPending = useRef(false);

  // Tab activation and directory changes share the same refresh path. Cleanup
  // prevents an older directory's success or failure from replacing the new one.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`, { signal: controller.signal });

        if (!response.ok) throw new Error("Files unavailable. Check your login, refresh, or choose another folder.");
        const result = Entries.parse(await response.json());

        if (controller.signal.aborted) return;
        setEntries(result.entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)));
        setSelected((current) => result.entries.some((entry) => !entry.directory && (path ? `${path}/${entry.name}` : entry.name) === current) ? current : undefined);
      } catch {
        if (controller.signal.aborted) return;
        setEntries([]);
        setSelected(undefined);
        setError("Files unavailable. Check your login, refresh, or choose another folder.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [active, path, revision]);

  // One request supplies both the desktop and inline inspectors. Refetch on tab
  // entry and manual refresh, and never display a previous selection's contents.
  useEffect(() => {
    setPreview(undefined);

    if (!active || !selected) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/files/preview?path=${encodeURIComponent(selected)}`, { signal: controller.signal });

        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to preview this file." : "Preview unavailable. Refresh files to retry.");
        const result = FilePreview.safeParse(await response.json());

        if (!result.success) throw new Error("Preview unavailable. Refresh files to retry.");

        if (!controller.signal.aborted) setPreview({ path: selected, result: result.data });
      } catch (failure) {
        if (!controller.signal.aborted) setPreview({ path: selected, result: { kind: "error", message: failure instanceof Error ? failure.message : "Preview unavailable. Refresh files to retry." } });
      }
    })();

    return () => controller.abort();
  }, [active, selected, revision]);

  const navigate = (next: string) => {
    if (uploadPending.current || next === path) return;
    setPath(next);
    setEntries([]);
    setSelected(undefined);
    setUploaded("");
  };

  const upload = async (file: File) => {
    if (!csrf || uploadPending.current) return;
    setUploadError("");
    setUploaded("");

    uploadPending.current = true;
    setUploading(true);

    try {
      const result = await uploadWorkspaceFile(file, csrf);
      setPath("inbox");
      setEntries([]);
      setSelected(result.path);
      setUploaded(result.path);
      setRevision((value) => value + 1);
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : "Upload failed. Please try again.");
    } finally {
      uploadPending.current = false;
      setUploading(false);
    }
  };

  return { path, entries, selected, preview: preview?.path === selected ? preview?.result : undefined, loading, error, uploading, uploadError, uploaded, navigate, upload,
    select: setSelected, refresh: () => setRevision((value) => value + 1) };
}

export function FileInspector({ path, preview }: { path?: string; preview?: PreviewResult }) {
  const [copyStatus, setCopyStatus] = useState("");

  return <section className="file-inspector">
    <h2>Selected file</h2>
    {path ? <>
      <p className="file-selected-name">{path.split("/").at(-1)}</p>
      <div className="file-preview">
        <h3>Text preview</h3>
        {!preview && <p role="status">Loading preview…</p>}
        {preview?.kind === "text" && (preview.text ? <pre tabIndex={0} aria-label="File contents">{preview.text}</pre> : <p>No text content.</p>)}
        {preview?.kind === "unavailable" && <p>{previewMessages[preview.reason]}</p>}
        {preview?.kind === "error" && <p role="alert">{preview.message}</p>}
      </div>
      <div className="file-path"><span>Workspace-relative path</span><code>{path}</code></div>
      <div className="file-actions">
        <a href={`/api/files/download?path=${encodeURIComponent(path)}`} download>Download</a>
        <button onClick={() => {
          void (async () => {
            try { await navigator.clipboard.writeText(path); setCopyStatus("Path copied. Paste it into your message in Chat."); }
            catch { setCopyStatus("Could not copy automatically. Select and copy the path above."); }
          })();
        }}>Copy path</button>
      </div>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <small>Downloads are limited to 8 MiB. Use + File in Chat to attach a text snapshot, or copy this path to reference it. Files are not attached automatically.</small>
    </> : <p>Select a file to preview it, download it, or copy its path.</p>}
  </section>;
}

export function WorkspaceFiles({ files }: { files: ReturnType<typeof useWorkspaceFiles> }) {
  const parts = files.path ? files.path.split("/") : [];
  const folder = parts[0] ?? "";

  return <section aria-label="Workspace files" className="workspace-files">
    <span className="files-workspace-label">Workspace</span>
    <h1>Files</h1>
    <nav className="files-breadcrumb" aria-label="Workspace folder">
      <button disabled={files.uploading} aria-current={!files.path ? "location" : undefined} onClick={() => files.navigate("")}>Workspace</button>
      {parts.map((part, index) => <span key={parts.slice(0, index + 1).join("/")}><span aria-hidden="true">›</span><button disabled={files.uploading} aria-current={index === parts.length - 1 ? "location" : undefined} onClick={() => files.navigate(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}
    </nav>
    <div className="files-toolbar">
      <label>Folder <select value={folder} disabled={files.uploading} onChange={(event) => files.navigate(event.target.value)}>
        <option value="">Workspace root</option>
        {shortcuts.map((shortcut) => <option key={shortcut}>{shortcut}</option>)}
        {folder && !shortcuts.includes(folder) && <option value={folder}>{folder}</option>}
      </select></label>
      <button disabled={files.loading || files.uploading} onClick={files.refresh}>Refresh</button>
    </div>
    <p className="files-refresh-note">Refreshed when you open this tab. One shared workspace across conversations.</p>
    {files.error && <p role="alert">{files.error}</p>}
    <div aria-busy={files.loading}>
      <table className="files-table">
        <caption>Files and folders in {files.path || "the workspace root"}</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Type</th></tr></thead>
        <tbody>{files.entries.map((entry) => {
          const child = files.path ? `${files.path}/${entry.name}` : entry.name;
          const extension = entry.name.includes(".") ? entry.name.split(".").at(-1)?.toUpperCase() : "";

          return <tr key={entry.name} data-selected={files.selected === child}>
            <th scope="row"><button disabled={files.uploading} aria-pressed={entry.directory ? undefined : files.selected === child} onClick={() => entry.directory ? files.navigate(child) : files.select(child)}>{entry.name}{entry.directory && <span aria-hidden="true">/</span>}</button></th>
            <td>{entry.directory ? "Folder" : extension || "File"}</td>
          </tr>;
        })}</tbody>
      </table>
      {files.loading && <p role="status">Refreshing files…</p>}
      {!files.loading && !files.error && files.entries.length === 0 && <p className="files-empty">This folder is empty.</p>}
    </div>
    <div className="files-upload">
      <label htmlFor="workspace-file-upload">Upload a text file</label>
      <p id="workspace-upload-help">Text files · up to 64 KiB · saved to inbox. You can also upload directly from + File in Chat.</p>
      <input id="workspace-file-upload" type="file" accept=".txt,.md,.csv,.json" disabled={files.uploading} aria-describedby="workspace-upload-help" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";

        if (file) void files.upload(file);
      }} />
      {files.uploading && <p role="status">Uploading…</p>}
      {files.uploaded && <p role="status">Saved as <code>{files.uploaded}</code>. Choose it with + File in Chat.</p>}
      {files.uploadError && <p role="alert">{files.uploadError}</p>}
    </div>
    <div className="files-inline-inspector"><FileInspector key={files.selected ?? "none"} path={files.selected} preview={files.preview} /></div>
  </section>;
}
