import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE console_connection (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    encrypted_key text,
    requests_used integer NOT NULL DEFAULT 0 CHECK (requests_used >= 0 AND requests_used <= 20)
  )`;
  yield* sql`INSERT INTO console_connection DEFAULT VALUES`;
});
