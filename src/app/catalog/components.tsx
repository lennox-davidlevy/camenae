/** @jsxImportSource solid-js */
import { defineRegistry, useStateValue } from "@json-render/solid";
import { Match } from "effect";
import { createMemo, createSignal, For, Show } from "solid-js";
import { findField, readCell, type Collection, type ComponentProps, type Entry, type EntryChanges, type EntryValue, type Field } from "../../apps-contract.js";
import { catalog } from "./catalog.js";
import { entriesPath, useApp } from "./context.js";
import { FieldInput, FieldValue, formatNumber, type Draft } from "./fields.js";

function useCollection(id: string) {
  const app = useApp();
  const all = useStateValue<readonly Entry[]>(entriesPath);
  const collection = createMemo(() => app.app().definition.collections.find((candidate) => candidate.id === id));
  const entries = createMemo(() => (all() ?? []).filter((entry) => entry.collection === id));

  return { app, collection, entries };
}

const fieldsOf = (collection: Collection, ids: readonly string[]) => ids.flatMap((id) => findField(collection, id) ?? []);

const matches = (entry: Entry, condition?: { field: string; equals: string }) => !condition || entry.values[condition.field] === condition.equals;

// Sorts by the field's meaning: option order for choices, numbers numerically, text naturally. Empty values last.
const sortKey = (field: Field, value: EntryValue | undefined) => {
  const cell = readCell(field, value);

  if (cell === undefined) return undefined;

  return Match.value(cell).pipe(
    Match.when({ type: "choice" }, (choice) => field.type === "choice" ? field.options.indexOf(choice.value) : 0),
    Match.when({ type: Match.is("number", "rating") }, (number) => number.value),
    Match.when({ type: "yesNo" }, (answer) => answer.value ? 0 : 1),
    Match.when({ type: "multiChoice" }, (choices) => choices.value.join(", ")),
    Match.orElse((text) => text.value),
  );
};

const compare = (field: Field, left: EntryValue | undefined, right: EntryValue | undefined) => {
  const [a, b] = [sortKey(field, left), sortKey(field, right)];

  if (a === undefined || b === undefined) return Number(a === undefined) - Number(b === undefined);

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

const yesNo = (value: EntryValue | undefined) => Match.value(value).pipe(Match.when(true, () => "Yes"), Match.when(false, () => "No"), Match.orElse(() => ""));

const filterOptions = (field: Field) => field.type === "yesNo" ? ["Yes", "No"] : field.type === "choice" || field.type === "multiChoice" ? field.options : [];

const passes = (field: Field, value: EntryValue | undefined, selected: string) => {
  if (selected === "") return true;

  if (field.type === "yesNo") return yesNo(value) === selected;
  const cell = readCell(field, value);

  return cell?.type === "multiChoice" ? cell.value.includes(selected) : cell?.value === selected;
};

function Stat(props: { props: ComponentProps<"Stat"> }) {
  const { collection, entries } = useCollection(props.props.collection);

  const value = createMemo(() => {
    const rows = entries().filter((entry) => matches(entry, props.props.where));

    if (props.props.measure === "count") return formatNumber(rows.length);
    const field = props.props.field;
    const target = collection();
    const definition = target && field ? findField(target, field) : undefined;

    const numbers = rows.flatMap((entry) => {
      const cell = definition ? readCell(definition, entry.values[definition.id]) : undefined;

      return cell?.type === "number" || cell?.type === "rating" ? [cell.value] : [];
    });

    const sum = numbers.reduce((total, number) => total + number, 0);

    if (props.props.measure === "sum") return formatNumber(sum);

    return numbers.length > 0 ? formatNumber(sum / numbers.length) : "—";
  });

  return <div class="app-stat"><span>{props.props.label}</span><strong>{value()}</strong></div>;
}

function EntryForm(props: { props: ComponentProps<"EntryForm"> }) {
  const { app, collection } = useCollection(props.props.collection);
  const [values, setValues] = createSignal<Record<string, Draft>>({});
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  // Typed boxes keep their own text, so a successful add starts a fresh set of inputs.
  const [round, setRound] = createSignal(0);
  const prefix = `entry-form-${Math.random().toString(36).slice(2)}`;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (busy()) return;
    setBusy(true);
    const changes: EntryChanges = Object.fromEntries(Object.entries(values()).filter(([, value]) => value !== null));
    const failure = await app.add(props.props.collection, changes);
    setBusy(false);
    setError(failure ?? "");

    if (failure === undefined) {
      setValues({});
      setRound(round() + 1);
    }
  };

  return <Show when={collection()}>{(target) => <form class="app-form" onSubmit={(event) => void submit(event)}>
    <For each={fieldsOf(target(), props.props.fields)}>{(field) => <div class={`app-form-field app-form-${field.type}`}>
      <label for={`${prefix}-${field.id}`}>{field.label}{field.required ? " *" : ""}</label>
      <For each={[round()]}>{() => <FieldInput id={`${prefix}-${field.id}`} field={field} report="input" value={values()[field.id] ?? null}
        onChange={(value) => setValues({ ...values(), [field.id]: value })} />}</For>
    </div>}</For>
    <Show when={error()}><p role="alert" class="app-problem">{error()}</p></Show>
    <div class="app-form-actions"><button type="submit" disabled={busy()}>{props.props.submit}</button></div>
  </form>}</Show>;
}

function Row(props: { entry: Entry; columns: readonly Field[]; edit: readonly string[]; remove: boolean; muted: boolean; onError: (message: string) => void }) {
  const app = useApp();
  const [confirming, setConfirming] = createSignal(false);

  const change = async (field: Field, value: Draft) => {
    props.onError(await app.update(props.entry.id, { [field.id]: value }) ?? "");
  };

  const remove = async () => {
    if (!confirming()) return setConfirming(true);

    props.onError(await app.remove(props.entry.id) ?? "");
  };

  return <tr class={props.muted ? "app-row-muted" : undefined}>
    <For each={props.columns}>{(field) => <td>
      <Show when={props.edit.includes(field.id)} fallback={<FieldValue field={field} value={props.entry.values[field.id]} />}>
        <FieldInput field={field} compact value={props.entry.values[field.id] ?? null} onChange={(value) => void change(field, value)} />
      </Show>
    </td>}</For>
    <Show when={props.remove}><td class="app-row-actions">
      <Show when={confirming()} fallback={<button onClick={() => void remove()} aria-label="Delete entry">Delete</button>}>
        <button class="app-danger" onClick={() => void remove()}>Delete?</button><button onClick={() => setConfirming(false)}>Keep</button>
      </Show>
    </td></Show>
  </tr>;
}

function Table(props: { props: ComponentProps<"Table"> }) {
  const { app, collection, entries } = useCollection(props.props.collection);
  const [filters, setFilters] = createSignal<Record<string, string>>({});
  const [sort, setSort] = createSignal(props.props.sort);
  const [error, setError] = createSignal("");

  const editable = () => app.allowed("entry.update", props.props.collection) ? props.props.edit ?? [] : [];
  const removable = () => props.props.remove === true && app.allowed("entry.remove", props.props.collection);

  const rows = createMemo(() => {
    const target = collection();

    if (!target) return [];
    const visible = entries().filter((entry) => fieldsOf(target, props.props.filters ?? []).every((field) => passes(field, entry.values[field.id], filters()[field.id] ?? "")));
    const order = sort();
    const field = order ? findField(target, order.field) : undefined;

    if (!order || !field) return visible;

    return [...visible].sort((left, right) => compare(field, left.values[field.id], right.values[field.id]) * (order.direction === "asc" ? 1 : -1));
  });

  // Groups follow the field's option order; entries without a value come last.
  const groups = createMemo(() => {
    const target = collection();
    const field = target && props.props.group ? findField(target, props.props.group) : undefined;

    if (!field) return [{ label: "", rows: rows() }];
    const labels = filterOptions(field);
    const key = (entry: Entry) => field.type === "yesNo" ? yesNo(entry.values[field.id]) : String(entry.values[field.id] ?? "");

    return [...labels, ""].flatMap((label) => {
      const members = rows().filter((entry) => key(entry) === label);

      return members.length > 0 ? [{ label: label || "No value", rows: members }] : [];
    });
  });

  const direction = () => sort()?.direction === "asc" ? "ascending" : "descending";

  const toggle = (field: string) => {
    const current = sort();

    setSort({ field, direction: current?.field === field && current.direction === "asc" ? "desc" : "asc" });
  };

  return <Show when={collection()}>{(target) => <div class="app-table-wrap">
    <Show when={(props.props.filters ?? []).length > 0}>
      <div class="app-filters">
        <For each={fieldsOf(target(), props.props.filters ?? [])}>{(field) => <label>{field.label}
          <select value={filters()[field.id] ?? ""} onChange={(event) => setFilters({ ...filters(), [field.id]: event.currentTarget.value })}>
            <option value="">All</option>
            <For each={filterOptions(field)}>{(option) => <option value={option}>{option}</option>}</For>
          </select>
        </label>}</For>
        <span class="app-count">{rows().length} of {entries().length}</span>
      </div>
    </Show>
    <Show when={error()}><p role="alert" class="app-problem">{error()}</p></Show>
    <table class="app-table">
      <thead><tr>
        <For each={fieldsOf(target(), props.props.columns)}>{(field) => <th aria-sort={sort()?.field === field.id ? direction() : undefined}>
          <button onClick={() => toggle(field.id)}>{field.label}</button>
        </th>}</For>
        <Show when={removable()}><th><span class="visually-hidden">Actions</span></th></Show>
      </tr></thead>
      <For each={groups()}>{(group) => <tbody>
        <Show when={props.props.group}><tr class="app-group"><th colSpan={props.props.columns.length + (removable() ? 1 : 0)}>{group.label} · {group.rows.length}</th></tr></Show>
        <For each={group.rows}>{(entry) => <Row entry={entry} columns={fieldsOf(target(), props.props.columns)} edit={editable()} remove={removable()}
          muted={props.props.muted !== undefined && matches(entry, props.props.muted)} onError={setError} />}</For>
      </tbody>}</For>
    </table>
    <Show when={rows().length === 0}><p class="app-empty">{entries().length === 0 ? props.props.empty ?? "No entries yet." : "Nothing matches these filters."}</p></Show>
  </div>}</Show>;
}

export const { registry } = defineRegistry(catalog, {
  components: {
    Page: (render) => <article class="app-page">
      <header><h1>{render.props.title}</h1><Show when={render.props.description}><p>{render.props.description}</p></Show></header>
      {render.children}
    </article>,
    Section: (render) => <section class="app-section"><Show when={render.props.title}><h2>{render.props.title}</h2></Show>{render.children}</section>,
    Columns: (render) => <div class="app-columns" style={{ "--app-columns": String(render.props.count) }}>{render.children}</div>,
    Table: (render) => <Table props={render.props} />,
    EntryForm: (render) => <EntryForm props={render.props} />,
    Stat: (render) => <Stat props={render.props} />,
  },
});
