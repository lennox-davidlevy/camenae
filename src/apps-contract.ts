import { z } from "zod";

// An app is an application-owned definition: collections of entries plus a json-render spec built from
// the Camenae catalog. Field and collection ids are generated once and never reused, so a rename is a
// label change, never a data migration. Entries are stored separately, keyed by field id.
export const appLimits = {
  definitionBytes: 64 * 1024, collections: 8, fields: 40, options: 50, elements: 100, children: 50, entries: 2000,
  text: 2000, longText: 20_000,
} as const;

const plain = (allowNewlines: boolean) => (text: string) => ![...text].some((character) => {
  const code = character.codePointAt(0) ?? 0;

  return (code < 32 && !(allowNewlines && (code === 10 || code === 9))) || code === 127 || (code >= 0xd800 && code <= 0xdfff);
});

// Names shown in the interface: one line, no markup-like characters.
export const Label = z.string().trim().min(1).max(80).refine(plain(false)).refine((text) => !/[<>]/.test(text));

const Note = z.string().trim().min(1).max(400).refine(plain(false)).refine((text) => !/[<>]/.test(text));

export const AppId = z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const CollectionId = z.string().regex(/^c_[a-z0-9]{4,24}$/);

export const FieldId = z.string().regex(/^f_[a-z0-9]{4,24}$/);

export const EntryId = z.uuid();

const unique = (values: readonly string[]) => new Set(values).size === values.length;

const Options = z.array(Label).min(1).max(appLimits.options).refine(unique, "Options must be unique");

const base = { id: FieldId, label: Label, required: z.boolean().optional() };

export const Field = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("text") }),
  z.strictObject({ ...base, type: z.literal("longText") }),
  z.strictObject({ ...base, type: z.literal("number"), min: z.number().optional(), max: z.number().optional() }),
  z.strictObject({ ...base, type: z.literal("date") }),
  z.strictObject({ ...base, type: z.literal("choice"), options: Options }),
  z.strictObject({ ...base, type: z.literal("multiChoice"), options: Options }),
  z.strictObject({ ...base, type: z.literal("yesNo") }),
  z.strictObject({ ...base, type: z.literal("rating"), max: z.number().int().min(3).max(10) }),
  z.strictObject({ ...base, type: z.literal("link") }),
]);

export type Field = z.infer<typeof Field>;

export const Collection = z.strictObject({ id: CollectionId, label: Label, fields: z.array(Field).min(1).max(appLimits.fields) });

export type Collection = z.infer<typeof Collection>;

export const EntryAction = z.enum(["entry.add", "entry.update", "entry.remove"]);

export type EntryAction = z.infer<typeof EntryAction>;

const Condition = z.strictObject({ field: FieldId, equals: Label });

// Props for each catalog component. The application checks every element against these before
// storing or rendering it; json-render's own catalog validation is not relied on.
export const ComponentName = z.enum(["Page", "Section", "Columns", "Table", "EntryForm", "Stat"]);

export type ComponentName = z.infer<typeof ComponentName>;

export const componentProps = {
  Page: z.strictObject({ title: Label, description: Note.optional() }),
  Section: z.strictObject({ title: Label.optional() }),
  Columns: z.strictObject({ count: z.number().int().min(2).max(4) }),
  Table: z.strictObject({
    collection: CollectionId, columns: z.array(FieldId).min(1).max(12),
    sort: z.strictObject({ field: FieldId, direction: z.enum(["asc", "desc"]) }).optional(),
    filters: z.array(FieldId).max(4).optional(), group: FieldId.optional(), edit: z.array(FieldId).max(12).optional(),
    remove: z.boolean().optional(), muted: Condition.optional(), empty: Note.optional(),
  }),
  EntryForm: z.strictObject({ collection: CollectionId, fields: z.array(FieldId).min(1).max(20), submit: Label }),
  Stat: z.strictObject({
    label: Label, collection: CollectionId, measure: z.enum(["count", "sum", "average"]), field: FieldId.optional(), where: Condition.optional(),
  }),
} satisfies Record<ComponentName, z.ZodType>;

export type ComponentProps<N extends ComponentName> = z.infer<typeof componentProps[N]>;

const containers = new Set<string>(["Page", "Section", "Columns"]);

export const ElementKey = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

// A strict subset of json-render's flat spec: no visibility, repeat, watch or event bindings yet.
export const Element = z.strictObject({
  type: ComponentName,
  props: z.record(z.string(), z.unknown()),
  children: z.array(ElementKey).max(appLimits.children),
});

export const AppSpec = z.strictObject({ root: ElementKey, elements: z.record(ElementKey, Element) });

export type AppSpec = z.infer<typeof AppSpec>;

export const Definition = z.strictObject({
  collections: z.array(Collection).min(1).max(appLimits.collections),
  spec: AppSpec,
  actions: z.array(z.strictObject({ action: EntryAction, collection: CollectionId })).max(appLimits.collections * 3),
});

export type Definition = z.infer<typeof Definition>;

export const Icon = z.string().min(1).max(8).refine(plain(false)).refine((text) => !/[\s<>A-Za-z0-9]/.test(text));

export const AppSummary = z.object({ id: AppId, name: Label, icon: Icon });

export type AppSummary = z.infer<typeof AppSummary>;

export const App = z.object({ ...AppSummary.shape, definition: Definition });

export type App = z.infer<typeof App>;

export const findField = (collection: Collection, id: string) => collection.fields.find((field) => field.id === id);

// Cross-references the schemas cannot express. Messages are precise, so whoever wrote the definition can fix it.
export function definitionProblems(definition: Definition): string[] {
  const problems: string[] = [];
  const collections = new Map(definition.collections.map((collection) => [collection.id, collection]));
  const fieldIds = definition.collections.flatMap((collection) => collection.fields.map((field) => field.id));
  const declared = new Set(definition.actions.map((entry) => `${entry.action} ${entry.collection}`));

  if (collections.size !== definition.collections.length) problems.push("Collection ids must be unique.");

  if (!unique(fieldIds)) problems.push("Field ids must be unique across the app.");

  for (const entry of definition.actions) {
    if (!collections.has(entry.collection)) problems.push(`Action ${entry.action} names unknown collection ${entry.collection}.`);
  }

  const elements = Object.entries(definition.spec.elements);

  if (elements.length > appLimits.elements) problems.push(`A spec may have at most ${appLimits.elements} elements.`);

  if (!definition.spec.elements[definition.spec.root]) problems.push(`The root element ${definition.spec.root} does not exist.`);

  // The spec must be one tree: every element but the root has exactly one parent, and all are reachable.
  const parents = new Map<string, string>();

  for (const [key, element] of elements) {
    for (const child of element.children) {
      if (!definition.spec.elements[child]) problems.push(`Element ${key} lists missing child ${child}.`);
      else if (parents.has(child) || child === definition.spec.root) problems.push(`Element ${child} appears more than once.`);
      else parents.set(child, key);
    }
  }

  for (const [key] of elements) {
    if (key !== definition.spec.root && !parents.has(key)) problems.push(`Element ${key} is not reachable from the root.`);
  }

  const require = (key: string, collection: Collection, action: EntryAction) => {
    if (!declared.has(`${action} ${collection.id}`)) problems.push(`Element ${key} needs the ${action} action declared for ${collection.id}.`);
  };

  const fields = (key: string, collection: Collection, ids: readonly string[], allowed?: readonly Field["type"][]) => {
    for (const id of ids) {
      const field = findField(collection, id);

      if (!field) problems.push(`Element ${key} names field ${id}, which is not in ${collection.id}.`);
      else if (allowed && !allowed.includes(field.type)) problems.push(`Element ${key} cannot use ${field.type} field ${id} there.`);
    }
  };

  const condition = (key: string, collection: Collection, value?: { field: string; equals: string }) => {
    if (!value) return;
    const field = findField(collection, value.field);

    if (field?.type !== "choice") problems.push(`Element ${key} compares ${value.field}, which must be a choice field.`);
    else if (!field.options.includes(value.equals)) problems.push(`Element ${key} compares ${value.field} with ${value.equals}, which is not one of its options.`);
  };

  for (const [key, element] of elements) {
    if (!containers.has(element.type) && element.children.length > 0) problems.push(`Element ${key} (${element.type}) cannot have children.`);

    const parsed = componentProps[element.type].safeParse(element.props);

    if (!parsed.success) {
      problems.push(`Element ${key} (${element.type}) has invalid props: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "props"} ${issue.message}`).join("; ")}.`);
      continue;
    }

    const props = parsed.data;

    if (!("collection" in props)) continue;
    const collection = collections.get(props.collection);

    if (!collection) {
      problems.push(`Element ${key} names unknown collection ${props.collection}.`);
      continue;
    }

    if (element.type === "Table") {
      const table = componentProps.Table.parse(props);
      fields(key, collection, table.columns);
      fields(key, collection, table.filters ?? [], ["choice", "multiChoice", "yesNo"]);
      fields(key, collection, table.group ? [table.group] : [], ["choice", "yesNo"]);
      fields(key, collection, table.sort ? [table.sort.field] : []);
      fields(key, collection, table.edit ?? []);
      condition(key, collection, table.muted);

      if ((table.edit ?? []).length > 0) require(key, collection, "entry.update");

      if (table.remove) require(key, collection, "entry.remove");
    } else if (element.type === "EntryForm") {
      const form = componentProps.EntryForm.parse(props);
      fields(key, collection, form.fields);
      require(key, collection, "entry.add");

      for (const field of collection.fields) {
        if (field.required && !form.fields.includes(field.id)) problems.push(`Element ${key} must include required field ${field.id}.`);
      }
    } else if (element.type === "Stat") {
      const stat = componentProps.Stat.parse(props);

      if (stat.measure === "count" && stat.field) problems.push(`Element ${key} counts entries and takes no field.`);

      if (stat.measure !== "count") {
        if (stat.field) fields(key, collection, [stat.field], ["number", "rating"]);
        else problems.push(`Element ${key} needs a number or rating field to ${stat.measure}.`);
      }

      condition(key, collection, stat.where);
    }
  }

  return problems;
}

export type DefinitionCheck = { ok: true; definition: Definition } | { ok: false; problems: string[] };

const parseJson = (text: string) => {
  try { return Definition.safeParse(JSON.parse(text)); } catch { return Definition.safeParse(undefined); }
};

// Definitions arrive as JSON text, whoever wrote them.
export function checkDefinition(text: string): DefinitionCheck {
  if (new TextEncoder().encode(text).byteLength > appLimits.definitionBytes) return { ok: false, problems: [`A definition may be at most ${appLimits.definitionBytes} bytes.`] };
  const parsed = parseJson(text);

  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "definition"}: ${issue.message}`) };
  const problems = definitionProblems(parsed.data);

  return problems.length > 0 ? { ok: false, problems } : { ok: true, definition: parsed.data };
}

const isDate = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
};

const isLink = (text: string) => {
  try {
    const url = new URL(text);

    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= appLimits.text;
  } catch {
    return false;
  }
};

// The stored form of one value. An empty value is absent from an entry, never stored as null.
export const valueSchema = (field: Field): z.ZodType<string | number | boolean | string[]> => {
  switch (field.type) {
    case "text": return z.string().trim().min(1).max(appLimits.text).refine(plain(false));
    case "longText": return z.string().trim().min(1).max(appLimits.longText).refine(plain(true));
    case "number": return z.number().finite().refine((value) => (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max), "Out of range");
    case "date": return z.string().refine(isDate, "Use a date like 2026-10-28");
    case "choice": return z.string().refine((value) => field.options.includes(value), "Choose one of the options");
    case "multiChoice": return z.array(z.string().refine((value) => field.options.includes(value), "Choose from the options")).min(1).refine(unique, "Choose each option once");
    case "yesNo": return z.boolean();
    case "rating": return z.number().int().min(1).max(field.max);
    case "link": return z.string().trim().refine(isLink, "Use a full http or https link");
  }
};

export type EntryValue = string | number | boolean | string[];

// A stored value read through its field's type, for display, sorting and editing.
const CellSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["text", "longText", "date", "choice", "link"]), value: z.string() }),
  z.object({ type: z.enum(["number", "rating"]), value: z.number() }),
  z.object({ type: z.literal("yesNo"), value: z.boolean() }),
  z.object({ type: z.literal("multiChoice"), value: z.array(z.string()) }),
]);

export type Cell = z.infer<typeof CellSchema>;

export const readCell = (field: Field, value: EntryValue | null | undefined): Cell | undefined => {
  const parsed = CellSchema.safeParse({ type: field.type, value });

  return parsed.success ? parsed.data : undefined;
};

export type EntryValues = Record<string, EntryValue>;

// Changes as sent: null (or an empty string) clears a value.
export const EntryChanges = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]));

export type EntryChanges = z.infer<typeof EntryChanges>;

export type ValuesCheck = { ok: true; values: EntryValues; cleared: string[] } | { ok: false; problems: string[] };

// Checks a set of changes against a collection. null clears a value. When adding, every required field must be given.
export function checkValues(collection: Collection, input: EntryChanges, current: EntryValues | undefined): ValuesCheck {
  const problems: string[] = [];
  const values: EntryValues = {};
  const cleared: string[] = [];

  for (const [id, value] of Object.entries(input)) {
    const field = findField(collection, id);

    if (!field) {
      problems.push(`${id} is not a field of ${collection.label}.`);
      continue;
    }

    if (value === null || value === "") {
      cleared.push(id);
      continue;
    }

    const parsed = valueSchema(field).safeParse(value);

    if (parsed.success) values[id] = parsed.data;
    else problems.push(`${field.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}.`);
  }

  for (const field of collection.fields) {
    const present = field.id in values || (current !== undefined && field.id in current && !cleared.includes(field.id));

    if (field.required && !present) problems.push(`${field.label} is required.`);
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, values, cleared };
}

export const Entry = z.object({
  id: EntryId, collection: CollectionId, values: z.record(FieldId, z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(),
});

export type Entry = z.infer<typeof Entry>;

export const AppList = z.object({ apps: z.array(AppSummary) });

export const AppView = z.object({ app: App, entries: z.array(Entry) });

export type AppView = z.infer<typeof AppView>;

export const AddEntry = z.object({ csrf: z.string(), app: AppId, collection: CollectionId, values: EntryChanges });

export const UpdateEntry = z.object({ csrf: z.string(), app: AppId, id: EntryId, values: EntryChanges });

export const RemoveEntry = z.object({ csrf: z.string(), app: AppId, id: EntryId });

export const EntryReply = z.object({ entry: Entry });

export const FailureCode = z.enum(["INVALID", "NOT_FOUND", "TOO_MANY"]);

export type FailureCode = z.infer<typeof FailureCode>;

export const failureMessages = {
  INVALID: "That entry is not valid. Nothing was changed.",
  NOT_FOUND: "That app or entry no longer exists.",
  TOO_MANY: "This app is full. Remove an entry first.",
} satisfies Record<FailureCode, string>;

export const Failure = z.object({ code: FailureCode, message: z.string(), problems: z.array(z.string()).optional() });
