import type { ReactNode } from "react";
import "./layout-shell.css";

const screens = ["Chat", "Skills", "Files", "Settings"] as const;

export type Screen = typeof screens[number];

export function LayoutShell({ screen, onScreen, conversations, selected, onSelect, onNew, newDisabled, selectionDisabled, inspector, children }: {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  conversations: readonly { id: string; title: string }[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  newDisabled: boolean;
  selectionDisabled: boolean;
  inspector: ReactNode;
  children: ReactNode;
}) {
  return <div className="app-shell">
    <header className="masthead">
      <div className="masthead-brand"><span className="masthead-wordmark">Camenae</span><span className="masthead-motto"><i />Fons · Consilium</span></div>
      <nav className="masthead-nav" aria-label="Main navigation">{screens.map((name, index) => <button key={name} aria-current={screen === name ? "page" : undefined} onClick={() => onScreen(name)}><span>{["I", "II", "III", "IV"][index]}</span>{name}</button>)}</nav>
      <div className="masthead-actions"><div className="masthead-model" title="The connected harness does not report the model name"><span>Model</span><span>Not reported</span></div><button className="masthead-new" disabled={newDisabled} onClick={onNew}><span>+</span>New Chat</button></div>
    </header>
    <div className="shell-columns">
      <aside className="thread-sidebar" aria-label="Conversation sidebar">
        <div className="thread-sidebar-label">⁚ <span>Threads</span></div>
        <nav className="thread-list" aria-label="Conversations"><div className="thread-group"><div className="thread-group-label">Conversations</div>{conversations.map((item) => <button key={item.id} disabled={selectionDisabled} aria-current={item.id === selected ? "true" : undefined} onClick={() => onSelect(item.id)}>{item.title}</button>)}{conversations.length === 0 && <p>No conversations yet.</p>}</div></nav>
        <div className="thread-sidebar-footer"><a href="/">Connection &amp; account</a></div>
      </aside>
      <main className="shell-center">{children}</main>
      <aside className="shell-inspector" aria-label="Inspector">{inspector}</aside>
    </div>
  </div>;
}
