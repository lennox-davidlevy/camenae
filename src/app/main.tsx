/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Match } from "effect";
import { render } from "solid-js/web";
import type { AppSummary } from "../apps-contract.js";
import { AppScreen } from "./app-view.js";
import { listApps } from "./apps-api.js";
import { ChatPane } from "./chat-pane.js";
import { createChatSession } from "./chat-session.js";
import { consoleExhausted } from "../console-contract.js";
import { mention } from "./file-search.js";
import { FileInspector, FilesScreen } from "./files-view.js";
import { createFiles } from "./files-state.js";
import { RequestLimitNotice, SettingsInspector, SettingsPage } from "./settings.js";
import { Shell, type Screen } from "./shell.js";
import { createSkills, SkillsInspector, SkillsScreen } from "./skills.js";
import { SessionUsagePanel } from "./usage.js";
import "../ui/theme.css";
import "../ui/layout-shell.css";
import "./app.css";

const contentClass = (screen: Screen) => Match.value(screen).pipe(
  Match.when("Chat", () => "shell-content shell-content-active"),
  Match.when("Settings", () => "shell-content shell-content-settings"),
  Match.when("Files", () => "shell-content shell-content-files"),
  Match.when("Skills", () => "shell-content shell-content-skills"),
  Match.orElse(() => "shell-content shell-content-app"),
);

function App() {
  const session = createChatSession();
  const [screen, setScreen] = createSignal<Screen>("Chat");
  const [apps, setApps] = createSignal<readonly AppSummary[]>([]);
  const [insertion, setInsertion] = createSignal<{ text: string; nonce: number }>();
  const files = createFiles({ csrf: () => session.bootstrap()?.csrf, active: () => screen() === "Files" });
  const skills = createSkills({ csrf: () => session.bootstrap()?.csrf, active: () => screen() === "Skills" });

  // "Ask about this file": the reference goes into the message being written.
  const ask = (path: string) => {
    setInsertion({ text: `${mention(path)} `, nonce: Date.now() });
    setScreen("Chat");
  };

  const current = createMemo(() => session.conversations().find((item) => item.id === session.conversation()));
  const latest = createMemo(() => session.view()?.turns.at(-1));
  const approvals = createMemo(() => session.view()?.turns.filter((turn) => turn.permission).length ?? 0);

  const exhausted = createMemo(() => {
    const usage = session.bootstrap()?.consoleUsage;

    return usage && consoleExhausted(usage) ? usage : undefined;
  });

  const openApp = createMemo(() => {
    const current = screen();

    return apps().find((app) => current === `app:${app.id}`);
  });

  onMount(() => {
    void session.start();
    // Apps are optional: if the list cannot load, the shell works without them.
    listApps().then(setApps, () => setApps([]));
  });

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

  const rail = () => Match.value(screen()).pipe(
    Match.when("Settings", () => <SettingsInspector />),
    Match.when("Files", () => <FileInspector files={files} onAsk={ask} />),
    Match.when("Skills", () => <SkillsInspector skills={skills} />),
    Match.when("Chat", () => inspector),
    Match.orElse(() => <div class="app-inspector"><section><h2>App</h2><p>{openApp()?.name}</p>
      <small>Changes save as you make them. The assistant cannot work with apps yet.</small></section></div>),
  );

  return <Shell screen={screen()} onScreen={setScreen} apps={apps()} conversations={session.conversations()} selected={session.conversation()}
    onSelect={(id) => { setScreen("Chat"); void session.select(id); }} onNew={() => { setScreen("Chat"); void session.create(); }}
    newDisabled={!session.idle() || !session.bootstrap()?.readiness.opencode} selectionDisabled={session.pending() || session.preparing()}
    inspector={rail()}>
    <div class={contentClass(screen())}>
      <Show when={session.error()}><p role="alert" class="app-error">{session.error()}</p></Show>
      <Show when={screen() === "Chat" ? exhausted() : undefined}>{(usage) => <RequestLimitNotice usage={usage()}><button onClick={() => setScreen("Settings")}>Open Settings</button></RequestLimitNotice>}</Show>
      <div hidden={screen() !== "Chat"} class="chat-screen-wrap"><ChatPane session={session} insertion={insertion()} /></div>
      <Show when={screen() === "Files"}><FilesScreen files={files} /></Show>
      <Show when={screen() === "Settings" ? session.bootstrap() : undefined}>{(state) =>
        <SettingsPage csrf={state().csrf} usage={state().consoleUsage} onChanged={session.refreshStatus} />}</Show>
      <Show when={screen() === "Skills"}><SkillsScreen skills={skills} /></Show>
      <Show when={openApp()?.id} keyed>{(id) => <AppScreen id={id} csrf={() => session.bootstrap()?.csrf} onBack={() => setScreen("Chat")} />}</Show>
    </div>
  </Shell>;
}

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

render(() => <App />, root);
