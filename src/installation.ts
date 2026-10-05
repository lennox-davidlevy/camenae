import { PgMigrator } from "@effect/sql-pg";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import installationMigration from "./migrations/001-installation.js";
import identityMigration from "./migrations/002-identity.js";
import chatMigration from "./migrations/003-chat.js";
import mcpSettingsMigration from "./migrations/004-mcp-settings.js";
import approvalSettingsMigration from "./migrations/005-approval-settings.js";
import approvalDecisionsMigration from "./migrations/006-approval-decisions.js";
import mcpPermissionsMigration from "./migrations/007-mcp-permissions.js";

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
      "004_mcp_settings": mcpSettingsMigration,
      "005_approval_settings": approvalSettingsMigration,
      "006_approval_decisions": approvalDecisionsMigration,
      "007_mcp_permissions": mcpPermissionsMigration,
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
