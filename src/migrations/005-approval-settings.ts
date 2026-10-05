import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE approval_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    policy jsonb NOT NULL
  )`;
  yield* sql`INSERT INTO approval_settings (policy) VALUES (
    '{"kinds":{"edit":"ask","delete":"ask","execute":"ask","search":"ask","fetch":"ask"},"fallback":"ask"}'::jsonb
  )`;
});
