/** @jsxImportSource solid-js */
import { createEffect, createSignal, on } from "solid-js";

interface ComposerProps {
  conversation?: string;
  disabled: boolean;
  running: boolean;
  busy: boolean;
  drafts: Map<string, string>;
  onSend: (prompt: string) => void;
  onStop: () => void;
}

export function Composer(props: ComposerProps) {
  const [text, setText] = createSignal("");
  let input: HTMLTextAreaElement | undefined;

  // Drafts live in this page's memory only, one per conversation.
  createEffect(on(() => props.conversation, (id) => setText(id ? props.drafts.get(id) ?? "" : "")));

  createEffect(() => {
    text();

    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  });

  const remember = (value: string) => {
    setText(value);

    if (!props.conversation) return;

    if (value) props.drafts.set(props.conversation, value);
    else props.drafts.delete(props.conversation);
  };

  const submit = () => {
    const prompt = text().trim();

    if (!prompt || props.disabled || props.running) return;
    remember("");
    props.onSend(prompt);
  };

  return <form class="active-chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <textarea ref={(element) => { input = element; }} value={text()} rows={1} placeholder="Reply…" aria-label="Message Camenae" maxLength={8000}
      onInput={(event) => remember(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } }} />
    <div class="active-chat-composer-actions">
      <button type="submit" class="active-chat-send" disabled={props.disabled || props.running || !text().trim()}>Send</button>
      <button type="button" class="active-chat-stop" disabled={!props.running || props.busy} onClick={props.onStop}>Stop</button>
    </div>
  </form>;
}
