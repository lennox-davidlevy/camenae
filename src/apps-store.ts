import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { App, AppSummary, appLimits, checkDefinition, checkValues, Definition, Entry, type AppView, type EntryChanges, type EntryValues, type FailureCode } from "./apps-contract.js";

export class AppProblem extends Schema.TaggedError<AppProblem>()("AppProblem", { code: Schema.String, problems: Schema.Array(Schema.String) }) {}

export class AppsError extends Schema.TaggedError<AppsError>()("AppsError", {}) {}

const problem = (code: FailureCode, problems: string[] = []) => new AppProblem({ code, problems });

const entryColumns = (sql: SqlClient.SqlClient) => sql`id, collection_id AS collection, "values",
  extract(epoch FROM created_at)::double precision * 1000 AS "createdAt", extract(epoch FROM updated_at)::double precision * 1000 AS "updatedAt"`;

const parse = <T,>(schema: z.ZodType<T>, value: readonly object[]) => Effect.try({ try: () => schema.parse(value), catch: () => new AppsError() });

// Entries go through the application only. Every write is checked against the stored definition.
export class Apps extends Context.Service<Apps, {
  readonly list: () => Effect.Effect<AppSummary[], AppsError>;
  readonly view: (app: string) => Effect.Effect<AppView, AppProblem | AppsError>;
  readonly add: (app: string, collection: string, values: EntryChanges) => Effect.Effect<Entry, AppProblem | AppsError>;
  readonly update: (app: string, id: string, values: EntryChanges) => Effect.Effect<Entry, AppProblem | AppsError>;
  readonly remove: (app: string, id: string) => Effect.Effect<void, AppProblem | AppsError>;
  readonly seed: (app: App) => Effect.Effect<boolean, AppProblem | AppsError>;
}>()("camenae/Apps") {
  static readonly layer = Layer.effect(Apps, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const definition = Effect.fn("Apps.definition")(function* (app: string, lock: boolean) {
      const rows = yield* sql`SELECT definition FROM app WHERE id = ${app} ${lock ? sql`FOR UPDATE` : sql``}`;

      if (rows.length === 0) return yield* problem("NOT_FOUND");

      return (yield* parse(z.array(z.object({ definition: Definition })).length(1), rows))[0].definition;
    });

    const collectionOf = (stored: Definition, id: string) => {
      const collection = stored.collections.find((candidate) => candidate.id === id);

      return collection ? Effect.succeed(collection) : Effect.fail(problem("NOT_FOUND"));
    };

    const list = Effect.fn("Apps.list")(function* () {
      return yield* parse(z.array(AppSummary), yield* sql`SELECT id, name, icon FROM app ORDER BY created_at, id`);
    }, Effect.catchTag("SqlError", () => new AppsError()));

    const view = Effect.fn("Apps.view")(function* (app: string) {
      const rows = yield* sql`SELECT id, name, icon, definition FROM app WHERE id = ${app}`;

      if (rows.length === 0) return yield* problem("NOT_FOUND");
      const [stored] = yield* parse(z.array(App).length(1), rows);
      const entries = yield* sql`SELECT ${entryColumns(sql)} FROM app_entry WHERE app_id = ${app} ORDER BY created_at, id`;

      return { app: stored, entries: yield* parse(z.array(Entry), entries) };
    }, Effect.catchTag("SqlError", () => new AppsError()));

    // Locking the app row serializes adds, so the entry limit holds under concurrent requests.
    const add = Effect.fn("Apps.add")(function* (app: string, collection: string, input: EntryChanges) {
      const target = yield* collectionOf(yield* definition(app, true), collection);
      const checked = checkValues(target, input, undefined);

      if (!checked.ok) return yield* problem("INVALID", checked.problems);
      const counted = yield* parse(z.array(z.object({ count: z.number() })), yield* sql`SELECT count(*)::int AS count FROM app_entry WHERE app_id = ${app}`);

      if ((counted[0]?.count ?? 0) >= appLimits.entries) return yield* problem("TOO_MANY");

      const rows = yield* sql`INSERT INTO app_entry (id, app_id, collection_id, "values")
        VALUES (${randomUUID()}, ${app}, ${collection}, ${JSON.stringify(checked.values)}::jsonb) RETURNING ${entryColumns(sql)}`;

      return (yield* parse(z.array(Entry).length(1), rows))[0];
    }, sql.withTransaction, Effect.catchTag("SqlError", () => new AppsError()));

    // Values for fields the definition no longer has are kept, so a later version can show them again.
    const update = Effect.fn("Apps.update")(function* (app: string, id: string, input: EntryChanges) {
      const stored = yield* definition(app, false);
      const rows = yield* sql`SELECT collection_id AS collection, "values" FROM app_entry WHERE id = ${id} AND app_id = ${app} FOR UPDATE`;

      if (rows.length === 0) return yield* problem("NOT_FOUND");
      const [current] = yield* parse(z.array(Entry.pick({ collection: true, values: true })).length(1), rows);
      const checked = checkValues(yield* collectionOf(stored, current.collection), input, current.values);

      if (!checked.ok) return yield* problem("INVALID", checked.problems);
      const values: EntryValues = { ...Object.fromEntries(Object.entries(current.values).filter(([field]) => !checked.cleared.includes(field))), ...checked.values };

      const updated = yield* sql`UPDATE app_entry SET "values" = ${JSON.stringify(values)}::jsonb, updated_at = now()
        WHERE id = ${id} AND app_id = ${app} RETURNING ${entryColumns(sql)}`;

      return (yield* parse(z.array(Entry).length(1), updated))[0];
    }, sql.withTransaction, Effect.catchTag("SqlError", () => new AppsError()));

    const remove = Effect.fn("Apps.remove")(function* (app: string, id: string) {
      const rows = yield* sql`DELETE FROM app_entry WHERE id = ${id} AND app_id = ${app} RETURNING id`;

      if (rows.length === 0) return yield* problem("NOT_FOUND");
    }, Effect.catchTag("SqlError", () => new AppsError()));

    // Creates an app once. An existing app with the same id is never overwritten.
    const seed = Effect.fn("Apps.seed")(function* (app: App) {
      const checked = checkDefinition(JSON.stringify(app.definition));

      if (!checked.ok) return yield* problem("INVALID", checked.problems);

      const rows = yield* sql`INSERT INTO app (id, name, icon, definition)
        VALUES (${app.id}, ${app.name}, ${app.icon}, ${JSON.stringify(checked.definition)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`;

      return rows.length === 1;
    }, Effect.catchTag("SqlError", () => new AppsError()));

    return Apps.of({ list, view, add, update, remove, seed });
  }));
}
