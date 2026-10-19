import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Match } from "effect";
import { consoleExhausted, type ConsoleUsage } from "../console-contract.js";
import "./settings.css";

export function PermissionChoices({ label, value, options = ["ask", "allow", "deny"], disabled, onChange }: {
  label: string;
  value: string;
  options?: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const name = useId();

  return <fieldset className="permission-choices" disabled={disabled}>
    <legend>{label}</legend>
    {options.map((option) => <label key={option}>
      <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
      <span>{option === "inherit" ? "Server default" : option}</span>
    </label>)}
  </fieldset>;
}

type HarnessChoice = "bob" | "opencode";

const harnessName = (harness: HarnessChoice) => harness === "bob" ? "IBM Bob" : "OpenCode";

const sections = ["Harness", "Approvals", "Connected tools", "Account"] as const;

export function RequestLimitNotice({ usage, children }: { usage: ConsoleUsage; children?: ReactNode }) {
  return <div className="request-limit-notice" role="status">
    <strong>OpenCode request limit reached · {usage.used} / {usage.limit}</strong>
    <p>The local safety allowance is exhausted, not a connection failure or provider quota. Change the cap or refresh the allowance in Settings → Harness → OpenCode. Saving or replacing a key will not reset it.</p>
    {children}
  </div>;
}

export function SettingsPage({ csrf, conversationHarness, newHarness, onNewHarness, disabled, readiness, consoleUsage, openCode, approvals, tools }: {
  csrf: string;
  conversationHarness?: HarnessChoice;
  newHarness: HarnessChoice;
  onNewHarness: (harness: HarnessChoice) => void;
  disabled: boolean;
  readiness: { bob: boolean; opencode: boolean };
  consoleUsage: ConsoleUsage | null;
  openCode: ReactNode;
  approvals: ReactNode;
  tools: ReactNode;
}) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [section, setSection] = useState<typeof sections[number]>("Harness");
  const [selectedHarness, setSelectedHarness] = useState(newHarness);
  const exhausted = consoleUsage !== null && consoleExhausted(consoleUsage);

  useEffect(() => { setSelectedHarness(newHarness); }, [newHarness]);

  const selectTab = (index: number) => {
    const next = sections[index];

    if (!next) return;
    setSection(next);
    tabs.current[index]?.focus();
  };

  return <div className="settings-page">
    <div className="settings-eyebrow"><span className="settings-workspace-label">Workspace</span><span>Shared across conversations</span></div>
    <h1>Settings</h1>
    <div className="settings-context">
      <div><span>This conversation</span><strong>{conversationHarness ? harnessName(conversationHarness) : "None selected"}</strong></div>
      <button onClick={() => { setSelectedHarness(newHarness); selectTab(0); }}><span>New chats <span>Change ›</span></span><strong>{harnessName(newHarness)}</strong></button>
      <p>The selection affects new chats in this page only. Existing conversations keep the harness they started with. Reload restores the installation default.</p>
    </div>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {sections.map((name, index) => <button key={name} id={`${id}-tab-${index}`} ref={(element) => { tabs.current[index] = element; }}
        role="tab" aria-selected={section === name} aria-controls={`${id}-panel-${index}`} tabIndex={section === name ? 0 : -1}
        onClick={() => setSection(name)} onKeyDown={(event) => {
          const next = Match.value(event.key).pipe(
            Match.when("ArrowRight", () => (index + 1) % sections.length),
            Match.when("ArrowLeft", () => (index + sections.length - 1) % sections.length),
            Match.when("Home", () => 0),
            Match.when("End", () => sections.length - 1),
            Match.orElse(() => undefined),
          );

          if (next === undefined) return;
          event.preventDefault(); selectTab(next);
        }}><span>{["I", "II", "III", "IV"][index]}</span>{name}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={section !== "Harness"}>
      <section className="settings-section" aria-label="Harness settings">
        <div className="settings-section-heading"><h2>Harness</h2><p>The agent runtime behind a conversation.</p></div>
        <div className="harness-cards">
          {(["opencode", "bob"] as const).map((harness, index) => <div className={`harness-card${selectedHarness === harness ? " harness-card-selected" : ""}`} key={harness}>
            <button className="harness-card-select" aria-pressed={selectedHarness === harness} onClick={() => setSelectedHarness(harness)}>
              <span className="harness-card-meta"><span>H·0{index + 1}</span><span>{harness === "opencode" && exhausted ? "Limit reached" : readiness[harness] ? "Ready to prepare" : "Setup required"}</span></span>
              <strong>{harnessName(harness)}</strong><span>{harness === "opencode" ? "OpenCode connection" : "Packaged Bob runtime"}</span>
            </button>
            <button className="harness-default" disabled={disabled || newHarness === harness || !readiness[harness]} onClick={() => onNewHarness(harness)}>{newHarness === harness ? "Selected for new chats" : "Use for new chats"}<span aria-hidden="true">{newHarness === harness ? "■" : "□"}</span></button>
          </div>)}
          <div className="harness-card harness-card-preview"><span className="harness-card-meta">H·03 · Not available</span><strong>Pi</strong><p>Design preview. This installation has no Pi integration.</p></div>
          <div className="harness-add"><button disabled>+ Add a harness</button><span>Additional runtimes are not supported yet.</span></div>
        </div>
        <div hidden={selectedHarness !== "opencode"}>{openCode}</div>
        <section className="settings-section harness-connection" aria-label="IBM Bob connection" hidden={selectedHarness !== "bob"}>
          <div className="settings-section-heading"><h3>IBM Bob connection</h3><span>{readiness.bob ? "Key saved" : "No key saved"}</span></div>
          <p>Uses the packaged Bob runtime. A saved key is not proof of provider connectivity; prepare a Bob conversation to verify readiness.</p>
          <a href="/">Manage Bob connection ↗</a>
          <p className="settings-note">Approval preferences and Context7 apply to Bob only. Provider/model configuration is owned by the packaged runtime and is not editable here.</p>
        </section>
        <div className="harness-capabilities"><table><caption>Available in this installation</caption><thead><tr><th scope="col">Capability</th><th scope="col">OpenCode</th><th scope="col">IBM Bob</th></tr></thead><tbody>
          <tr><th scope="row">Approval preferences</th><td>One-time, native</td><td>Ask · Allow · Deny</td></tr>
          <tr><th scope="row">Connected tools</th><td>Not exposed here</td><td>Context7</td></tr>
          <tr><th scope="row">Model choice</th><td>Free Console models, per chat</td><td>Runtime-managed</td></tr>
          <tr><th scope="row">Custom instructions</th><td>Not editable here</td><td>Not editable here</td></tr>
        </tbody></table></div>
      </section>
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={section !== "Approvals"}>{approvals}</div>
    <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={section !== "Connected tools"}>{tools}</div>
    <div role="tabpanel" id={`${id}-panel-3`} aria-labelledby={`${id}-tab-3`} hidden={section !== "Account"}>
      <section className="settings-section" aria-label="Account settings"><h2>Account</h2><div className="settings-account-grid">
        <div><h3>Your account</h3><p>Choose your own sign-in password or sign out of this workspace.</p><div className="settings-actions"><a href="/auth/password">Manage account ↗</a>
          <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value={csrf} /><button type="submit">Sign out</button></form></div></div>
        <div><h3>Models &amp; instructions</h3><p>Other models and custom instructions cannot be changed here.</p><span className="settings-preview-label">Not available</span></div>
      </div></section>
    </div>
  </div>;
}

export function SettingsInspector() {
  return <>
    <section><h2>Scope</h2><p>One shared workspace.</p><small>These preferences apply across conversations, not just the thread selected on the left.</small></section>
    <section><h2>Permission choices</h2><dl className="settings-definitions">
      <dt>Ask</dt><dd>Request your approval.</dd>
      <dt>Allow</dt><dd>Approve matching requests automatically.</dd>
      <dt>Deny</dt><dd>Reject matching requests.</dd>
    </dl><small>Native approvals only cover requests the harness asks about. They are not a sandbox.</small></section>
    <section><h2>Saved vs active</h2><p>Saved is the stored preference. Active is what the connected worker or harness client has confirmed.</p><small>Approval preferences apply without a worker restart. For connected tools, Apply changes saves your choices and prepares the worker with them while idle.</small></section>
    <section><h2>Pending approvals</h2><p>Changing preferences does not change already-pending approval requests.</p><small>Return to Chat to decide those individually.</small></section>
  </>;
}
