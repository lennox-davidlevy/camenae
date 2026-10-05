import { useCallback, useEffect, useRef, useState } from "react";
import { approvalKinds, ApprovalPolicy, ApprovalSettings } from "../approval-contract.js";
import { PermissionChoices } from "./settings-layout.js";

export function ApprovalPreferences({ csrf, running, preparing }: { csrf: string; running: boolean; preparing: boolean }) {
  const [settings, setSettings] = useState<ApprovalSettings>();
  const [draft, setDraft] = useState<ApprovalPolicy>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const version = useRef(0);
  const saving = useRef(false);

  const refresh = useCallback(async () => {
    if (saving.current) return;
    const requestVersion = ++version.current;
    setVerified(false);

    try {
      const response = await fetch("/api/settings/approvals");

      if (!response.ok) throw new Error("Could not read approval preferences. Check your connection and sign-in.");
      const value = ApprovalSettings.parse(await response.json());

      if (requestVersion !== version.current) return;
      setSettings(value);
      setDraft((previous) => previous ?? value.saved);
      setVerified(true);
    } catch (failure) {
      if (requestVersion === version.current) throw failure;
    }
  }, []);

  useEffect(() => {
    if (!preparing) void refresh().catch((failure: Error) => setError(failure.message));
  }, [refresh, running, preparing]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");

    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Approval preferences unavailable"); }
    finally { setBusy(false); }
  };

  const applied = settings?.active !== null && JSON.stringify(settings?.saved) === JSON.stringify(settings?.active);

  return <section className="settings-section approval-preferences" aria-label="Approval preferences">
    <h2>Approval preferences</h2>
    <p>Decide how to handle new permission requests from the assistant: Ask for your approval, Allow automatically, or Deny.</p>
    <p className="settings-note">Categories are reported by the harness. Allow covers every request in that category—not a particular command, file, or MCP tool. These choices do not control tool availability.</p>
    {!settings && !error && <p role="status">Loading approval preferences…</p>}
    {draft && settings && <>
      <div className="settings-rows">
      {approvalKinds.map((kind) => <div className="settings-row" key={kind}>
        <div className="settings-row-heading"><h3>{kind}</h3>
          <small>{verified ? "Saved" : "Last confirmed saved"}: {settings.saved.kinds[kind]}; {verified ? "active" : "last confirmed active"}: {settings.active?.kinds[kind] ?? "not connected"}</small>
        </div>
        <PermissionChoices label={`${kind} approval`} value={draft.kinds[kind]} disabled={busy} onChange={(value) => {
          const policy = ApprovalPolicy.parse({ ...draft, kinds: { ...draft.kinds, [kind]: value } });
          setDraft(policy);
        }} />
      </div>)}
      <div className="settings-row">
        <div className="settings-row-heading"><h3>Other / unclassified requests</h3>
          <small>{verified ? "Saved" : "Last confirmed saved"}: {settings.saved.fallback}; {verified ? "active" : "last confirmed active"}: {settings.active?.fallback ?? "not connected"}</small>
        </div>
        <PermissionChoices label="Other requests approval" value={draft.fallback} options={["ask", "deny"]} disabled={busy}
          onChange={(value) => setDraft(ApprovalPolicy.parse({ ...draft, fallback: value }))} />
      </div>
      </div>
      {JSON.stringify(draft) !== JSON.stringify(settings.saved) && <p className="settings-unsaved">Unsaved approval changes</p>}
      <p className="settings-status" role="status">{!verified ? "Approval status is unverified. Displayed values are last confirmed; refresh before relying on them." : applied ? "Saved preferences are active for new permission requests." : "Saved preferences are pending application to a connected harness client."}</p>
      <div className="settings-actions"><button className="settings-save" disabled={busy} onClick={() => void perform(async () => {
        saving.current = true;
        version.current++;
        setVerified(false);

        try {
          const response = await fetch("/api/settings/approvals", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ csrf, policy: draft }) });

          if (!response.ok) throw new Error(await response.text());
          const value = ApprovalSettings.parse(await response.json());
          setSettings(value); setDraft(value.saved); setVerified(true);
        } catch (failure) {
          // A lost POST response is not evidence that the save failed. Reconcile
          // from the server; if that also fails, keep values explicitly unverified.
          saving.current = false;

          try { await refresh(); }
          catch { throw new Error("Could not confirm whether approval preferences were saved or applied."); }

          throw failure;
        } finally {
          saving.current = false;
        }
      })}>Save and apply approval preferences</button></div>
    </>}
    <div className="settings-actions"><button className="settings-refresh" disabled={busy} onClick={() => void perform(refresh)}>Refresh approval status</button></div>
    <p className="settings-note">No worker restart is needed. Already-pending requests stay manual. Saved preferences are reapplied on reconnection.</p>
    <p className="settings-note">Manual choices apply once. Reads and built-in skills that the harness runs without asking cannot be blocked here. This is not a sandbox.</p>
    <details className="settings-details"><summary>Approval limitations</summary><p>Missing or ambiguous native approval options may still require a manual decision, even when a category is set to Allow or Deny.</p></details>
    {error && <p role="alert">{error} Check saved versus active values before retrying Save and apply.</p>}
  </section>;
}
