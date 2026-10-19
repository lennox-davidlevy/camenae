import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE console_connection DROP CONSTRAINT console_connection_requests_used_check`;
  yield* sql`ALTER TABLE console_connection
    ADD CONSTRAINT console_requests_nonnegative CHECK (requests_used >= 0),
    ADD COLUMN requests_limit integer DEFAULT 20 CHECK (requests_limit >= 0),
    ADD COLUMN requests_baseline integer NOT NULL DEFAULT 0 CHECK (requests_baseline >= 0 AND requests_baseline <= requests_used),
    ADD COLUMN budget_revision integer NOT NULL DEFAULT 0 CHECK (budget_revision >= 0)`;
  yield* sql`ALTER TABLE conversation ADD COLUMN console_model text`;
});
