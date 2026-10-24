import { useId, type ReactNode } from "react";
import type { Conversation } from "../chat-contract.js";
import { ThreadList } from "./thread-list.js";
import { usePanelSizes } from "./panel-sizes.js";
import "./layout-shell.css";

const screens = ["Chat", "Skills", "Files", "Settings"] as const;

export type Screen = typeof screens[number];

export function LayoutShell({ screen, onScreen, conversations, selected, onSelect, onNew, newDisabled, selectionDisabled, inspector, children }: {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  conversations: readonly Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  newDisabled: boolean;
  selectionDisabled: boolean;
  inspector: ReactNode;
  children: ReactNode;
}) {
  const panels = usePanelSizes();
  const id = useId();

  const separator = (side: "left" | "right") => <div role="separator" aria-orientation="vertical" tabIndex={0}
    className={`panel-resizer panel-resizer-${side}`} aria-label={side === "left" ? "Resize threads panel" : "Resize inspector panel"}
    aria-controls={`${id}-${side}`} aria-valuemin={panels.minimum[side]} aria-valuemax={panels.maximum[side]} aria-valuenow={panels[side]}
    title="Drag or use arrow keys to resize. Double-click to reset."
    onKeyDown={(event) => panels.keyboard(side, event)} onDoubleClick={() => panels.reset(side)}
    onPointerDown={(event) => panels.pointerDown(side, event)} onPointerMove={panels.pointerMove}
    onPointerUp={panels.endDrag} onPointerCancel={panels.endDrag} onLostPointerCapture={panels.endDrag} />;

  return <div className={`app-shell${panels.dragging ? " app-shell-resizing" : ""}`}>
    <header className="masthead">
      <div className="masthead-brand"><span className="masthead-wordmark">Camenae</span><span className="masthead-motto"><i />Fons · Consilium</span></div>
      <nav className="masthead-nav" aria-label="Main navigation">{screens.map((name, index) => <button key={name} aria-current={screen === name ? "page" : undefined} onClick={() => onScreen(name)}><span>{["I", "II", "III", "IV"][index]}</span>{name}</button>)}</nav>
      <div className="masthead-actions"><button className="masthead-new" disabled={newDisabled} onClick={onNew}><span>+</span>New Chat</button></div>
    </header>
    <div className="shell-columns" ref={panels.container} style={{ gridTemplateColumns: panels.columns }}>
      <aside className="thread-sidebar" id={`${id}-left`} aria-label="Conversation sidebar">
        <div className="thread-sidebar-label">⁚ <span>Threads</span></div>
        <ThreadList conversations={conversations} selected={selected} disabled={selectionDisabled} onSelect={onSelect} />
        <div className="thread-sidebar-footer"><a href="/auth/password">Account</a></div>
      </aside>
      {separator("left")}
      <main className="shell-center">{children}</main>
      {separator("right")}
      <aside className="shell-inspector" id={`${id}-right`} aria-label="Inspector">{inspector}</aside>
    </div>
  </div>;
}
