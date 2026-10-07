import type { BobRemoteClient } from "@camenae/bob";
import type { OpenCodeConnection } from "@camenae/opencode";
import { camenaeMode } from "./assistant-mode.js";
import { ApprovalDecision, SessionUsage, type Permission } from "./chat-contract.js";
import type { ApprovalPolicy } from "./approval-contract.js";
import { Match } from "effect";
import type { ConsoleModel } from "./console-contract.js";

export type Harness = "bob" | "opencode";

export type ExecutionEvent =
  | { type: "unavailable" }
  | { type: "title"; session: string; title: string }
  | { type: "text"; session: string; text: string }
  | { type: "activity"; session: string; id: string; title?: string; status?: string }
  | { type: "permission"; session: string; permission: Permission }
  | { type: "permission-settled"; session: string; id: string }
  | { type: "decision"; session: string; decision: typeof ApprovalDecision._output }
  | { type: "usage"; session: string; usage: SessionUsage };

/** Application operations, not a promise that native policies or sessions are interchangeable. */
export interface ExecutionClient {
  readonly harness: Harness;
  openSession(id?: string, model?: ConsoleModel): Promise<string>;
  sessionTitle?(id: string, signal: AbortSignal): Promise<string | null>;
  releaseSession(id: string): Promise<void>;
  subscribe(listener: (event: ExecutionEvent) => void): () => void;
  run(session: string, prompt: string): Promise<string>;
  cancel(session: string): Promise<void>;
  approve(session: string, id: string, option: string | null): Promise<void>;
  setBobApprovalPolicy(policy: ApprovalPolicy): void;
}

export function bobExecution(client: BobRemoteClient): ExecutionClient {
  return {
    harness: "bob",
    async openSession(id) {
      const session = id ?? (await client.newSession({ mcpServers: [] })).sessionId;

      if (id) await client.resumeSession(id, { mcpServers: [] });
      await client.setMode(session, camenaeMode.slug);

      return session;
    },
    releaseSession: async (id) => { await client.closeSession(id); },
    async sessionTitle(id, signal) {
      if (!client.initializeResult.agentCapabilities?.sessionCapabilities?.list) return null;
      let cursor: string | undefined;
      const visited = new Set<string>();

      do {
        if (signal.aborted) return null;
        const page = await client.listSessions({ cwd: client.workspace, cursor });

        if (signal.aborted) return null;
        const session = page.sessions.find((item) => item.sessionId === id && item.cwd === client.workspace);

        if (session) return session.title ?? null;
        cursor = page.nextCursor ?? undefined;

        if (cursor && visited.has(cursor)) return null;

        if (cursor) visited.add(cursor);
      } while (cursor);

      return null;
    },
    subscribe: (listener) => client.subscribe((event) => {
      if (event.type === "connection_error" || event.type === "exit") listener({ type: "unavailable" });

      if (event.type === "permission_auto_decision") {
        listener({ type: "decision", session: event.sessionId, decision: ApprovalDecision.parse(event) });
      }

      if (event.type === "permission_request") listener({ type: "permission", session: event.request.sessionId,
        permission: { id: event.permissionId, title: event.request.toolCall.title ?? "Tool permission", kind: event.request.toolCall.kind ?? "unknown",
          options: event.request.options.flatMap(({ optionId, name, kind }) => kind === "allow_once" || kind === "reject_once" ? [{ optionId, name, kind }] : []) } });

      if (event.type !== "session_update") return;
      const { sessionId: session, update } = event.notification;

      if (update.sessionUpdate === "session_info_update" && update.title) listener({ type: "title", session, title: update.title });
      const usage = SessionUsage.safeParse(update._meta?.["bob-gateway/usage"]);

      if (usage.success) listener({ type: "usage", session, usage: usage.data });

      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        listener({ type: "text", session, text: update.content.text });
      }

      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        listener({ type: "activity", session, id: update.toolCallId, title: update.title ?? undefined, status: update.status ?? undefined });
      }
    }),
    run: async (session, prompt) => (await client.prompt(session, [{ type: "text", text: prompt }])).stopReason,
    cancel: async (session) => { await client.cancel(session); },
    approve: async (_session, id, option) => { client.respondToPermission(id, option); },
    setBobApprovalPolicy: (policy) => { client.setApprovalPolicy(policy); },
  };
}

export function openCodeExecution(client: OpenCodeConnection): ExecutionClient {
  return {
    harness: "opencode",
    async openSession(id, model) {
      const sessionID = await client.openSession(id);

      if (model) await client.native.session.switchModel({ sessionID, model: { providerID: "camenae", id: model } });

      return sessionID;
    },
    // A native session is retained independently of connection or worker lifetime.
    releaseSession: async () => {},
    async sessionTitle(id) {
      const session = await client.native.session.get({ sessionID: id });
      const fallback = `New session - ${new Date(session.time.created).toISOString()}`;

      return session.title && session.title !== fallback ? session.title : null;
    },
    subscribe: (listener) => {
      const disconnect = client.onDisconnect(() => listener({ type: "unavailable" }));

      const unsubscribe = client.subscribe((event) => {
      if (event.type === "session.renamed") listener({ type: "title", session: event.data.sessionID, title: event.data.title });

      if (event.type === "session.text.delta") listener({ type: "text", session: event.data.sessionID, text: event.data.delta });

      if (event.type === "session.tool.called" || event.type === "session.tool.success" || event.type === "session.tool.failed") {
        listener({ type: "activity", session: event.data.sessionID, id: event.data.id,
          status: Match.value(event.type).pipe(Match.when("session.tool.called", () => "in_progress"),
            Match.when("session.tool.success", () => "completed"), Match.orElse(() => "failed")) });
      }

      if (event.type === "permission.asked") {
        const complete = event.data.resources.length <= 20 && event.data.resources.every((resource) => resource.length <= 4096);
        const options = [{ optionId: "reject", name: "Reject pending requests", kind: "reject_once" }];

        if (complete) options.unshift({ optionId: "once", name: "Allow once", kind: "allow_once" });
        listener({ type: "permission", session: event.data.sessionID,
          permission: { id: event.data.id, title: (event.data.message ?? event.data.action).slice(0, 4096), kind: event.data.action,
            resources: event.data.resources.slice(0, 20).map((resource) => resource.slice(0, 4096)), detailsTruncated: !complete, options } });
      }

      if (event.type === "permission.replied") listener({ type: "permission-settled", session: event.data.sessionID, id: event.data.requestID });

      if (event.type === "session.usage.updated") listener({ type: "usage", session: event.data.sessionID,
        usage: { harness: "opencode", costUSD: event.data.cost, inputTokens: event.data.tokens.input, outputTokens: event.data.tokens.output } });
      });

      return () => { disconnect(); unsubscribe(); };
    },
    run: (session, prompt) => client.run(session, prompt),
    cancel: (session) => client.cancel(session),
    approve: (session, id, option) => client.approve(session, id, option === "once" ? "once" : "reject"),
    setBobApprovalPolicy: () => { throw new Error("Bob approval preferences do not apply to OpenCode"); },
  };
}
