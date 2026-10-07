import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE conversation ADD COLUMN updated_at timestamptz`;
  yield* sql`UPDATE conversation SET updated_at = created_at`;
  yield* sql`ALTER TABLE conversation ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL`;
  yield* sql`CREATE INDEX conversation_recent ON conversation (updated_at DESC, id)`;
});
