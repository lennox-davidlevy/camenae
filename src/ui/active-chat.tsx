import { createContext, useContext, useState, type MouseEvent, type ReactNode } from "react";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState, type DataMessagePartProps } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { Activity, Turn, type ChatView } from "../chat-contract.js";
import { McpApprovals, NativeApproval, NativeApprovalHistory } from "./chat-approvals.js";
import type { Screen } from "./layout-shell.js";
import { SessionUsagePanel } from "./session-usage.js";
import "./active-chat.css";
import { AttachmentChips, ThreadFiles } from "./attachments.js";
import type { FileAttachment } from "../file-contract.js";

const ApprovalActions = createContext<{
  pending: boolean;
  onApprove: (turn: Turn, optionId: string | null) => void;
} | null>(null);

function navigateWithinMessage(event: MouseEvent<HTMLAnchorElement>) {
  const href = event.currentTarget.getAttribute("href");

  if (!href?.startsWith("#")) return;
  event.preventDefault();
  const message = event.currentTarget.closest(".chat-markdown");

  if (!message) return;

  // Footnote IDs repeat across responses. Scope lookup to this response and
  // leave the application's conversation UUID in the URL fragment untouched.
  for (const target of message.querySelectorAll<HTMLElement>("[id]")) {
    if (target.id !== href.slice(1) && encodeURIComponent(target.id) !== href.slice(1)) continue;
    target.scrollIntoView({ block: "nearest" });

    if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    return;
  }
}

function MarkdownText() {
  return <MarkdownTextPrimitive className="chat-markdown" remarkPlugins={[remarkGfm]} smooth={false} skipHtml components={{
    // Do not automatically fetch model-supplied image URLs. Keep them accessible as links.
    img: ({ src, alt }) => <a href={src} target="_blank" rel="noreferrer">{alt || "View image"}</a>,
    a: ({ node: _node, ...props }) => <a {...props} target={props.href?.startsWith("#") ? undefined : "_blank"} rel="noreferrer" onClick={navigateWithinMessage} />,
    table: ({ node: _node, ...props }) => <div className="chat-table-scroll"><table {...props} /></div>,
  }} />;
}

function ToolActivity({ data }: DataMessagePartProps) {
  const tool = Activity.parse(data);

  return <details className="tool-activity">
    <summary><span>{tool.title}</span><span className="tool-activity-status">{tool.status}</span><span className="tool-activity-toggle" aria-hidden="true">⌄</span></summary>
    <div className="tool-activity-details"><p>Reported status: <strong>{tool.status}</strong></p><p>Arguments, output, and timing are not available in this chat view.</p></div>
  </details>;
}

function UserMessage() {
  const turn = Turn.parse(useAuiState((state) => state.message.metadata.custom.turn));

  return <MessagePrimitive.Root className="chat-user-message"><span className="chat-user-label">You</span><div className="chat-user-text"><MessagePrimitive.Parts /><AttachmentChips files={turn.attachments} /></div></MessagePrimitive.Root>;
}

function AssistantMessage() {
  const turn = Turn.parse(useAuiState((state) => state.message.metadata.custom.turn));
  const actions = useContext(ApprovalActions);

  if (!actions) throw new Error("Assistant messages require approval actions");

  return <MessagePrimitive.Root className="chat-assistant-message">
    <div className="chat-assistant-label">Assistant · Turn {turn.ordinal} · {turn.status}{turn.activity.length > 0 && ` · ${turn.activity.length} tool calls`}</div>
    <MessagePrimitive.Parts components={{ Text: MarkdownText, data: { by_name: { "tool-activity": ToolActivity } } }} />
    {!turn.answer && <p className="chat-turn-notice">{turn.status === "running" ? "Waiting for response text…" : "No response text was returned."}</p>}
    {turn.stop_reason && <p className="chat-turn-notice">Stop reason: {turn.stop_reason}</p>}
    <NativeApproval turn={turn} pending={actions.pending} onApprove={actions.onApprove} />
    <NativeApprovalHistory turn={turn} />
  </MessagePrimitive.Root>;
}

export function ActiveChat({ title, mcp, pending, status, reconnect, onNativeApprove, onMcpApprove, onScreen, attachments }: {
  attachments: ReactNode;
  title: string;
  mcp: ChatView["mcp"];
  pending: boolean;
  status: ReactNode;
  reconnect: ReactNode;
  onNativeApprove: (turn: Turn, optionId: string | null) => void;
  onMcpApprove: (permissionId: string, decision: "allow" | "deny") => void;
  onScreen: (screen: Screen) => void;
}) {
  return <ApprovalActions.Provider value={{ pending, onApprove: onNativeApprove }}>
    <ThreadPrimitive.Viewport className="active-chat-viewport">
      <div className="active-chat-heading"><div><span className="active-chat-chip">Conversation</span><span className="active-chat-connection" role="status">{status}</span>{reconnect}</div><h1>{title}</h1></div>
      <div className="active-chat-timeline"><ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} /></div>
      <McpApprovals mcp={mcp} pending={pending} onApprove={onMcpApprove} />
    </ThreadPrimitive.Viewport>
    <div className="active-chat-composer-dock">
      <ComposerPrimitive.Root className="active-chat-composer">
        <ComposerPrimitive.Input placeholder="Reply…" aria-label="Message Camenae" maxLength={8000} maxRows={4} />
        {attachments}
        <div className="active-chat-composer-actions">
          <button type="button" aria-label="Open skills preview" title="Open skills preview" onClick={() => onScreen("Skills")}>/</button>
          <ComposerPrimitive.Send className="active-chat-send">Send</ComposerPrimitive.Send>
          <ComposerPrimitive.Cancel className="active-chat-stop" disabled={pending}>Stop</ComposerPrimitive.Cancel>
        </div>
      </ComposerPrimitive.Root>
    </div>
  </ApprovalActions.Provider>;
}

export function ActiveChatInspector({ turn, usage, approvals, onSettings, attachments }: { turn?: Turn; usage: ChatView["usage"]; approvals: number; onSettings: () => void; attachments: FileAttachment[] }) {
  const [preview, setPreview] = useState("Default");

  return <div className="active-chat-inspector">
    <SessionUsagePanel usage={usage} />
    <section><h2>Skill loaded</h2><div className="chat-skill-status"><strong>Not reported</strong><small>Skill reporting preview</small></div></section>
    <section><h2>Tools · latest turn</h2>{turn?.activity.length ? <ul className="chat-inspector-tools">{turn.activity.map((tool) => <li key={tool.id}><span>{tool.title}</span><small>{tool.status}</small></li>)}</ul> : <p>No tool activity reported.</p>}</section>
    <section><h2>Approvals</h2><p>{approvals > 0 ? `${approvals} waiting in this conversation` : "No pending requests"}</p><small>Authorization does not confirm execution.</small></section>
    <ThreadFiles attachments={attachments} />
    <fieldset className="chat-policy-preview"><legend>Conversation policy · preview</legend><div>{["Default", "Ask", "Allow", "Deny"].map((option) => <button key={option} aria-pressed={preview === option} onClick={() => setPreview(option)}>{option}</button>)}</div><p>UI preview only. This selection does not change permissions. Global policies still apply.</p><button onClick={onSettings}>Global tools &amp; permissions →</button></fieldset>
  </div>;
}
