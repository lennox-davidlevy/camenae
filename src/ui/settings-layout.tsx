import { useId, type ReactNode } from "react";
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

export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className="settings-page">
    <span className="settings-workspace-label">Workspace</span>
    <h1>Settings</h1>
    <p className="settings-intro">Permissions shared across your conversations. Change a choice, then apply when you’re ready.</p>
    {children}
    <section className="settings-unavailable" aria-label="Unavailable settings">
      <h2>Models &amp; custom instructions</h2>
      <p>Not connected yet. Model selection and custom instructions cannot be changed here.</p>
    </section>
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
