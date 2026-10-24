/** @jsxImportSource solid-js */
import type { SessionUsage } from "../chat-contract.js";
import "../ui/session-usage.css";

const exact = new Intl.NumberFormat("en", { maximumFractionDigits: 20 });

const number = (value: number | null | undefined) => value === null || value === undefined ? "—" : exact.format(value);

export function SessionUsagePanel(props: { usage: SessionUsage | null | undefined }) {
  return <div class="session-usage">
    <section><h2>OpenCode · this session</h2><strong>${number(props.usage?.costUSD)} USD</strong><small>Native reported cost, not an invoice or account balance.</small></section>
    <section><h2>Reported tokens</h2><p>Input {number(props.usage?.inputTokens)} · Output {number(props.usage?.outputTokens)}</p><small>These are usage totals, not context occupancy.</small></section>
  </div>;
}
