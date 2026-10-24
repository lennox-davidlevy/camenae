/** @jsxImportSource solid-js */
import { createEffect, createSignal, on } from "solid-js";
import { AttachButton, AttachmentList, createAttachments } from "./attachments.js";
import { renameMentions } from "./file-search.js";
import { createMentions, MentionMenu } from "./mentions.js";
import { createWorkspacePaths } from "./workspace-paths.js";

interface ComposerProps {
  conversation?: string;
  csrf?: string;
  disabled: boolean;
  running: boolean;
  busy: boolean;
  drafts: Map<string, string>;
  insertion?: { text: string; nonce: number };
  onSend: (prompt: string, attachments: readonly string[]) => void;
  onStop: () => void;
}

// Keys the @ menu handles itself; every other key may change what is being typed.
const menuKeys = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"];

export function Composer(props: ComposerProps) {
  const [text, setText] = createSignal("");
  const workspace = createWorkspacePaths();
  let input: HTMLTextAreaElement | undefined;

  const remember = (value: string) => {
    setText(value);

    if (!props.conversation) return;

    if (value) props.drafts.set(props.conversation, value);
    else props.drafts.delete(props.conversation);
  };

  const attachments = createAttachments({ csrf: () => props.csrf, taken: workspace.paths, refresh: () => void workspace.load() });
  const mentions = createMentions({ workspace, setText: remember, attached: attachments.paths });

  // Drafts live in this page's memory only, one per conversation.
  createEffect(on(() => props.conversation, (id) => setText(id ? props.drafts.get(id) ?? "" : "")));

  // Text pushed in from elsewhere (the Files screen) joins the message being written.
  createEffect(on(() => props.insertion?.nonce, () => {
    const added = props.insertion?.text;

    if (!added) return;
    const current = text();
    remember(`${current}${current && !/\s$/.test(current) ? " " : ""}${added}`);
    queueMicrotask(() => input?.focus());
  }, { defer: true }));

  createEffect(() => {
    text();

    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  });

  const blocked = () => props.disabled || props.running || attachments.saving();

  // Attached files are saved first; if one cannot be, the message stays in the box.
  const submit = async () => {
    const prompt = text().trim();

    if (!prompt || blocked()) return;
    const saved = attachments.items().length > 0 ? await attachments.save() : { paths: [], renames: new Map<string, string>() };

    if (!saved) return;
    remember("");
    mentions.close();
    props.onSend(renameMentions(prompt, saved.renames), saved.paths);
  };

  return <>
    <AttachmentList attachments={attachments} disabled={blocked()} />
    <form class="active-chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea {...mentions.field()} ref={(element) => { input = element; mentions.bind(element); }} value={text()} rows={1} placeholder="Reply…" aria-label="Message Camenae" maxLength={8000}
        onInput={(event) => { remember(event.currentTarget.value); mentions.update(); }}
        onKeyUp={(event) => { if (!menuKeys.includes(event.key)) mentions.update(); }}
        onClick={() => mentions.update()} onBlur={() => mentions.close()}
        onKeyDown={(event) => {
          if (mentions.keyDown(event)) return;

          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submit();
          }
        }} />
      <div class="active-chat-composer-actions">
        <AttachButton attachments={attachments} disabled={props.disabled || props.running} />
        <button type="button" class="composer-tool" aria-label="Reference a workspace file" title="Reference a workspace file (@)" disabled={props.disabled || props.running} onClick={() => mentions.start()}>@</button>
        <button type="submit" class="active-chat-send" disabled={blocked() || !text().trim()}>{attachments.saving() ? "Saving…" : "Send"}</button>
        <button type="button" class="active-chat-stop" disabled={!props.running || props.busy} onClick={props.onStop}>Stop</button>
      </div>
    </form>
    <MentionMenu mentions={mentions} />
  </>;
}
