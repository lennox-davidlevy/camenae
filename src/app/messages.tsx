/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { Activity, Retry, Turn } from "../chat-contract.js";
import { NativeApproval } from "./approvals.js";
import { Markdown } from "./markdown.js";
import "../ui/active-chat.css";

function ToolActivity(props: { tool: Activity }) {
  return <details class="tool-activity">
    <summary><span>{props.tool.title}</span><span class="tool-activity-status">{props.tool.status}</span><span class="tool-activity-toggle" aria-hidden="true">⌄</span></summary>
    <div class="tool-activity-details"><p>Reported status: <strong>{props.tool.status}</strong></p><p>Arguments, output, and timing are not available in this chat view.</p></div>
  </details>;
}

// Plain text, never Markdown: reasoning is the model's working, shown only on request.
function Reasoning(props: { turn: Turn }) {
  const thinking = () => props.turn.status === "running" && !props.turn.answer;

  return <details class="tool-activity chat-reasoning">
    <summary><span>Thinking</span><span class="tool-activity-status">{thinking() ? "in progress" : "done"}</span><span class="tool-activity-toggle" aria-hidden="true">⌄</span></summary>
    <div class="tool-activity-details"><p class="chat-reasoning-text">{props.turn.reasoning}</p></div>
  </details>;
}

const retryReasons = {
  "rate-limit": "too many requests", "provider-internal": "provider error", transport: "connection problem", timeout: "timed out",
  "invalid-output": "unreadable reply", auth: "sign-in problem", quota: "quota reached", "content-filter": "content filter",
  "invalid-request": "request refused", unknown: "unknown problem",
} satisfies Record<Retry["category"], string>;

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

function RetryNotice(props: { retry: Retry }) {
  const reason = () => `${retryReasons[props.retry.category]}${props.retry.status === undefined ? "" : `, ${props.retry.status}`}`;

  return <p class="chat-turn-notice" role="status">The provider asked to wait ({reason()}). Trying again at {clock.format(props.retry.at)}, attempt {props.retry.attempt}.</p>;
}

interface MessagesProps {
  turns: readonly Turn[];
  pending: boolean;
  onApprove: (turn: Turn, optionId: string | null) => void;
}

export function Messages(props: MessagesProps) {
  return <For each={props.turns}>{(turn) => <>
    <div class="chat-user-message"><span class="chat-user-label">You</span><div class="chat-user-text"><p>{turn.prompt}</p></div>
      <Show when={turn.attachments.length > 0}><ul class="chat-user-attachments" aria-label="Sent attachments">
        <For each={turn.attachments}>{(file) => <li title={file.path}>{file.path.split("/").at(-1)}</li>}</For>
      </ul></Show>
    </div>
    <div class="chat-assistant-message">
      <div class="chat-assistant-label">Assistant · Turn {turn.ordinal} · {turn.status}{turn.activity.length > 0 && ` · ${turn.activity.length} tool calls`}</div>
      <Show when={turn.reasoning}><Reasoning turn={turn} /></Show>
      <For each={turn.activity}>{(tool) => <ToolActivity tool={tool} />}</For>
      <Show when={turn.status === "running" ? turn.retry : null}>{(retry) => <RetryNotice retry={retry()} />}</Show>
      <Show when={turn.answer}><Markdown text={turn.answer} /></Show>
      <Show when={!turn.answer}><p class="chat-turn-notice">{turn.status === "running" ? "Waiting for response text…" : "No response text was returned."}</p></Show>
      <Show when={turn.stop_reason}><p class="chat-turn-notice">Stop reason: {turn.stop_reason}</p></Show>
      <NativeApproval turn={turn} pending={props.pending} onApprove={props.onApprove} />
    </div>
  </>}</For>;
}
