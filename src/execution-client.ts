import type { OpenCodeConnection } from "@camenae/opencode";
import type { SessionUsage, Permission } from "./chat-contract.js";
import { Match } from "effect";
import { type ConsoleModel, consoleProvider } from "./console-contract.js";

export type Harness = "opencode";

export type ExecutionEvent =
  | { type: "unavailable" }
  | { type: "title"; session: string; title: string }
  | { type: "text"; session: string; text: string }
  | { type: "activity"; session: string; id: string; title?: string; status?: string }
  | { type: "permission"; session: string; permission: Permission }
  | { type: "permission-settled"; session: string; id: string }
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
}

export function openCodeExecution(client: OpenCodeConnection): ExecutionClient {
  return {
    harness: "opencode",
    async openSession(id, model) {
      const sessionID = await client.openSession(id);

      if (model) await client.native.session.switchModel({ sessionID, model: { providerID: consoleProvider(model), id: model } });

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
  };
}
