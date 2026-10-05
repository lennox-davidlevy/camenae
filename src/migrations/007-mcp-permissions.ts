import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE mcp_settings ADD COLUMN permissions jsonb NOT NULL
    DEFAULT '{"context7":{"fallback":"ask","tools":{}}}'::jsonb`;
  // MCP has no authoritative ACP call/turn identity. Retain conversation scope
  // explicitly, rather than attaching events to the currently executing turn.
  yield* sql`CREATE TABLE mcp_decision (
    decision_id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    event jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`;
  yield* sql`CREATE INDEX mcp_decision_conversation ON mcp_decision(conversation_id, created_at)`;
});
