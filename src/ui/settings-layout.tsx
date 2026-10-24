import { useId, useRef, useState, type ReactNode } from "react";
import { Match } from "effect";
import type { ConsoleUsage } from "../console-contract.js";
import "./settings.css";

const sections = ["Provider", "Account"] as const;

export function RequestLimitNotice({ usage, children }: { usage: ConsoleUsage; children?: ReactNode }) {
  return <div className="request-limit-notice" role="status">
    <strong>OpenCode request limit reached · {usage.used} / {usage.limit}</strong>
    <p>The local safety allowance is exhausted, not a connection failure or provider quota. Change the cap or refresh the allowance in Settings → Provider. Saving or replacing a key will not reset it.</p>
    {children}
  </div>;
}

export function SettingsPage({ csrf, openCode }: { csrf: string; openCode: ReactNode }) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [section, setSection] = useState<typeof sections[number]>("Provider");

  const selectTab = (index: number) => {
    const next = sections[index];

    if (!next) return;
    setSection(next);
    tabs.current[index]?.focus();
  };

  return <div className="settings-page">
    <div className="settings-eyebrow"><span className="settings-workspace-label">Workspace</span><span>Shared across conversations</span></div>
    <h1>Settings</h1>
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
        }}><span>{["I", "II"][index]}</span>{name}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={section !== "Provider"}>
      <section className="settings-section" aria-label="Provider settings">
        <div className="settings-section-heading"><h2>Provider</h2><p>The agent runtime behind a conversation.</p></div>
        {openCode}
      </section>
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={section !== "Account"}>
      <section className="settings-section" aria-label="Account settings"><h2>Account</h2><div className="settings-account-grid">
        <div><h3>Your account</h3><p>Choose your own sign-in password or sign out of this workspace.</p><div className="settings-actions"><a href="/auth/password">Manage account ↗</a>
          <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value={csrf} /><button type="submit">Sign out</button></form></div></div>
      </div></section>
    </div>
  </div>;
}

export function SettingsInspector() {
  return <>
    <section><h2>Scope</h2><p>One shared workspace.</p><small>These preferences apply across conversations, not just the thread selected on the left.</small></section>
    <section><h2>Pending approvals</h2><p>Approval requests are decided one at a time in Chat.</p><small>Native approvals only cover requests the agent asks about. They are not a sandbox.</small></section>
  </>;
}
