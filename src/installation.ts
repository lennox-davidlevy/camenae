import { PgMigrator } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import installationMigration from "./migrations/001-installation.js";
import identityMigration from "./migrations/002-identity.js";
import chatMigration from "./migrations/003-chat.js";
import harnessMigration from "./migrations/008-harness.js";
import consoleConnectionMigration from "./migrations/009-console-connection.js";
import consoleBudgetModelMigration from "./migrations/010-console-budget-model.js";
import threadActivityMigration from "./migrations/011-thread-activity.js";
import turnAttachmentsMigration from "./migrations/012-turn-attachments.js";
import retireLegacyHarnessMigration from "./migrations/013-retire-legacy-harness.js";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {}) {}

const InstallationRows = z.array(z.object({ id: z.uuid() })).length(1);

export class Installation extends Context.Service<Installation, {
  readonly id: string;
  readonly check: () => Effect.Effect<void, DatabaseError>;
}>()("camenae/Installation") {
  static readonly layer = Layer.effect(Installation, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* PgMigrator.run({ loader: PgMigrator.fromRecord({
      "001_installation": installationMigration,
      "002_identity": identityMigration,
      "003_chat": chatMigration,
      "008_harness": harnessMigration,
      "009_console_connection": consoleConnectionMigration,
      "010_console_budget_model": consoleBudgetModelMigration,
      "011_thread_activity": threadActivityMigration,
      "012_turn_attachments": turnAttachmentsMigration,
      "013_retire_legacy_harness": retireLegacyHarnessMigration,
    }) });
    const parsed = InstallationRows.safeParse(yield* sql`SELECT id FROM installation WHERE singleton = true`);
    const row = parsed.success ? parsed.data[0] : undefined;

    if (!row) return yield* new DatabaseError();

    const check = Effect.fn("Installation.check")(function* () {
      yield* sql`SELECT 1`;
    }, Effect.mapError(() => new DatabaseError()));

    return Installation.of({ id: row.id, check });
  }).pipe(Effect.mapError(() => new DatabaseError())));
}
