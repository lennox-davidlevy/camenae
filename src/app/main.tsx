/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { ChatPane } from "./chat-pane.js";
import { createChatSession } from "./chat-session.js";
import { Shell, type Screen } from "./shell.js";
import "../ui/theme.css";
import "../ui/layout-shell.css";
import "./app.css";

const notes = {
  Skills: "Skills are not built in this view yet.",
  Files: "Files are not built in this view yet. The working file browser is inside Classic chat.",
  Settings: "Settings are not built in this view yet. They remain inside Classic chat, including connection setup.",
} as const;

const noteFor = (screen: Screen) => screen === "Chat" ? undefined : notes[screen];

function App() {
  const session = createChatSession();
  const [screen, setScreen] = createSignal<Screen>("Chat");
  const current = createMemo(() => session.conversations().find((item) => item.id === session.conversation()));
  const latest = createMemo(() => session.view()?.turns.at(-1));
  const approvals = createMemo(() => session.view()?.turns.filter((turn) => turn.permission).length ?? 0);

  onMount(() => void session.start());

  const inspector = <div class="active-chat-inspector">
    <section><h2>Thread</h2><Show when={current()} fallback={<p>Select a thread to see its details.</p>}>
      {(item) => <><p>{item().title}</p><small>{item().harness} · {item().toolCount} tool calls</small></>}
    </Show></section>
    <section><h2>Tools · latest turn</h2><Show when={latest()?.activity.length} fallback={<p>No tool activity reported.</p>}>
      <ul class="chat-inspector-tools"><For each={latest()?.activity}>{(tool) => <li><span>{tool.title}</span><small>{tool.status}</small></li>}</For></ul>
    </Show></section>
    <section><h2>Approvals</h2><p>{approvals() > 0 ? `${approvals()} waiting in this conversation` : "No pending requests"}</p><small>Authorization does not confirm execution.</small></section>
  </div>;

  return <Shell screen={screen()} onScreen={setScreen} conversations={session.conversations()} selected={session.conversation()}
    onSelect={(id) => { setScreen("Chat"); void session.select(id); }} onNew={() => { setScreen("Chat"); void session.create(); }}
    newDisabled={!session.idle() || !session.bootstrap()?.readiness.opencode} selectionDisabled={session.pending() || session.preparing()}
    inspector={inspector}>
    <div class={screen() === "Chat" ? "shell-content shell-content-active" : "shell-content"}>
      <Show when={session.error()}><p role="alert" class="app-error">{session.error()}</p></Show>
      <div hidden={screen() !== "Chat"} class="chat-screen-wrap"><ChatPane session={session} /></div>
      <Show when={noteFor(screen())}>{(note) => <>
        <h1 class="shell-screen-title">{screen()}</h1>
        <div class="app-notice"><span class="tag">Preview shell</span><p>{note()}</p></div>
      </>}</Show>
    </div>
  </Shell>;
}

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

render(() => <App />, root);
