/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { Activity, Turn } from "../chat-contract.js";
import { NativeApproval } from "./approvals.js";
import { Markdown } from "./markdown.js";
import "../ui/active-chat.css";

function ToolActivity(props: { tool: Activity }) {
  return <details class="tool-activity">
    <summary><span>{props.tool.title}</span><span class="tool-activity-status">{props.tool.status}</span><span class="tool-activity-toggle" aria-hidden="true">⌄</span></summary>
    <div class="tool-activity-details"><p>Reported status: <strong>{props.tool.status}</strong></p><p>Arguments, output, and timing are not available in this chat view.</p></div>
  </details>;
}

interface MessagesProps {
  turns: readonly Turn[];
  pending: boolean;
  onApprove: (turn: Turn, optionId: string | null) => void;
}

export function Messages(props: MessagesProps) {
  return <For each={props.turns}>{(turn) => <>
    <div class="chat-user-message"><span class="chat-user-label">You</span><div class="chat-user-text"><p>{turn.prompt}</p></div></div>
    <div class="chat-assistant-message">
      <div class="chat-assistant-label">Assistant · Turn {turn.ordinal} · {turn.status}{turn.activity.length > 0 && ` · ${turn.activity.length} tool calls`}</div>
      <For each={turn.activity}>{(tool) => <ToolActivity tool={tool} />}</For>
      <Show when={turn.answer}><Markdown text={turn.answer} /></Show>
      <Show when={!turn.answer}><p class="chat-turn-notice">{turn.status === "running" ? "Waiting for response text…" : "No response text was returned."}</p></Show>
      <Show when={turn.stop_reason}><p class="chat-turn-notice">Stop reason: {turn.stop_reason}</p></Show>
      <NativeApproval turn={turn} pending={props.pending} onApprove={props.onApprove} />
    </div>
  </>}</For>;
}
