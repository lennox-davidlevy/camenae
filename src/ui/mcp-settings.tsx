import { useCallback, useEffect, useState } from "react";
import { context7Tools, McpDecision, McpSettings, type DisabledTools, type McpPolicies } from "../mcp-contract.js";
import { PermissionChoices } from "./settings-layout.js";

export function McpToolSettings({ csrf, running, preparing, pending, onApplyingChange, onApply }: {
  csrf: string; running: boolean; preparing: boolean; pending: boolean;
  onApplyingChange: (applying: boolean) => void; onApply?: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<McpSettings>();
  const [disabledTools, setDisabledTools] = useState<DisabledTools>([]);
  const [permissions, setPermissions] = useState<McpPolicies>({ context7: { fallback: "ask", tools: {} } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/settings/mcp");

    if (!response.ok) throw new Error("Could not read tool settings. Check your connection and sign-in.");
    const value = McpSettings.parse(await response.json());
    setSettings(value);

    return value;
  }, []);

  useEffect(() => {
    void refresh().then((value) => { setDisabledTools(value.disabledTools); setPermissions(value.permissions); })
      .catch((failure: Error) => setError(failure.message));
  }, [refresh]);

  useEffect(() => {
    if (!preparing) void refresh().catch((failure: Error) => setError(failure.message));
  }, [refresh, running, preparing]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");

    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Tool settings unavailable"); }
    finally { setBusy(false); }
  };

  const applied = settings?.activeDisabledTools !== null &&
    JSON.stringify(settings?.disabledTools) === JSON.stringify(settings?.activeDisabledTools) &&
    JSON.stringify(settings?.permissions) === JSON.stringify(settings?.activePermissions);

  return <section className="settings-section" aria-label="MCP tool settings">
    <h2>Connected tools</h2>
    <p>Context7 · Library documentation</p>
    <p className="settings-note">Saved across conversations and worker replacements. Context7 trust does not change native shell or other tool permissions.</p>
    {!settings && !error && <p role="status">Loading connected-tool settings…</p>}
    {settings && <>
      <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-heading"><h3>Context7 server default</h3>
          <small>{error ? "Last confirmed saved" : "Saved"}: {settings.permissions.context7.fallback}; {error ? "last confirmed active" : "active"}: {settings.activePermissions?.context7.fallback ?? "not confirmed"}</small>
        </div>
        <PermissionChoices label="Context7 server default" disabled={busy} value={permissions.context7.fallback}
          onChange={(value) => setPermissions({ context7: { ...permissions.context7, fallback: McpDecision.parse(value) } })} />
      </div>
      {context7Tools.map((tool) => <div className="settings-tool" key={tool}>
        <div className="settings-row">
          <div className="settings-row-heading"><h3>{tool}</h3><p className="settings-tool-description">{tool === "resolve-library-id" ? "Find a library’s documentation identifier." : "Look up documentation for a library."}</p></div>
          <label className="settings-availability">
        <input type="checkbox" checked={!disabledTools.includes(tool)} disabled={busy}
          aria-label={`${tool} enabled`}
          onChange={(event) => setDisabledTools(event.target.checked
            ? disabledTools.filter((name) => name !== tool) : [...disabledTools, tool].sort())} />
            {disabledTools.includes(tool) ? "Disabled" : "Enabled"}
          </label>
          <small className="settings-row-status">{error ? "Last confirmed saved" : "Saved"}: {settings.disabledTools.includes(tool) ? "Disabled" : "Enabled"}; {error ? "last confirmed active" : "active"}: {
          settings.activeDisabledTools === null ? "not confirmed" : settings.activeDisabledTools.includes(tool) ? "Disabled" : "Enabled"
        }</small>
        </div>
        <div className="settings-row">
          <span className="settings-permission-label">Permission override</span>
          <PermissionChoices label={`${tool} permission`} disabled={busy || disabledTools.includes(tool)} options={["inherit", "ask", "allow", "deny"]}
        value={permissions.context7.tools[tool] ?? "inherit"} onChange={(value) => {
          const tools = { ...permissions.context7.tools };

          if (value === "inherit") delete tools[tool];
          else tools[tool] = McpDecision.parse(value);
          setPermissions({ context7: { ...permissions.context7, tools } });
        }} />
          <small className="settings-row-status">{error ? "Last confirmed saved" : "Saved"}: {settings.permissions.context7.tools[tool] ?? "server default"}; {error ? "last confirmed active" : "active"}: {settings.activePermissions === null ? "not confirmed" : settings.activePermissions.context7.tools[tool] ?? "server default"}</small>
        </div>
      </div>)}
      </div>
      <p className="settings-note">Deny leaves an enabled tool discoverable but blocks execution. Disabled always wins; its permission is retained.</p>
      {(JSON.stringify(disabledTools) !== JSON.stringify(settings.disabledTools) || JSON.stringify(permissions) !== JSON.stringify(settings.permissions)) && <p className="settings-unsaved">Unsaved tool changes</p>}
      <p className="settings-status" role="status">{error ? "Tool status is unverified. Refresh before relying on last confirmed values." : applied ? "Saved settings are active in the prepared worker." : "Saved settings are pending application."}</p>
      <p className="settings-note">Apply changes saves your choices and applies them to the prepared worker in one step. It is available while idle and does not change already-pending approvals.</p>
      <div className="settings-actions"><button className="settings-save" disabled={busy || pending || running || preparing || !onApply} onClick={() => void perform(async () => {
        if (!onApply) return;
        onApplyingChange(true);
        let saved = false;
        let failure: unknown;

        try {
          try {
            const response = await fetch("/api/settings/mcp", { method: "POST",
              headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf, disabledTools, permissions }) });

            if (!response.ok) throw new Error(await response.text());
            const value = McpSettings.parse(await response.json());
            setSettings(value); setDisabledTools(value.disabledTools); setPermissions(value.permissions);
            saved = true;
            await onApply();
          } catch (error) { failure = error; }

          // Reconcile both successful applies and uncertain failures. Never claim
          // that a saved preference is active just because the save succeeded.
          try { await refresh(); }
          catch (error) { failure ??= error; }

          if (failure) {
            const reason = failure instanceof Error ? failure.message : "Request failed";
            throw new Error(saved
              ? `Changes were saved, but applying them could not be confirmed. Refresh status before retrying. ${reason}`
              : `Could not confirm that changes were saved. This action did not apply them. Refresh status before retrying. ${reason}`);
          }
        } finally { onApplyingChange(false); }
      })}>{busy ? "Working…" : "Apply changes"}</button>
      </div>
      {(running || preparing || !onApply) && <p className="settings-note">{running || preparing ? "Apply is unavailable while a turn is running or a conversation is being prepared." : "Choose or create a conversation in Chat with saved harness credentials to apply tool changes."}</p>}
    </>}
    <div className="settings-actions"><button className="settings-refresh" disabled={busy} onClick={() => void perform(async () => {
      const value = await refresh();

      if (!settings) { setDisabledTools(value.disabledTools); setPermissions(value.permissions); }
    })}>Refresh settings status</button></div>
    <details className="settings-details"><summary>Connected-tool catalog</summary><p>Fixed Context7 catalog, not live discovery. Newly introduced tools require a catalog update and worker replacement before prompt-free delegation.</p></details>
    {error && <p role="alert">{error} Check saved versus active values before retrying Apply changes.</p>}
  </section>;
}
