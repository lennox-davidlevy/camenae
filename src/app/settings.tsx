/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { Match } from "effect";
import { z } from "zod";
import { ConsoleSettings, consoleExhausted, consoleModel, RequestCap, type ConsoleUsage } from "../console-contract.js";
import { request, RequestError, type SettingsRequest } from "./api.js";
import "../ui/settings.css";

const sections = ["Provider", "Account"] as const;

export function RequestLimitNotice(props: { usage: ConsoleUsage; children?: JSX.Element }) {
  return <div class="request-limit-notice" role="status">
    <strong>OpenCode request limit reached · {props.usage.used} / {props.usage.limit}</strong>
    <p>The local safety allowance is exhausted, not a connection failure or provider quota. Change the cap or refresh the allowance in Settings → Provider. Saving or replacing a key will not reset it.</p>
    {props.children}
  </div>;
}

interface SettingsPageProps {
  csrf: string;
  usage: ConsoleUsage | null;
  onChanged: (connectionChanged: boolean) => Promise<void>;
}

export function SettingsPage(props: SettingsPageProps) {
  const [section, setSection] = createSignal<typeof sections[number]>("Provider");
  const tabs: HTMLButtonElement[] = [];

  const select = (index: number) => {
    const next = sections[index];

    if (!next) return;
    setSection(next);
    tabs[index]?.focus();
  };

  const move = (event: KeyboardEvent, index: number) => {
    const next = Match.value(event.key).pipe(
      Match.when("ArrowRight", () => (index + 1) % sections.length),
      Match.when("ArrowLeft", () => (index + sections.length - 1) % sections.length),
      Match.when("Home", () => 0),
      Match.when("End", () => sections.length - 1),
      Match.orElse(() => undefined),
    );

    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return <div class="settings-page">
    <div class="settings-eyebrow"><span class="settings-workspace-label">Workspace</span><span>Shared across conversations</span></div>
    <h1>Settings</h1>
    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      <For each={sections}>{(name, index) => <button ref={(element) => { tabs[index()] = element; }} role="tab" aria-selected={section() === name}
        tabIndex={section() === name ? 0 : -1} onClick={() => setSection(name)} onKeyDown={(event) => move(event, index())}>
        <span>{["I", "II"][index()]}</span>{name}
      </button>}</For>
    </div>
    <div role="tabpanel" hidden={section() !== "Provider"}>
      <section class="settings-section" aria-label="Provider settings">
        <div class="settings-section-heading"><h2>Provider</h2><p>The agent runtime behind a conversation.</p></div>
        <ProviderSettings csrf={props.csrf} usage={props.usage} onChanged={props.onChanged} />
      </section>
    </div>
    <div role="tabpanel" hidden={section() !== "Account"}>
      <section class="settings-section" aria-label="Account settings"><h2>Account</h2><div class="settings-account-grid">
        <div><h3>Your account</h3><p>Choose your own sign-in password or sign out of this workspace.</p><div class="settings-actions"><a href="/auth/password">Manage account ↗</a>
          <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value={props.csrf} /><button type="submit">Sign out</button></form></div></div>
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

function ProviderSettings(props: SettingsPageProps) {
  const [settings, setSettings] = createSignal<z.infer<typeof ConsoleSettings>>();
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  let version = 0;
  let saving = false;

  const refresh = async () => {
    if (saving) return;
    const current = ++version;
    const response = await request("/api/settings/opencode");
    const value = ConsoleSettings.parse(await response.json());

    if (current === version) setSettings(value);
  };

  onMount(() => {
    void refresh().then(() => props.onChanged(false)).catch(() => setError("Could not load OpenCode settings."));
  });

  // A newer bootstrap reading can be ahead of the last settings reading.
  const allowance = createMemo(() => {
    const usage = props.usage;
    const saved = settings();

    return usage && (!saved || usage.revision > saved.revision || (usage.revision === saved.revision && usage.used > saved.used)) ? usage : saved;
  });

  const submit = async (path: string, body: SettingsRequest, connectionChanged: boolean, done: string) => {
    saving = true;
    version++;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await request(path, body);
      setSettings(ConsoleSettings.parse(await response.json()));
      await props.onChanged(connectionChanged);
      setMessage(done);

      return true;
    } catch (failure) {
      setError(failure instanceof RequestError && failure.status === 409
        ? "Allowance changed elsewhere. Refresh status before retrying."
        : "OpenCode settings were not confirmed saved. Refresh status before retrying.");

      return false;
    } finally {
      saving = false;
      setBusy(false);
    }
  };

  const saveKey = async () => {
    const saved = await submit("/api/settings/opencode", { csrf: props.csrf, provider: "console", model: consoleModel, key: key() }, true,
      "Console key saved. No provider request was made. Check the request allowance before starting a chat.");

    if (saved) setKey("");
  };

  const removeKey = () => submit("/api/settings/opencode/remove", { csrf: props.csrf }, true, "Console key removed.");

  const saveBudget = (limit: number | null, refreshAllowance: boolean) => {
    const current = allowance();

    if (!current) return Promise.resolve(false);

    return submit("/api/settings/opencode/budget", { csrf: props.csrf, limit, refresh: refreshAllowance, revision: current.revision }, false,
      refreshAllowance ? "Allowance refreshed. Lifetime request history is preserved." : "Request cap saved. Usage was not reset.");
  };

  const exhausted = () => {
    const current = allowance();

    return current !== undefined && consoleExhausted(current);
  };

  return <section class="settings-section harness-connection" aria-label="OpenCode connection">
    <div class="settings-section-heading"><h3>OpenCode connection</h3><span>Console · free-only</span></div>
    <Show when={exhausted() ? allowance() : undefined}>{(usage) => <RequestLimitNotice usage={usage()} />}</Show>
    <Show when={!settings() && !error()}><p role="status">Loading OpenCode connection…</p></Show>
    <Show when={settings()}>{(saved) => <>
      <Show when={!saved().enabled}><p role="status">The Console/free-only worker is not enabled for this installation. Deployment setup is required before saving a key.</p></Show>
      <form onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
        <div class="settings-rows">
          <label class="settings-row">Provider <select aria-label="OpenCode provider" disabled><option>Console (free-only)</option></select></label>
          <div class="settings-row"><span>Model</span><span>Choose a free model inside each OpenCode chat, including existing chats, between turns.</span></div>
          <label class="settings-row">Console API key <input type="password" autocomplete="new-password" value={key()} maxLength={4096}
            disabled={busy() || !saved().enabled} onInput={(event) => setKey(event.currentTarget.value)} placeholder={saved().stored ? "Key saved — enter a replacement" : "Enter API key"} /></label>
        </div>
        <p class="settings-key-status">Key: {saved().stored ? "saved (encrypted)" : "not saved"}.</p>
        <div class="settings-actions">
          <button class="settings-save" type="submit" disabled={busy() || !saved().enabled || !key().trim()}>Save Console key</button>
          <button type="button" disabled={busy() || !saved().stored} onClick={() => void removeKey()}>Remove Console key</button>
        </div>
      </form>
      <Show when={allowance()}>{(usage) => <For each={[usage().revision]}>{() =>
        <ConsoleBudget usage={usage()} disabled={busy() || !saved().enabled} onSave={saveBudget} />}</For>}</Show>
      <ol class="settings-connection-notes">
        <li>Only the listed free chat models are allowed, with no fallback. Provider pricing and availability can change. Jev is not a chat model; Muse's Responses API is not supported here.</li>
        <li>The local request cap is shared across all Console chats, including failed and background requests. Saving or removing a key does not reset it.</li>
        <li>Replacing or removing the key disconnects an existing OpenCode session and may stop its running turn. The key is never sent to the worker or returned to this page.</li>
      </ol>
    </>}</Show>
    <div class="settings-actions"><button class="settings-refresh" disabled={busy()} onClick={() => { setError(""); void refresh().then(() => props.onChanged(false)).catch(() => setError("Could not refresh OpenCode settings.")); }}>Refresh OpenCode status</button></div>
    <Show when={message()}><p role="status">{message()}</p></Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
  </section>;
}

interface ConsoleBudgetProps {
  usage: ConsoleUsage;
  disabled: boolean;
  onSave: (limit: number | null, refresh: boolean) => Promise<boolean>;
}

function ConsoleBudget(props: ConsoleBudgetProps) {
  const [limit, setLimit] = createSignal(String(props.usage.limit ?? 20));
  const [unlimited, setUnlimited] = createSignal(props.usage.limit === null);
  const parsed = createMemo(() => RequestCap.safeParse(unlimited() ? null : limit().trim() === "" ? undefined : Number(limit())));

  return <form class="console-budget" onSubmit={(event) => {
    event.preventDefault();
    const value = parsed();

    if (value.success) void props.onSave(value.data, false);
  }}>
    <h4>Local request allowance</h4>
    <div class="request-usage"><span>Requests used since refresh</span>
      <Show when={props.usage.limit !== null && props.usage.limit > 0}><progress aria-label="Local Console requests used" value={props.usage.used} max={props.usage.limit ?? 0} /></Show>
      <strong>{props.usage.used} / {props.usage.limit ?? "Unlimited"}</strong></div>
    <label class="settings-row">Request cap <input aria-label="Request cap" type="number" min="0" max="2147483647" step="1" required disabled={props.disabled || unlimited()} value={limit()} onInput={(event) => setLimit(event.currentTarget.value)} /></label>
    <label><input type="checkbox" checked={unlimited()} disabled={props.disabled} onChange={(event) => setUnlimited(event.currentTarget.checked)} /> Unlimited requests</label>
    <p class="settings-note">0 blocks new provider requests. Unlimited removes the local safety cap, not provider limits or billing. Requests already admitted can finish.</p>
    <div class="settings-actions">
      <button type="submit" disabled={props.disabled || !parsed().success}>Save request cap</button>
      <button type="button" disabled={props.disabled || props.usage.used === 0} onClick={() => {
        if (window.confirm(`Refresh usage to 0 with the saved cap of ${props.usage.limit ?? "Unlimited"}? Lifetime request history will be retained.`)) void props.onSave(props.usage.limit, true);
      }}>Refresh allowance</button>
    </div>
  </form>;
}
