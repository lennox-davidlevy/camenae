/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Match } from "effect";
import { render } from "solid-js/web";
import { ChatPane } from "./chat-pane.js";
import { createChatSession } from "./chat-session.js";
import { consoleExhausted } from "../console-contract.js";
import { RequestLimitNotice, SettingsInspector, SettingsPage } from "./settings.js";
import { Shell, type Screen } from "./shell.js";
import { SessionUsagePanel } from "./usage.js";
import "../ui/theme.css";
import "../ui/layout-shell.css";
import "./app.css";

const notes = {
  Skills: "Skills are not built in this view yet.",
  Files: "Files are not built in this view yet. The working file browser is inside Classic chat.",
} as const;

const contentClass = (screen: Screen) => Match.value(screen).pipe(
  Match.when("Chat", () => "shell-content shell-content-active"),
  Match.when("Settings", () => "shell-content shell-content-settings"),
  Match.orElse(() => "shell-content"),
);

const noteFor = (screen: Screen) => screen === "Chat" || screen === "Settings" ? undefined : notes[screen];

function App() {
  const session = createChatSession();
  const [screen, setScreen] = createSignal<Screen>("Chat");
  const current = createMemo(() => session.conversations().find((item) => item.id === session.conversation()));
  const latest = createMemo(() => session.view()?.turns.at(-1));
  const approvals = createMemo(() => session.view()?.turns.filter((turn) => turn.permission).length ?? 0);

  const exhausted = createMemo(() => {
    const usage = session.bootstrap()?.consoleUsage;

    return usage && consoleExhausted(usage) ? usage : undefined;
  });

  onMount(() => void session.start());

  const inspector = <div class="active-chat-inspector">
    <SessionUsagePanel usage={session.view()?.usage} />
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
    inspector={screen() === "Settings" ? <SettingsInspector /> : inspector}>
    <div class={contentClass(screen())}>
      <Show when={session.error()}><p role="alert" class="app-error">{session.error()}</p></Show>
      <Show when={screen() === "Chat" ? exhausted() : undefined}>{(usage) => <RequestLimitNotice usage={usage()}><button onClick={() => setScreen("Settings")}>Open Settings</button></RequestLimitNotice>}</Show>
      <div hidden={screen() !== "Chat"} class="chat-screen-wrap"><ChatPane session={session} /></div>
      <Show when={screen() === "Settings" ? session.bootstrap() : undefined}>{(state) =>
        <SettingsPage csrf={state().csrf} usage={state().consoleUsage} onChanged={session.refreshStatus} />}</Show>
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
