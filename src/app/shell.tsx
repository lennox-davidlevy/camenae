/** @jsxImportSource solid-js */
import { createUniqueId, For, type JSX } from "solid-js";
import type { Conversation } from "../chat-contract.js";
import { createPanelSizes, type Side } from "./panel-sizes.js";
import { ThreadList } from "./threads.js";

export const screens = ["Chat", "Skills", "Files", "Settings"] as const;

export type Screen = typeof screens[number];

interface ShellProps {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  conversations: readonly Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  newDisabled: boolean;
  selectionDisabled: boolean;
  inspector: JSX.Element;
  children: JSX.Element;
}

export function Shell(props: ShellProps) {
  const panels = createPanelSizes();
  const id = createUniqueId();

  const separator = (side: Side) => <div role="separator" aria-orientation="vertical" tabIndex={0}
    class={`panel-resizer panel-resizer-${side}`} aria-label={side === "left" ? "Resize threads panel" : "Resize inspector panel"}
    aria-controls={`${id}-${side}`} aria-valuemin={panels.minimum[side]} aria-valuemax={panels.maximum()[side]} aria-valuenow={side === "left" ? panels.left() : panels.right()}
    title="Drag or use arrow keys to resize. Double-click to reset."
    onKeyDown={(event) => panels.keyboard(side, event)} onDblClick={() => panels.reset(side)}
    onPointerDown={(event) => panels.pointerDown(side, event)} onPointerMove={panels.pointerMove}
    onPointerUp={panels.endDrag} onPointerCancel={panels.endDrag} onLostPointerCapture={panels.endDrag} />;

  return <div class={panels.dragging() ? "app-shell app-shell-resizing" : "app-shell"}>
    <header class="masthead">
      <div class="masthead-brand"><span class="masthead-wordmark">Camenae</span><span class="masthead-motto"><i />Fons · Consilium</span></div>
      <nav class="masthead-nav" aria-label="Main navigation">
        <For each={screens}>{(name, index) => <button aria-current={props.screen === name ? "page" : undefined} onClick={() => props.onScreen(name)}>
          <span>{["I", "II", "III", "IV"][index()]}</span>{name}
        </button>}</For>
      </nav>
      <div class="masthead-actions"><button class="masthead-new" disabled={props.newDisabled} onClick={props.onNew}><span>+</span>New Chat</button></div>
    </header>
    <div class="shell-columns" ref={panels.setContainer} style={{ "grid-template-columns": panels.columns() }}>
      <aside class="thread-sidebar" id={`${id}-left`} aria-label="Conversation sidebar">
        <div class="thread-sidebar-label">⁚ <span>Threads</span></div>
        <ThreadList conversations={props.conversations} selected={props.selected} disabled={props.selectionDisabled} onSelect={props.onSelect} />
        <div class="thread-sidebar-footer"><a href="/auth/password">Account</a></div>
      </aside>
      {separator("left")}
      <main class="shell-center">{props.children}</main>
      {separator("right")}
      <aside class="shell-inspector" id={`${id}-right`} aria-label="Inspector">{props.inspector}</aside>
    </div>
  </div>;
}
