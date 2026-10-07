import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ConsoleSettings, consoleModel, consoleExhausted, RequestCap, type ConsoleUsage } from "../console-contract.js";
import { RequestLimitNotice } from "./settings-layout.js";

export function OpenCodeSettings({ csrf, active, usage, onChanged }: { csrf: string; active: boolean; usage: ConsoleUsage | null; onChanged: (connectionChanged: boolean) => Promise<void> }) {
  const [settings, setSettings] = useState<z.infer<typeof ConsoleSettings>>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const version = useRef(0);
  const saving = useRef(false);

  const refresh = useCallback(async () => {
    if (saving.current) return;
    const requestVersion = ++version.current;
    const response = await fetch("/api/settings/opencode");

    if (!response.ok) throw new Error("Could not load OpenCode settings. Check your connection and sign-in.");
    const value = ConsoleSettings.parse(await response.json());

    if (requestVersion === version.current) setSettings(value);
  }, []);

  useEffect(() => {
    let disposed = false;
    void refresh().then(() => { if (!disposed) return onChanged(false); })
      .catch(() => { if (!disposed) setError("Could not load OpenCode settings."); });

    return () => { disposed = true; version.current++; };
  }, [active, onChanged, refresh]);

  const save = async (remove: boolean) => {
    saving.current = true;
    version.current++;
    setBusy(true); setError(""); setMessage("");

    try {
      const response = await fetch(`/api/settings/opencode${remove ? "/remove" : ""}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(remove ? { csrf } : { csrf, provider: "console", model: consoleModel, key }),
      });

      if (!response.ok) throw new Error("OpenCode settings were not confirmed saved. Refresh status before retrying.");
      setSettings(ConsoleSettings.parse(await response.json()));
      setKey("");
      await onChanged(true);
      setMessage(remove ? "Console key removed." : "Console key saved. No provider request was made. Check the request allowance before starting a chat.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "OpenCode settings unavailable.");
    } finally { saving.current = false; setBusy(false); }
  };

  const allowance = usage && (!settings || usage.revision > settings.revision || (usage.revision === settings.revision && usage.used > settings.used)) ? usage : settings;

  const saveBudget = async (limit: number | null, refreshAllowance: boolean) => {
    if (!allowance) return;
    saving.current = true;
    version.current++;
    setBusy(true); setError(""); setMessage("");

    try {
      const response = await fetch("/api/settings/opencode/budget", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ csrf, limit, refresh: refreshAllowance, revision: allowance.revision }),
      });

      if (!response.ok) throw new Error(response.status === 409 ? "Allowance changed elsewhere. Refresh status before retrying." : "Allowance was not confirmed saved. Refresh status before retrying.");
      setSettings(ConsoleSettings.parse(await response.json()));
      await onChanged(false);
      setMessage(refreshAllowance ? "Allowance refreshed. Lifetime request history is preserved." : "Request cap saved. Usage was not reset.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update the allowance.");
    } finally { saving.current = false; setBusy(false); }
  };

  return <section className="settings-section harness-connection" aria-label="OpenCode connection">
    <div className="settings-section-heading"><h3>OpenCode connection</h3><span>Console · free-only</span></div>
    {allowance && consoleExhausted(allowance) && <RequestLimitNotice usage={allowance} />}
    {!settings && !error && <p role="status">Loading OpenCode connection…</p>}
    {settings && <>
      {!settings.enabled && <p role="status">The Console/free-only worker is not enabled for this installation. Deployment setup is required before saving a key.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
        <div className="settings-rows">
          <label className="settings-row">Provider <select aria-label="OpenCode provider" disabled><option>Console (free-only)</option></select></label>
          <div className="settings-row"><span>Model</span><span>Choose a free model inside each OpenCode chat, including existing chats, between turns.</span></div>
          <label className="settings-row">Console API key <input type="password" autoComplete="new-password" value={key} maxLength={4096}
            disabled={busy || !settings.enabled} onChange={(event) => setKey(event.target.value)} placeholder={settings.stored ? "Key saved — enter a replacement" : "Enter API key"} /></label>
        </div>
        <p className="settings-key-status">Key: {settings.stored ? "saved (encrypted)" : "not saved"}.</p>
        <div className="settings-actions">
          <button className="settings-save" type="submit" disabled={busy || !settings.enabled || !key.trim()}>Save Console key</button>
          <button type="button" disabled={busy || !settings.stored} onClick={() => void save(true)}>Remove Console key</button>
        </div>
      </form>
      {allowance && <ConsoleBudget key={allowance.revision} usage={allowance} disabled={busy || !settings.enabled} onSave={saveBudget} />}
      <ol className="settings-connection-notes"><li>Only the listed free chat models are allowed, with no fallback. Provider pricing and availability can change. Jev is not a chat model; Muse's Responses API is not supported here.</li><li>The local request cap is shared across all Console chats, including failed and background requests. Saving or removing a key does not reset it.</li><li>Replacing or removing the key disconnects an existing OpenCode session and may stop its running turn. The key is never sent to the worker or returned to this page.</li></ol>
    </>}
    <div className="settings-actions"><button className="settings-refresh" disabled={busy} onClick={() => { setError(""); void refresh().then(() => onChanged(false)).catch(() => setError("Could not refresh OpenCode settings.")); }}>Refresh OpenCode status</button></div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function ConsoleBudget({ usage, disabled, onSave }: { usage: ConsoleUsage; disabled: boolean; onSave: (limit: number | null, refresh: boolean) => Promise<void> }) {
  const [limit, setLimit] = useState(String(usage.limit ?? 20));
  const [unlimited, setUnlimited] = useState(usage.limit === null);
  const parsed = RequestCap.safeParse(unlimited ? null : limit.trim() === "" ? undefined : Number(limit));

  return <form className="console-budget" onSubmit={(event) => {
    event.preventDefault();

    if (parsed.success) void onSave(parsed.data, false);
  }}>
    <h4>Local request allowance</h4>
    <div className="request-usage"><span>Requests used since refresh</span>
      {usage.limit !== null && usage.limit > 0 && <progress aria-label="Local Console requests used" value={usage.used} max={usage.limit} />}
      <strong>{usage.used} / {usage.limit ?? "Unlimited"}</strong></div>
    <label className="settings-row">Request cap <input aria-label="Request cap" type="number" min="0" max="2147483647" step="1" required disabled={disabled || unlimited} value={limit} onChange={(event) => setLimit(event.target.value)} /></label>
    <label><input type="checkbox" checked={unlimited} disabled={disabled} onChange={(event) => setUnlimited(event.target.checked)} /> Unlimited requests</label>
    <p className="settings-note">0 blocks new provider requests. Unlimited removes the local safety cap, not provider limits or billing. Requests already admitted can finish.</p>
    <div className="settings-actions">
      <button type="submit" disabled={disabled || !parsed.success}>Save request cap</button>
      <button type="button" disabled={disabled || usage.used === 0} onClick={() => {
        if (window.confirm(`Refresh usage to 0 with the saved cap of ${usage.limit ?? "Unlimited"}? Lifetime request history will be retained.`)) void onSave(usage.limit, true);
      }}>Refresh allowance</button>
    </div>
  </form>;
}
