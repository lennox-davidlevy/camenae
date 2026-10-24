/** @jsxImportSource solid-js */
import { For, Show, type JSX } from "solid-js";
import type { Turn } from "../chat-contract.js";
import "../ui/chat-approvals.css";

interface ApprovalCardProps {
  title: string;
  label: string;
  children: JSX.Element;
}

function ApprovalCard(props: ApprovalCardProps) {
  return <section class="approval-card" aria-label={props.label}>
    <header><h3>Approval Required · {props.title}</h3><span>Waiting on you</span></header>
    <div class="approval-card-body">{props.children}</div>
  </section>;
}

interface NativeApprovalProps {
  turn: Turn;
  pending: boolean;
  onApprove: (turn: Turn, optionId: string | null) => void;
}

export function NativeApproval(props: NativeApprovalProps) {
  return <Show when={props.turn.permission}>{(permission) => <ApprovalCard title={permission().title} label={`Permission request for turn ${props.turn.ordinal}`}>
    <p>The assistant is requesting permission. Reported category: <strong>{permission().kind ?? "unknown"}</strong>.</p>
    <For each={permission().resources}>{(resource) => <pre>{resource}</pre>}</For>
    <Show when={permission().detailsTruncated}><p>Authorization details exceed the display limit. This request can only be rejected; no undisclosed operations can be approved here.</p></Show>
    <p class="approval-explanation">This decision applies once. Persistent preferences are managed in Settings. No separate file diff or command preview is provided.</p>
    <div class="approval-actions">
      <For each={permission().options}>{(option) => <button class={option.kind === "allow_once" ? "approval-primary" : undefined} disabled={props.pending} onClick={() => props.onApprove(props.turn, option.optionId)}>{option.name}</button>}</For>
      <button disabled={props.pending} onClick={() => props.onApprove(props.turn, null)}>Cancel this tool request</button>
    </div>
  </ApprovalCard>}</Show>;
}
