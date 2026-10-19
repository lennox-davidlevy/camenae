import { useState, type ReactNode } from "react";
import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { SessionUsage } from "../chat-contract.js";
import { SessionUsagePanel } from "./session-usage.js";
import { ThreadFiles } from "./attachments.js";
import "./new-chat.css";

const suggestions = [
  ["Summarize The September Board Deck", "board_deck_sep.pdf · Writer"],
  ["Which Vendor Contract Auto-Renews Sooner?", "2 files · Contract Review"],
  ["Pull Weekly Actives For The Last 12 Weeks", "SQL · sql_query"],
  ["Find Three Recent Papers On Calibrated Models", "Researcher · web_search"],
] as const;

const previews = [
  ["/ Skill", "Skill selection is a UI preview. This control does not load a skill or change the assistant's behavior."],
  ["@ Tool", "Tool selection is a UI preview. Manage working global tool preferences in Settings."],
] as const;

export function NewChat({ status, attachments }: { status: ReactNode; attachments: ReactNode }) {
  const [openedAt] = useState(() => new Date());
  const [preview, setPreview] = useState("");

  return <div className="new-chat">
    <div className="new-chat-banner" aria-label="Camenae · Ex fonte, consilium">
      <div className="new-chat-coin"><img src="/assets/camenae-coin.png" alt="Aegeria" /></div>
      <div className="new-chat-banner-panel">
        <img src="/assets/camenae-coin.png" alt="" />
        <div className="new-chat-banner-caption"><span>Aegeria · Nº I</span><span>Ex fonte, consilium</span></div>
        <div className="new-chat-banner-name">Camenae</div>
      </div>
      <div className="new-chat-column" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
    <div className="new-chat-heading">
      <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
      <span className="new-chat-label">New Thread</span>
      <time dateTime={openedAt.toISOString()} title="Time this view was opened">{openedAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })} · {openedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
      <h1>What Are We Working On?</h1>
    </div>
    <ComposerPrimitive.Root className="new-chat-composer">
      <ComposerPrimitive.Input placeholder="Ask anything. What would you like to work on?" aria-label="Message Camenae" maxLength={8000} />
      {attachments}
      <div className="new-chat-composer-actions">
        <div className="new-chat-additions">{previews.map(([label, description]) => <button key={label} type="button" title={`${label} — preview only`} aria-pressed={preview === description} onClick={() => setPreview(preview === description ? "" : description)}>{label}</button>)}<span>Preview</span></div>
        <ComposerPrimitive.Send className="new-chat-send">Send <span aria-hidden="true">↵</span></ComposerPrimitive.Send>
      </div>
      {(preview || status) && <div className="new-chat-notice" role="status">{preview && <p>{preview}</p>}{status}</div>}
    </ComposerPrimitive.Root>
    <div className="new-chat-suggestions" aria-label="Example prompts" aria-describedby="example-prompts-note">
      {suggestions.map(([title, meta]) => <ThreadPrimitive.Suggestion key={title} prompt={title} send={false} className="new-chat-suggestion"><span><span>{title}</span><small>{meta}</small></span><span aria-hidden="true">→</span></ThreadPrimitive.Suggestion>)}
      <p id="example-prompts-note">Example prompts only. The files, skills, and integrations above are illustrative—not attached or connected. Choose a prompt to edit it before sending.</p>
    </div>
  </div>;
}

export function NewChatInspector({ status, reconnect, usage }: { status: string; reconnect: ReactNode; usage: SessionUsage | null }) {
  return <div className="new-chat-inspector">
    <SessionUsagePanel usage={usage} />
    <section className="new-chat-skill-section"><h2>Skill loaded</h2><div className="new-chat-skill"><strong>Not reported</strong><small>Skill reporting preview</small></div></section>
    <section className="new-chat-tools"><h2>Tools · preview</h2>{["read_file", "run_python", "write_file", "web_search", "send_email"].map((tool) => <div key={tool}><span><i aria-hidden="true" />{tool}</span><small>preview</small></div>)}</section>
    <ThreadFiles attachments={[]} />
    <section><h2>Connection</h2><p role="status">{status}</p>{reconnect}</section>
  </div>;
}
