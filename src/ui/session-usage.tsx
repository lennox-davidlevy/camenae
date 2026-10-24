import type { SessionUsage } from "../chat-contract.js";
import "./session-usage.css";

const exact = new Intl.NumberFormat("en", { maximumFractionDigits: 20 });

const number = (value: number | null | undefined) => value == null ? "—" : exact.format(value);

export function SessionUsagePanel({ usage }: { usage: SessionUsage | null }) {
  return <div className="session-usage">
    <section><h2>OpenCode · this session</h2><strong>${number(usage?.costUSD)} USD</strong><small>Native reported cost, not an invoice or account balance.</small></section>
    <section><h2>Reported tokens</h2><p>Input {number(usage?.inputTokens)} · Output {number(usage?.outputTokens)}</p><small>These are usage totals, not context occupancy.</small></section>
  </div>;
}
