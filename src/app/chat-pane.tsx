/** @jsxImportSource solid-js */
import { createEffect, on, Show } from "solid-js";
import type { createChatSession } from "./chat-session.js";
import { Composer } from "./composer.js";
import { Messages } from "./messages.js";
import { ModelPicker } from "./model-picker.js";
import { SessionUsagePanel } from "./usage.js";
import { createStickToBottom } from "./stick-to-bottom.js";

interface ChatPaneProps {
  session: ReturnType<typeof createChatSession>;
  insertion?: { text: string; nonce: number };
}

export function ChatPane(props: ChatPaneProps) {
  const session = props.session;
  const scroll = createStickToBottom();

  // Opening a conversation and sending a message both resume following the newest content.
  createEffect(on(() => session.view()?.conversation.id, () => scroll.follow(), { defer: true }));

  const status = () => session.preparing() ? "Preparing conversation…" : session.running() ? "Working"
    : !session.configured() ? "Connection not set up." : session.ready() ? "Camenae is ready." : "Conversation not ready.";

  return <div class="chat-screen-active">
    <Show when={session.view()?.model}>{(model) => <ModelPicker model={model()} disabled={!session.idle()} onSelect={(selected) => void session.selectModel(selected)} />}</Show>
    <details class="chat-usage-inline"><summary>Context &amp; session usage</summary><SessionUsagePanel usage={session.view()?.usage} /></details>
    <div class="active-chat">
      <div class="active-chat-viewport" ref={scroll.ref}>
        <div class="active-chat-heading">
          <div><span class="active-chat-chip">Conversation</span><span class="active-chat-connection" role="status">{status()}</span>
            <button disabled={session.pending() || session.preparing()} onClick={() => void session.reconnect()}>Reconnect / refresh</button></div>
          <h1>{session.view()?.conversation.title ?? "Conversation"}</h1>
        </div>
        <div class="active-chat-timeline">
          <Show when={session.view()} fallback={<p class="chat-turn-notice">{session.conversation() ? "Loading conversation…" : "Select a thread or start a new chat."}</p>}>
            {(view) => <>
              <Messages turns={view().turns} pending={session.pending()} onApprove={(turn, optionId) => void session.approveNative(turn, optionId)} />
              <Show when={view().turns.length === 0}><p class="chat-turn-notice">No messages yet.</p></Show>
            </>}
          </Show>
        </div>
      </div>
      <Show when={scroll.unseen()}><button class="chat-jump" onClick={scroll.jump}>New messages ↓</button></Show>
      <div class="active-chat-composer-dock">
        <Composer conversation={session.conversation()} csrf={session.bootstrap()?.csrf} insertion={props.insertion} drafts={session.drafts} disabled={!session.conversation() || !session.configured() || session.ready() !== session.conversation() || session.pending() || session.preparing()}
          running={Boolean(session.running())} busy={session.pending()} onSend={(prompt, attachments) => { scroll.follow(); void session.send(prompt, attachments); }} onStop={() => void session.cancel()} />
      </div>
    </div>
  </div>;
}
