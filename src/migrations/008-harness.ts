import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Validated by the application, so adding a harness never needs a schema change.
  yield* sql`ALTER TABLE conversation ADD COLUMN harness text NOT NULL DEFAULT 'opencode'`;
});
