import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE mcp_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    disabled_tools jsonb NOT NULL DEFAULT '[]'
  )`;
  yield* sql`INSERT INTO mcp_settings DEFAULT VALUES`;
});
