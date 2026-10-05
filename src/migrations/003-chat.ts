import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE conversation (
    id uuid PRIMARY KEY, title text NOT NULL, native_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  yield* sql`CREATE TABLE turn (
    id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversation(id),
    ordinal integer NOT NULL, prompt text NOT NULL, answer text NOT NULL DEFAULT '',
    activity jsonb NOT NULL DEFAULT '[]', permission jsonb,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed', 'interrupted')),
    stop_reason text, UNIQUE (conversation_id, ordinal)
  )`;
  yield* sql`CREATE UNIQUE INDEX one_active_turn ON turn ((true)) WHERE status = 'running'`;
});
