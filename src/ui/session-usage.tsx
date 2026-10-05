import type { SessionUsage } from "../chat-contract.js";
import "./session-usage.css";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const exact = new Intl.NumberFormat("en", { maximumFractionDigits: 20 });

const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

const number = (value: number | null | undefined) => value == null ? "—" : exact.format(value);

export function SessionUsagePanel({ usage }: { usage: SessionUsage | null }) {
  const utilization = usage && usage.contextTokens !== null && usage.contextWindow !== null && usage.contextWindow > 0
    ? usage.contextTokens / usage.contextWindow * 100 : null;

  const tokens = (value: number | null | undefined) => value == null ? "—" : compact.format(value);

  return <div className="session-usage">
    <section><h2>Context</h2>
      <div className="session-context-value"><span>{tokens(usage?.contextTokens)} / {tokens(usage?.contextWindow)}</span><small>{utilization === null ? "—" : `${percent.format(utilization)}%`}</small></div>
      <progress aria-label="Context utilization" max={100} value={utilization === null ? 0 : Math.min(100, Math.max(0, utilization))} aria-valuetext={utilization === null ? "Unknown" : `${exact.format(utilization)}%`} />
    </section>
    <section><h2>Bobcoins · this session</h2><strong>{number(usage?.bobcoins)}</strong><small>Bob-reported usage</small></section>
    <details><summary>Usage details</summary>
      <dl>
        <dt>Context tokens</dt><dd>{number(usage?.contextTokens)} / {number(usage?.contextWindow)}</dd>
        <dt>Context utilization</dt><dd>{utilization === null ? "Unknown" : `${exact.format(utilization)}%`}</dd>
        <dt>Maximum output tokens</dt><dd>{number(usage?.maxOutputTokens)}</dd>
        <dt>Automatic compaction</dt><dd>{usage ? usage.autoCompact ? "Enabled" : "Disabled" : "Unknown"}</dd>
        <dt>Compaction threshold</dt><dd>{usage?.compactionThreshold == null ? "Unknown" : `${exact.format(usage.compactionThreshold * 100)}% (advisory)`}</dd>
      </dl>
      <p>Latest report from the connected harness. Updates on session initialization, mode changes, and turn settlement—not continuously while working. Context can decrease after compaction.</p>
      <p>Output limit is not remaining context. Bobcoins are cumulative root-task spending, including child spending Bob has merged. Missing charges may be recorded as zero; zero does not prove a request was free. Not an account balance or invoice.</p>
    </details>
  </div>;
}
