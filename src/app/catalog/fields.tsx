/** @jsxImportSource solid-js */
import { Match as Pattern } from "effect";
import { For, Match, Switch, untrack } from "solid-js";
import { readCell, type Cell, type EntryValue, type Field } from "../../apps-contract.js";

export type Draft = EntryValue | null;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export const formatNumber = (value: number) => numberFormat.format(value);

const rating = (field: Field, value: number) => field.type === "rating" ? `${"★".repeat(value)}${"☆".repeat(field.max - value)}` : formatNumber(value);

// Plain text for a stored value. Links are drawn separately so only http(s) addresses become anchors.
export const formatCell = (field: Field, cell: Cell | undefined) => cell === undefined ? "" : Pattern.value(cell).pipe(
  Pattern.when({ type: "date" }, (date) => dateFormat.format(new Date(`${date.value}T00:00:00Z`))),
  Pattern.when({ type: "yesNo" }, (answer) => answer.value ? "Yes" : "No"),
  Pattern.when({ type: "multiChoice" }, (choices) => choices.value.join(", ")),
  Pattern.when({ type: "rating" }, (stars) => rating(field, stars.value)),
  Pattern.when({ type: "number" }, (number) => formatNumber(number.value)),
  Pattern.orElse((text) => String(text.value)),
);

// The text an input shows for a value: numbers and strings as typed, anything else empty.
const inputText = (field: Field, value: Draft) => {
  const cell = readCell(field, value);

  return cell === undefined ? "" : Pattern.value(cell).pipe(
    Pattern.when({ type: Pattern.is("number", "rating") }, (number) => String(number.value)),
    Pattern.when({ type: Pattern.is("multiChoice", "yesNo") }, () => ""),
    Pattern.orElse((text) => text.value),
  );
};

export function FieldValue(props: { field: Field; value: EntryValue | undefined }) {
  const cell = () => readCell(props.field, props.value);

  return <Switch fallback={<span class={props.field.type === "longText" ? "app-long-text" : undefined}>{formatCell(props.field, cell())}</span>}>
    <Match when={cell()?.type === "link" ? inputText(props.field, props.value ?? null) : undefined}>
      {(href) => <a href={href()} target="_blank" rel="noopener noreferrer">{new URL(href()).host}</a>}
    </Match>
  </Switch>;
}

const options = (field: Field) => field.type === "choice" || field.type === "multiChoice" ? field.options : [];

const answer = (value: Draft) => Pattern.value(value).pipe(Pattern.when(true, () => "yes"), Pattern.when(false, () => "no"), Pattern.orElse(() => ""));

const chosen = (field: Field, value: Draft) => {
  const cell = readCell(field, value);

  return cell?.type === "multiChoice" ? cell.value : [];
};

// One input per field type. Empty input is reported as null, which clears the value. Typed boxes keep
// their own text (the value only sets where they start), so reporting a change never rewrites what is
// being typed; "input" reports every keystroke, "change" only a finished edit.
export function FieldInput(props: { field: Field; value: Draft; onChange: (value: Draft) => void; id?: string; compact?: boolean; report?: "input" | "change" }) {
  const text = () => inputText(props.field, props.value);
  const initial = untrack(text);
  const label = () => props.compact ? props.field.label : undefined;

  const number = (raw: string) => {
    const value = Number(raw);

    props.onChange(raw.trim() === "" || !Number.isFinite(value) ? null : value);
  };

  const typed = (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement; type: string }) => {
    if (event.type !== (props.report ?? "change")) return;

    if (props.field.type === "number") number(event.currentTarget.value);
    else props.onChange(event.currentTarget.value || null);
  };

  return <Switch fallback={<input id={props.id} aria-label={label()} value={initial} maxLength={2000} onInput={typed} onChange={typed} />}>
    <Match when={props.field.type === "longText"}>
      <textarea id={props.id} aria-label={label()} value={initial} rows={3} maxLength={20_000} onInput={typed} onChange={typed} />
    </Match>
    <Match when={props.field.type === "number"}>
      <input id={props.id} aria-label={label()} type="number" step="any" value={initial} onInput={typed} onChange={typed} />
    </Match>
    <Match when={props.field.type === "date"}>
      <input id={props.id} aria-label={label()} type="date" value={initial} onInput={typed} onChange={typed} />
    </Match>
    <Match when={props.field.type === "link"}>
      <input id={props.id} aria-label={label()} type="url" placeholder="https://" value={initial} onInput={typed} onChange={typed} />
    </Match>
    <Match when={props.field.type === "choice"}>
      <select id={props.id} aria-label={label()} value={text()} onChange={(event) => props.onChange(event.currentTarget.value || null)}>
        <option value="">—</option>
        <For each={options(props.field)}>{(option) => <option value={option}>{option}</option>}</For>
      </select>
    </Match>
    <Match when={props.field.type === "yesNo"}>
      <select id={props.id} aria-label={label()} value={answer(props.value)}
        onChange={(event) => props.onChange(event.currentTarget.value === "" ? null : event.currentTarget.value === "yes")}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </Match>
    <Match when={props.field.type === "rating" ? props.field : undefined}>
      {(stars) => <select id={props.id} aria-label={label()} value={text()} onChange={(event) => number(event.currentTarget.value)}>
        <option value="">—</option>
        <For each={Array.from({ length: stars().max }, (_, index) => index + 1)}>{(value) => <option value={value}>{"★".repeat(value)}</option>}</For>
      </select>}
    </Match>
    <Match when={props.field.type === "multiChoice"}>
      <fieldset id={props.id} class="app-multi" aria-label={props.field.label}>
        <For each={options(props.field)}>{(option) => <label>
          <input type="checkbox" checked={chosen(props.field, props.value).includes(option)} onChange={(event) => {
            const current = chosen(props.field, props.value);
            const next = event.currentTarget.checked ? [...current, option] : current.filter((item) => item !== option);

            props.onChange(next.length > 0 ? next : null);
          }} />{option}
        </label>}</For>
      </fieldset>
    </Match>
  </Switch>;
}
