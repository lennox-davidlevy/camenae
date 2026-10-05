import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { BobManagedMcpServer } from "@camenae/bob";
import { createMcpToolGate, type McpToolGate } from "@camenae/bob/mcp";
import { Config, Context, Effect, Layer, Schema, Scope } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { context7Tools, McpAutomaticDecision, McpHistory, type DisabledTools, type McpPolicies } from "./mcp-contract.js";

export class McpError extends Schema.TaggedError<McpError>()("McpError", {}) {}

export interface McpBinding {
  readonly conversation: string;
  readonly servers: BobManagedMcpServer[];
}

export class McpPermissions extends Context.Service<McpPermissions, {
  readonly open: (conversation: string, disabled: DisabledTools, policies: McpPolicies) => Effect.Effect<McpBinding, McpError, Scope.Scope>;
  readonly view: (conversation: string) => Effect.Effect<z.infer<typeof McpHistory>, McpError>;
  readonly approve: (conversation: string, permissionId: string, decision: "allow" | "deny") => Effect.Effect<void, McpError>;
}>()("camenae/McpPermissions") {
  static readonly layer = Layer.effect(McpPermissions, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const host = yield* Config.String("CAMENAE_MCP_HOST").pipe(Config.withDefault("127.0.0.1"));
    const port = yield* Config.Number("CAMENAE_MCP_PORT").pipe(Config.withDefault(3001));
    // Deployment configuration only, never a URL provided by Bob or a settings request.
    const upstream = yield* Config.String("CAMENAE_CONTEXT7_URL").pipe(Config.withDefault("https://mcp.context7.com/mcp"));
    const routes = new Map<string, McpToolGate>();

    const pending = new Map<string, {
      conversation: string; serverName: string; toolName: string; settle: (decision: "allow" | "deny") => void;
    }>();

    const writes = new Set<Promise<void>>();

    const unsaved = new Map<string, { conversation: string; event: z.infer<typeof McpAutomaticDecision> }>();

    const persist = (conversation: string, event: z.infer<typeof McpAutomaticDecision>) => {
      const write = Effect.runPromise(sql`INSERT INTO mcp_decision (decision_id, conversation_id, event)
        VALUES (${event.decisionId}, ${conversation}, ${JSON.stringify(event)}::jsonb) ON CONFLICT DO NOTHING`)
        .then(() => { unsaved.delete(event.decisionId); }, () => {});

      writes.add(write);
      void write.finally(() => writes.delete(write));

      return write;
    };

    yield* Effect.acquireRelease(Effect.tryPromise(() => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
      const server = createServer((request, response) => {
        const gate = routes.get(request.url ?? "");

        if (!gate) {
          response.writeHead(404); response.end();

          return;
        }

        void gate.handleRequest(request, response).catch(() => { response.destroy(); });
      });

      server.once("error", reject);
      server.listen(port, host, () => { server.removeListener("error", reject); resolve(server); });
    })), (server) => Effect.promise(async () => {
      await Promise.all([...routes.values()].map((gate) => gate.close()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all(writes);
    }));

    const open = Effect.fn("McpPermissions.open")(function* (conversation: string, disabled: DisabledTools, policies: McpPolicies) {
      if (context7Tools.every((tool) => disabled.includes(tool))) return { conversation, servers: [] } satisfies McpBinding;

      const path = `/mcp/${randomUUID()}`;
      const bearerToken = randomBytes(32).toString("hex");

      const gate = yield* Effect.acquireRelease(Effect.tryPromise(() => createMcpToolGate({
        server: { name: "context7", type: "http", url: upstream, headers: [], disabledTools: disabled },
        bearerToken, policy: policies.context7,
        onPermissionRequest: ({ permissionId, serverName, toolName, signal }) => new Promise((resolve) => {
          const settle = (decision: "allow" | "deny") => {
            signal.removeEventListener("abort", abort);
            pending.delete(permissionId);
            resolve(signal.aborted ? "deny" : decision);
          };

          const abort = () => settle("deny");
          pending.set(permissionId, { conversation, serverName, toolName, settle });
          signal.addEventListener("abort", abort, { once: true });

          if (signal.aborted) abort();
        }),
        onAutoDecision: ({ decisionId, serverName, toolName, match, decision }) => {
          // Captured attribution only. No arguments, results, credentials, or ACP
          // correlation. Persist independently of browser connectivity/active turn.
          const event = { decisionId, serverName, toolName, match, decision };

          unsaved.set(decisionId, { conversation, event });
          void persist(conversation, event);
        },
      })), (value) => Effect.promise(async () => {
        routes.delete(path);
        await value.close();
        await Promise.all(writes);
      }));

      routes.set(path, gate);

      return { conversation, servers: [{ name: "context7", type: "http", url: `http://${host}:${port}${path}`,
        headers: [{ name: "Authorization", value: `Bearer ${bearerToken}` }],
        disabledTools: disabled, alwaysAllow: [...context7Tools] }] } satisfies McpBinding;
    }, Effect.mapError(() => new McpError()));

    const view = Effect.fn("McpPermissions.view")(function* (conversation: string) {
      yield* Effect.promise(() => Promise.all(writes));

      // Retrying a captured history insert is idempotent, never a tool retry.
      // A failed write in one conversation must not hide another one's approvals.
      yield* Effect.promise(() => Promise.all([...unsaved.values()].flatMap((entry) =>
        entry.conversation === conversation ? [persist(conversation, entry.event)] : [])));

      const rows = yield* sql`SELECT event FROM mcp_decision WHERE conversation_id = ${conversation}
        ORDER BY created_at, decision_id`;

      return yield* Effect.try(() => McpHistory.parse({
        decisions: rows.map((row) => row.event),
        incomplete: [...unsaved.values()].some((entry) => entry.conversation === conversation),
        pending: [...pending].flatMap(([permissionId, value]) => value.conversation === conversation
          ? [{ permissionId, serverName: value.serverName, toolName: value.toolName }] : []),
      }));
    }, Effect.mapError(() => new McpError()));

    const approve = Effect.fn("McpPermissions.approve")(function* (conversation: string, permissionId: string, decision: "allow" | "deny") {
      const request = pending.get(permissionId);

      if (request?.conversation !== conversation) return yield* new McpError();
      request.settle(decision);
    });

    return McpPermissions.of({ open, view, approve });
  }).pipe(Effect.mapError(() => new McpError())));
}
