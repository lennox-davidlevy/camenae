import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// One definition per app for now; versions arrive with drafts. Entries hold values keyed by field id.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE app (
    id text PRIMARY KEY, name text NOT NULL, icon text NOT NULL, definition jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  yield* sql`CREATE TABLE app_entry (
    id uuid PRIMARY KEY, app_id text NOT NULL REFERENCES app(id) ON DELETE CASCADE, collection_id text NOT NULL,
    "values" jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  yield* sql`CREATE INDEX app_entry_by_app ON app_entry (app_id, created_at, id)`;
});
