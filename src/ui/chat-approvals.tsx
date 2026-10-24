import type { ReactNode } from "react";
import type { Turn } from "../chat-contract.js";
import "./chat-approvals.css";

function ApprovalCard({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return <section className="approval-card" aria-label={label}>
    <header><h3>Approval Required · {title}</h3><span>Waiting on you</span></header>
    <div className="approval-card-body">{children}</div>
  </section>;
}

export function NativeApproval({ turn, pending, onApprove }: {
  turn: Turn;
  pending: boolean;
  onApprove: (turn: Turn, optionId: string | null) => void;
}) {
  const permission = turn.permission;

  if (!permission) return null;

  return <ApprovalCard title={permission.title} label={`Permission request for turn ${turn.ordinal}`}>
    <p>The assistant is requesting permission. Reported category: <strong>{permission.kind ?? "unknown"}</strong>.</p>
    {permission.resources?.map((resource, index) => <pre key={index}>{resource}</pre>)}
    {permission.detailsTruncated && <p>Authorization details exceed the display limit. This request can only be rejected; no undisclosed operations can be approved here.</p>}
    <p className="approval-explanation">This decision applies once. Persistent preferences are managed in Settings. No separate file diff or command preview is provided.</p>
    <div className="approval-actions">
      {permission.options.map((option) => <button key={option.optionId} className={option.kind === "allow_once" ? "approval-primary" : undefined} disabled={pending} onClick={() => onApprove(turn, option.optionId)}>{option.name}</button>)}
      <button disabled={pending} onClick={() => onApprove(turn, null)}>Cancel this tool request</button>
    </div>
  </ApprovalCard>;
}
