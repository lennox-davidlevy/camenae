/** @jsxImportSource solid-js */
import { createResource, Show } from "solid-js";
import { WelcomeQuote } from "../quotes-contract.js";

interface WelcomeProps {
  conversation: string;
  status: string;
  busy: boolean;
  onReconnect: () => void;
}

// No quote is fine: a checkout or install without the dataset just shows the heading.
async function fetchQuote() {
  try {
    const response = await fetch("/api/quote");

    if (!response.ok) return undefined;
    const parsed = WelcomeQuote.safeParse(await response.json());

    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

const stamp = (date: Date) => `${date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })} · ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

export function Welcome(props: WelcomeProps) {
  const openedAt = new Date();
  const [quote, { refetch }] = createResource(() => props.conversation, fetchQuote);

  return <div class="welcome">
    <div class="welcome-banner" role="img" aria-label="Camenae · Ex fonte, consilium">
      <div class="welcome-coin"><img src="/assets/camenae-coin.png" alt="" /></div>
      <div class="welcome-banner-panel">
        <img src="/assets/camenae-coin.png" alt="" />
        <div class="welcome-banner-caption"><span>Aegeria · Nº I</span><span>Ex fonte, consilium</span></div>
        <div class="welcome-banner-name">Camenae</div>
      </div>
      <div class="welcome-column" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
    <div class="welcome-heading">
      <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
      <span class="welcome-label">New Thread</span>
      <time dateTime={openedAt.toISOString()} title="Time this view was opened">{stamp(openedAt)}</time>
      <h1>What Are We Working On?</h1>
    </div>
    <Show when={quote()}>{(current) => <figure class="welcome-quote" data-kind={current().kind}>
      <blockquote><p>{current().text}</p></blockquote>
      <figcaption>
        <a href={current().href} target="_blank" rel="noopener noreferrer" title="Open the source in a new tab">— {current().attribution} <span aria-hidden="true">↗</span></a>
        <Show when={current().source}><small>{current().source}</small></Show>
        <button type="button" onClick={() => void refetch()} disabled={quote.loading}>Another ↻</button>
      </figcaption>
    </figure>}</Show>
    <p class="welcome-status" role="status">{props.status} <button type="button" disabled={props.busy} onClick={props.onReconnect}>Reconnect / refresh</button></p>
  </div>;
}
