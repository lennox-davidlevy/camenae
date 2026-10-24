/** @jsxImportSource solid-js */
import { createMemo, createResource, createSignal, Match, Show, Switch } from "solid-js";
import { render } from "solid-js/web";
import { z } from "zod";
import { Conversation } from "../chat-contract.js";
import { Shell, type Screen } from "./shell.js";
import "../ui/theme.css";
import "../ui/layout-shell.css";
import "./app.css";

const Bootstrap = z.object({ conversations: z.array(Conversation) });

const loadConversations = async () => {
  const response = await fetch("/api/chat", { headers: { accept: "application/json" } });

  if (!response.ok) throw new Error(`Could not load conversations (HTTP ${response.status}).`);

  return Bootstrap.parse(await response.json()).conversations;
};

const notes: Record<Screen, string> = {
  Chat: "Reading and sending messages is not built in this view yet. The working chat is still at /chat.",
  Skills: "Skills are not built in this view yet.",
  Files: "Files are not built in this view yet. The working file browser is inside /chat.",
  Settings: "Settings are not built in this view yet. They remain inside /chat.",
};

function App() {
  const [conversations] = createResource(loadConversations);
  const [screen, setScreen] = createSignal<Screen>("Chat");
  const [selected, setSelected] = createSignal<string>();
  const list = createMemo(() => conversations() ?? []);
  const current = createMemo(() => list().find((item) => item.id === selected()));

  return <Shell screen={screen()} onScreen={setScreen} conversations={list()} selected={selected()} onSelect={setSelected}
    inspector={<Show when={current()} fallback={<section><h2>Thread</h2><p>Select a thread to see its details.</p></section>}>
      {(item) => <section><h2>Thread</h2><p>{item().title}</p><small>{item().harness} · {item().toolCount} tool calls</small></section>}
    </Show>}>
    <div class="shell-content">
      <h1 class="shell-screen-title">{screen()}</h1>
      <div class="app-notice">
        <span class="tag">Preview shell</span>
        <p>{notes[screen()]}</p>
        <Switch>
          <Match when={conversations.error}><p class="app-error" role="alert">{conversations.error instanceof Error ? conversations.error.message : "Could not load conversations."}</p></Match>
          <Match when={conversations.loading}><p>Loading threads…</p></Match>
        </Switch>
      </div>
    </div>
  </Shell>;
}

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

render(() => <App />, root);
