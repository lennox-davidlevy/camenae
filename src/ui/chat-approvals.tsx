import type { ReactNode } from "react";
import type { ChatView, Turn } from "../chat-contract.js";
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
    <p className="approval-explanation">This decision applies once. Persistent preferences are managed in Settings. No separate file diff or command preview is provided.</p>
    <div className="approval-actions">
      {permission.options.map((option) => <button key={option.optionId} className={option.kind === "allow_once" ? "approval-primary" : undefined} disabled={pending} onClick={() => onApprove(turn, option.optionId)}>{option.name}</button>)}
      <button disabled={pending} onClick={() => onApprove(turn, null)}>Cancel this tool request</button>
    </div>
  </ApprovalCard>;
}

export function NativeApprovalHistory({ turn }: { turn: Turn }) {
  if (turn.approval_decisions.length === 0) return null;

  return <details className="approval-history"><summary>Automatic approval decisions ({turn.approval_decisions.length})</summary>
    <ul>{turn.approval_decisions.map((decision) => {
      const title = turn.activity.find((tool) => tool.id === decision.toolCallId)?.title;

      return <li key={decision.permissionId}>
        {decision.match === "fallback" ? "Automatically denied by fallback policy"
          : `Automatically ${decision.decision === "allow" ? "allowed" : "denied"}: ${decision.kind} → ${decision.decision === "allow" ? "Allow" : "Deny"}`}
        {title && <span> — {title}</span>}
      </li>;
    })}</ul>
    <p>The SDK settled these responses locally. This does not confirm the harness received them or that tools ran or succeeded.</p>
  </details>;
}

export function McpApprovals({ mcp, pending, onApprove }: {
  mcp: ChatView["mcp"];
  pending: boolean;
  onApprove: (permissionId: string, decision: "allow" | "deny") => void;
}) {
  if (!mcp.incomplete && mcp.pending.length === 0 && mcp.decisions.length === 0) return null;

  return <section className="mcp-approvals" aria-label="Conversation MCP permissions">
    <h2>Conversation MCP permissions</h2>
    {mcp.incomplete && <p role="alert">Some MCP authorization history could not be saved. History is incomplete; pending approvals remain available. Refresh to retry saving.</p>}
    {mcp.pending.map((permission) => <ApprovalCard key={permission.permissionId} title={`${permission.serverName} · ${permission.toolName}`} label="MCP permission request">
      <p>Allow this MCP operation once?</p>
      <p className="approval-explanation">This request belongs to this conversation. It is not correlated with a native tool call or a particular message.</p>
      <div className="approval-actions">
        <button className="approval-primary" disabled={pending} onClick={() => onApprove(permission.permissionId, "allow")}>Allow once</button>
        <button disabled={pending} onClick={() => onApprove(permission.permissionId, "deny")}>Deny once</button>
      </div>
    </ApprovalCard>)}
    {mcp.decisions.length > 0 && <details className="approval-history"><summary>MCP authorization history ({mcp.decisions.length})</summary>
      <ul>{mcp.decisions.map((decision) => <li key={decision.decisionId}>
        {decision.serverName} · {decision.toolName} — {decision.match === "disabled" ? "Blocked: tool disabled"
          : `Automatically ${decision.decision === "allow" ? "allowed" : "denied"} by ${decision.match === "tool" ? "exact tool exception" : "server default"}`}
      </li>)}</ul>
      <p>Local gate authorization only—not delivery, execution, or success. These conversation-scoped decisions are separate from native category history.</p>
    </details>}
  </section>;
}
