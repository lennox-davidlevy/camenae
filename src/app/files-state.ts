import { createEffect, createSignal, on } from "solid-js";
import { safeName, uploadLimit, type FileListing, type FilePreview } from "../file-contract.js";
import { deletePath, FileRequestError, listFiles, addFolder, movePath, previewFile, uploadFile } from "./files-api.js";

export type Preview = FilePreview | { kind: "error"; message: string };

export interface Clash {
  file: File;
  target: string;
}

const missingFolder = "That folder no longer exists.";

const loadFailed = "Could not load files. Refresh to retry.";

// Errors the listing itself raised; a later successful load clears only these.
const loadFailures = [missingFolder, loadFailed];

const join = (folder: string, name: string) => folder ? `${folder}/${name}` : name;

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

const reason = (error: Error | string) => error instanceof FileRequestError ? error.message : "The request failed. Nothing was changed.";

// Everything the Files screen and its inspector share: where you are, what is
// selected, and the changes in flight. All writes go through the safe server routes.
export function createFiles(props: { csrf: () => string | undefined; active: () => boolean }) {
  const [path, setPath] = createSignal("");
  const [listing, setListing] = createSignal<FileListing>();
  const [showHidden, setShowHidden] = createSignal(false);
  const [selected, setSelected] = createSignal<string>();
  const [preview, setPreview] = createSignal<Preview>();
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [clash, setClash] = createSignal<readonly Clash[]>([]);
  const [revision, setRevision] = createSignal(0);

  // A slower, older load must not replace a newer one (a folder deleted while open).
  let latest = 0;

  const loadListing = async () => {
    latest += 1;
    const mine = latest;
    setLoading(true);

    try {
      const next = await listFiles(path(), showHidden());

      if (mine !== latest) return;
      setListing(next);

      if (loadFailures.includes(error())) setError("");
    } catch (failure) {
      if (mine !== latest) return;
      setListing(undefined);
      setError(failure instanceof FileRequestError && failure.code === "NOT_FOUND" ? missingFolder : loadFailed);
    } finally { if (mine === latest) setLoading(false); }
  };

  const loadPreview = async (file: string) => {
    setPreview(undefined);

    try {
      const next = await previewFile(file);

      if (selected() === file) setPreview(next);
    } catch (failure) {
      if (selected() === file) setPreview({ kind: "error", message: failure instanceof Error ? reason(failure) : "Preview unavailable." });
    }
  };

  // Reload when the folder, the hidden toggle, or a change asks for it, while the screen is open.
  createEffect(on([path, showHidden, revision, props.active], () => { if (props.active()) void loadListing(); }));

  createEffect(on([selected, revision], () => {
    const file = selected();

    if (file && props.active()) void loadPreview(file);
  }));

  const navigate = (next: string) => {
    if (busy() || next === path()) return;
    setPath(next);
    setSelected(undefined);
    setNotice("");
  };

  const refresh = () => setRevision((value) => value + 1);

  // Runs one change, then refreshes. Reports the server's reason when it refuses.
  const change = async (work: (csrf: string) => Promise<string | undefined>) => {
    const csrf = props.csrf();

    if (!csrf || busy()) return false;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const done = await work(csrf);

      if (done) setNotice(done);
      refresh();

      return true;
    } catch (failure) {
      setError(failure instanceof Error ? reason(failure) : "The request failed. Nothing was changed.");

      return false;
    } finally { setBusy(false); }
  };

  const upload = async (files: readonly File[]) => {
    const problems: string[] = [];
    const clashes: Clash[] = [];
    let saved = 0;

    await change(async (csrf) => {
      for (const file of files) {
        const target = join(path(), safeName(file.name));

        if (file.size > uploadLimit) {
          problems.push(`${file.name} is larger than 15 MB.`);
          continue;
        }

        try {
          await uploadFile(csrf, target, file, "fail");
          saved += 1;
        } catch (failure) {
          if (failure instanceof FileRequestError && failure.code === "FILE_EXISTS") clashes.push({ file, target });
          else throw failure;
        }
      }

      return undefined;
    });

    setClash(clashes);

    if (problems.length > 0) setError(problems.join(" "));
    else if (saved > 0) setNotice(`Uploaded ${saved} ${saved === 1 ? "file" : "files"}.`);
  };

  // Answers the first pending name clash, then the next.
  const resolveClash = async (choice: "replace" | "unique" | "skip") => {
    const [first, ...rest] = clash();

    if (!first) return;
    setClash(rest);

    if (choice === "skip") return;
    await change(async (csrf) => `Saved ${await uploadFile(csrf, first.target, first.file, choice)}.`);
  };

  const create = (name: string) => change(async (csrf) => {
    const target = join(path(), safeName(name));
    const saved = await uploadFile(csrf, target, new Blob([]), "fail");
    setSelected(saved);

    return `Created ${saved}.`;
  });

  const createFolder = (name: string) => change(async (csrf) => {
    const target = join(path(), safeName(name));
    await addFolder(csrf, target);

    return `Created folder ${target}.`;
  });

  // Saving an edit replaces the file with its new text.
  const save = (file: string, text: string) => change(async (csrf) => {
    await uploadFile(csrf, file, new Blob([text]), "replace");

    return "Saved.";
  });

  const move = (from: string, to: string) => change(async (csrf) => {
    await movePath(csrf, from, to);
    setSelected(to === from ? from : to);
    setPath(parentOf(to));

    return `Moved to ${to}.`;
  });

  const remove = (target: string) => change(async (csrf) => {
    await deletePath(csrf, target);

    if (selected() === target) setSelected(undefined);

    return `Deleted ${target}.`;
  });

  return { path, listing, showHidden, setShowHidden, selected, setSelected, preview, loading, busy, error, notice, clash, navigate, refresh, upload, resolveClash, create, createFolder, save, move, remove, join };
}

export type Files = ReturnType<typeof createFiles>;
