import { Effect } from "effect";
import { SqlClient } from "effect/sql";

// Irreversible cleanup for installations created before the single-harness history.
// Every statement is a no-op on a fresh database, so both paths end in the same schema.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM turn WHERE conversation_id IN (SELECT id FROM conversation WHERE harness <> 'opencode')`;
  yield* sql`DELETE FROM conversation WHERE harness <> 'opencode'`;
  yield* sql`ALTER TABLE conversation DROP CONSTRAINT IF EXISTS conversation_harness_check`;
  yield* sql`ALTER TABLE conversation ALTER COLUMN harness SET DEFAULT 'opencode'`;
  yield* sql`ALTER TABLE turn DROP COLUMN IF EXISTS approval_decisions`;
  yield* sql`DROP TABLE IF EXISTS mcp_decision, mcp_settings, approval_settings, bob_connection`;
});
