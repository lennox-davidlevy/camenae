import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE local_account (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    password_hash text NOT NULL,
    next_login_at timestamptz NOT NULL DEFAULT now()
  )`;
  yield* sql`CREATE TABLE login_session (
    token_hash text PRIMARY KEY,
    csrf text NOT NULL,
    expires_at timestamptz NOT NULL
  )`;
});
