import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Existing IDs stay bound to Bob; a deployment default never reinterprets them.
  yield* sql`ALTER TABLE conversation ADD COLUMN harness text NOT NULL DEFAULT 'bob'
    CHECK (harness IN ('bob', 'opencode'))`;
});
