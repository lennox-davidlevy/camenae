/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show } from "solid-js";
import { attachmentCountLimit, attachmentsDirectory, freePath, safeName, uploadLimit } from "../file-contract.js";
import { uploadFile } from "./files-api.js";
import "../ui/attachments.css";

const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

// A file waiting to be sent; `path` once it is saved, so a retry never saves it twice.
interface Attachment {
  key: string;
  file: File;
  path?: string;
  planned?: string;
}

interface AttachmentOptions {
  csrf: () => string | undefined;
  taken: () => readonly string[];
  refresh: () => void;
}

export interface SavedAttachments {
  paths: string[];
  renames: Map<string, string>;
}

// Files attached to the next message are saved into the workspace when it is sent,
// and the message names where they are, so the agent reads them itself. Each is
// planned a name no existing file or other attachment has ("name-2.ext"), so an
// @reference to it is never mistaken for the file already there.
export function createAttachments(options: AttachmentOptions) {
  const [items, setItems] = createSignal<readonly Attachment[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal("");

  const add = (files: readonly File[]) => {
    const large = files.filter((file) => file.size > uploadLimit);
    const room = Math.max(0, attachmentCountLimit - items().length);
    const accepted = files.filter((file) => file.size <= uploadLimit).slice(0, room);

    options.refresh();
    setItems((current) => [...current, ...accepted.map((file) => ({ key: crypto.randomUUID(), file }))]);

    if (large.length > 0) setProblem(`${large.map((file) => file.name).join(", ")} ${large.length === 1 ? "is" : "are"} larger than ${uploadLimit / 1048576} MB.`);
    else setProblem(files.length > accepted.length ? `Attach up to ${attachmentCountLimit} files per message.` : "");
  };

  // Where each will be (or was) saved: what @references to it name.
  const plans = createMemo(() => {
    const taken = new Set(options.taken());
    const plan = new Map<string, string>();

    for (const item of items()) {
      const path = item.path ?? freePath(`${attachmentsDirectory}/${safeName(item.file.name)}`, taken);
      taken.add(path);
      plan.set(item.key, path);
    }

    return plan;
  });

  const planned = (item: Attachment) => plans().get(item.key) ?? `${attachmentsDirectory}/${safeName(item.file.name)}`;

  const remove = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
    setProblem("");
  };

  // Saves what is not saved yet. Resolves with the saved paths and any @references to
  // rename, or undefined if a file could not be saved (the others stay saved).
  const save = async (): Promise<SavedAttachments | undefined> => {
    const csrf = options.csrf();

    if (!csrf) return undefined;
    setSaving(true);
    setProblem("");

    try {
      for (const item of items()) {
        if (item.path) continue;
        const target = planned(item);
        const path = await uploadFile(csrf, target, item.file, "unique");
        setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, path, planned: target } : entry));
      }

      const renames = new Map<string, string>();
      const paths: string[] = [];

      for (const item of items()) {
        if (!item.path) continue;
        paths.push(item.path);

        // A name taken meanwhile was saved as the next free one.
        if (item.planned && item.path !== item.planned) renames.set(item.planned, item.path);
      }

      setItems([]);

      return { paths, renames };
    } catch (error) {
      setProblem(`${error instanceof Error ? error.message : "The upload failed."} Your message was not sent.`);

      return undefined;
    } finally { setSaving(false); }
  };

  return { items, saving, problem, add, remove, save, paths: () => items().map((item) => item.path ?? planned(item)) };
}

export type Attachments = ReturnType<typeof createAttachments>;

export function AttachmentList(props: { attachments: Attachments; disabled: boolean }) {
  return <>
    <Show when={props.attachments.items().length > 0}><ul class="attachment-chips" aria-label="Selected attachments">
      <For each={props.attachments.items()}>{(item) => <li>
        <span title={item.file.name}>{item.file.name}</span><span class="muted">{sizeLabel(item.file.size)}</span>
        <button type="button" aria-label={`Remove ${item.file.name}`} disabled={props.disabled || props.attachments.saving()} onClick={() => props.attachments.remove(item.key)}>×</button>
      </li>}</For>
    </ul></Show>
    <Show when={props.attachments.problem()}><p class="composer-problem" role="alert">{props.attachments.problem()}</p></Show>
  </>;
}

export function AttachButton(props: { attachments: Attachments; disabled: boolean }) {
  let picker: HTMLInputElement | undefined;

  return <>
    <button type="button" class="composer-tool" aria-label="Attach files" title={`Attach files (saved to ${attachmentsDirectory}/ when you send)`}
      disabled={props.disabled || props.attachments.saving()} onClick={() => picker?.click()}>+ File</button>
    <input type="file" multiple hidden ref={(element) => { picker = element; }} onChange={(event) => { props.attachments.add([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
  </>;
}
