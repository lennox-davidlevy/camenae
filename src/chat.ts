import { randomUUID } from "node:crypto";
import type { BobRemoteClient } from "@camenae/bob";
import { camenaeMode } from "./assistant-mode.js";
import { Context, Effect, Exit, Fiber, Layer, Redacted, Schedule, Schema, Scope, Semaphore } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { HarnessRuntime } from "./harness-runtime.js";
import { AccessDenied, Identity, IdentityError } from "./identity.js";
import { ChatView, Conversation, SessionUsage, type Turn } from "./chat-contract.js";
import { DisabledTools, McpPolicies, type McpSettings } from "./mcp-contract.js";
import { McpPermissions } from "./mcp-permissions.js";
import { ApprovalPolicy, type ApprovalSettings } from "./approval-contract.js";

export class ChatError extends Schema.TaggedError<ChatError>()("ChatError", {}) {}

export class ChatBusy extends Schema.TaggedError<ChatBusy>()("ChatBusy", {}) {}

export type ChatFailure = ChatError | ChatBusy | AccessDenied | IdentityError;

interface SessionOwner {
  connection?: LiveConnection;
}

interface ActiveTurn extends SessionOwner {
  conversation: string;
  turn: Turn;
  sessionId?: string;
  fiber?: Fiber.Fiber<void, ChatError>;
  cancelled: boolean;
  dirty: boolean;
  persistenceFailed: boolean;
}

interface LiveConnection {
  scope: Scope.Closeable;
  client: BobRemoteClient;
  token: string;
  csrf: string;
  key: Redacted.Redacted<string>;
  healthy: boolean;
  disabledTools: DisabledTools;
  approvalPolicy: ApprovalPolicy;
  mcpPolicies: McpPolicies;
  session?: { conversation: string; id: string };
  usage: Map<string, SessionUsage>;
}

interface Initialization {
  owner: SessionOwner;
  fiber: Fiber.Fiber<unknown, unknown>;
  token: string;
  csrf: string;
  key: Redacted.Redacted<string>;
}

export class Chat extends Context.Service<Chat, {
  readonly list: (token: string) => Effect.Effect<z.infer<typeof Conversation>[], ChatFailure>;
  readonly create: (token: string, csrf: string) => Effect.Effect<string, ChatFailure>;
  readonly prepare: (token: string, csrf: string, id: string) => Effect.Effect<void, ChatFailure>;
  readonly view: (token: string, id: string) => Effect.Effect<ChatView, ChatFailure>;
  readonly start: (token: string, csrf: string, id: string, prompt: string) => Effect.Effect<void, ChatFailure>;
  readonly cancel: (token: string, csrf: string, id: string) => Effect.Effect<void, ChatFailure>;
  readonly approve: (token: string, csrf: string, id: string, permissionId: string, optionId: string | null) => Effect.Effect<void, ChatFailure>;
  readonly mcpSettings: (token: string) => Effect.Effect<McpSettings, ChatFailure>;
  readonly saveMcpSettings: (token: string, csrf: string, disabledTools: DisabledTools, permissions?: McpPolicies) => Effect.Effect<void, ChatFailure>;
  readonly approveMcp: (token: string, csrf: string, conversation: string, permissionId: string, decision: "allow" | "deny") => Effect.Effect<void, ChatFailure>;
  readonly approvalSettings: (token: string) => Effect.Effect<ApprovalSettings, ChatFailure>;
  readonly saveApprovalSettings: (token: string, csrf: string, policy: ApprovalPolicy) => Effect.Effect<void, ChatFailure>;
}>()("camenae/Chat") {
  static readonly layer = Layer.effect(Chat, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const identity = yield* Identity;
    const runtime = yield* HarnessRuntime;
    const mcp = yield* McpPermissions;
    const scope = yield* Scope.Scope;
    let active: ActiveTurn | undefined;
    let live: LiveConnection | undefined;
    let initializing: Initialization | undefined;
    const lifecycle = yield* Semaphore.make(1);

    const desiredTools = Effect.fn("Chat.desiredTools")(function* () {
      const rows = yield* sql`SELECT disabled_tools, permissions FROM mcp_settings WHERE singleton = true`;
      const parsed = yield* Effect.try(() => z.array(z.object({ disabled_tools: DisabledTools, permissions: McpPolicies })).length(1).parse(rows));

      return parsed[0];
    }, Effect.mapError(() => new ChatError()));

    const mcpSettings = Effect.fn("Chat.mcpSettings")(function* (token: string) {
      yield* identity.session(token);
      const saved = yield* desiredTools();

      return { disabledTools: saved.disabled_tools, permissions: saved.permissions,
        activeDisabledTools: live?.healthy && live.session ? live.disabledTools : null,
        activePermissions: live?.healthy && live.session ? live.mcpPolicies : null };
    });

    const saveMcpSettings = Effect.fn("Chat.saveMcpSettings")(function* (token: string, csrf: string, input: DisabledTools, permissions?: McpPolicies) {
      yield* identity.authorize(token, csrf);
      const tools = yield* Effect.try(() => DisabledTools.parse(input)).pipe(Effect.mapError(() => new ChatError()));

      const policy = yield* Effect.try(() => permissions === undefined ? undefined : McpPolicies.parse(permissions))
        .pipe(Effect.mapError(() => new ChatError()));

      yield* sql`UPDATE mcp_settings SET disabled_tools = ${JSON.stringify(tools)}::jsonb,
        permissions = COALESCE(${policy ? JSON.stringify(policy) : null}::jsonb, permissions) WHERE singleton = true`
        .pipe(Effect.mapError(() => new ChatError()));
      // Saving never interrupts a turn or changes its pending permission. Only
      // the serialized idle preparation path publishes the worker snapshot.
    }, lifecycle.withPermit);

    const approveMcp = Effect.fn("Chat.approveMcp")(function* (token: string, csrf: string, conversation: string, permissionId: string, decision: "allow" | "deny") {
      yield* identity.authorize(token, csrf);

      if (!live?.healthy || live.token !== token || live.csrf !== csrf || live.session?.conversation !== conversation) return yield* new ChatError();
      yield* mcp.approve(conversation, permissionId, decision).pipe(Effect.mapError(() => new ChatError()));
    });

    const desiredPolicy = Effect.fn("Chat.desiredPolicy")(function* () {
      const rows = yield* sql`SELECT policy FROM approval_settings WHERE singleton = true`;
      const parsed = yield* Effect.try(() => z.array(z.object({ policy: ApprovalPolicy })).length(1).parse(rows));

      return parsed[0].policy;
    }, Effect.mapError(() => new ChatError()));

    const approvalSettings = Effect.fn("Chat.approvalSettings")(function* (token: string) {
      yield* identity.session(token);
      const saved = yield* desiredPolicy();

      return { saved, active: live?.healthy && live.token === token ? live.approvalPolicy : null };
    });

    const installPolicy = Effect.fn("Chat.installPolicy")(function* (connection: LiveConnection, policy: ApprovalPolicy) {
      yield* Effect.try(() => connection.client.setApprovalPolicy(policy)).pipe(Effect.mapError(() => new ChatError()));
      connection.approvalPolicy = policy;
    });

    const saveApprovalSettings = Effect.fn("Chat.saveApprovalSettings")(function* (token: string, csrf: string, input: ApprovalPolicy) {
      yield* identity.authorize(token, csrf);
      const policy = yield* Effect.try(() => ApprovalPolicy.parse(input)).pipe(Effect.mapError(() => new ChatError()));
      yield* sql`UPDATE approval_settings SET policy = ${JSON.stringify(policy)}::jsonb WHERE singleton = true`
        .pipe(Effect.mapError(() => new ChatError()));
      // Commit desired preferences first; a failed setter leaves them saved and
      // the previous active policy visible. Pending manual requests stay manual.

      if (live?.healthy && live.token === token && live.csrf === csrf) yield* installPolicy(live, policy);
    }, lifecycle.withPermit, Effect.uninterruptible);

    const retire = Effect.fn("Chat.retire")(function* (connection: LiveConnection) {
      if (live !== connection) return;
      connection.healthy = false;
      yield* Scope.close(connection.scope, Exit.void);
      live = undefined;
    }, Effect.uninterruptible);

    const disconnect = Effect.fn("Chat.disconnect")(function* (connection: LiveConnection) {
      yield* retire(connection);
    }, lifecycle.withPermit, Effect.uninterruptible);

    yield* Effect.addFinalizer(() => live ? disconnect(live) : Effect.void);

    const connect = Effect.fn("Chat.connect")(function* (
      owner: SessionOwner, token: string, csrf: string, key: Redacted.Redacted<string>, disabledTools: DisabledTools, approvalPolicy: ApprovalPolicy,
      conversation: string, mcpPolicies: McpPolicies,
    ) {
      if (!live || !live.healthy || live.token !== token || live.csrf !== csrf ||
        Redacted.value(live.key) !== Redacted.value(key) || JSON.stringify(live.disabledTools) !== JSON.stringify(disabledTools) ||
        JSON.stringify(live.mcpPolicies) !== JSON.stringify(mcpPolicies) || live.session?.conversation !== conversation) {
        const connectionScope = yield* Scope.make();

        const client = yield* Effect.gen(function* () {
          const binding = yield* mcp.open(conversation, disabledTools, mcpPolicies);
          // Publish fresh gate configuration BEFORE retiring the old worker.
          // Docker replacement must never reuse a one-session gate/token.
          yield* runtime.stage(binding.servers);

          if (live) yield* retire(live);

          return yield* runtime.connect(key, binding.servers, approvalPolicy);
        }).pipe(Scope.provide(connectionScope),
          Effect.onError(() => Scope.close(connectionScope, Exit.void)));

        const connection: LiveConnection = { scope: connectionScope, client, token, csrf, key, healthy: true, disabledTools, approvalPolicy, mcpPolicies, usage: new Map() };
        live = connection;

        const unsubscribe = client.subscribe((event) => {
          if (live !== connection || !connection.healthy) return;

          if (event.type === "connection_error" || event.type === "exit") connection.healthy = false;

          if (event.type !== "session_update") return;
          const { sessionId, update } = event.notification;

          if (connection.session && connection.session.id !== sessionId) return;
          const usage = SessionUsage.safeParse(update._meta?.["bob-gateway/usage"]);

          // Initialization can notify before the response supplies the native ID.
          // Keep native attribution until loadSession binds it to a conversation.
          if (usage.success) connection.usage.set(sessionId, usage.data);
        });

        yield* Scope.addFinalizer(connectionScope, Effect.sync(unsubscribe));
      } else if (JSON.stringify(live.approvalPolicy) !== JSON.stringify(approvalPolicy)) {
        yield* installPolicy(live, approvalPolicy);
      }

      owner.connection = live;

      return live;
    });

    // Authorization belongs to the connection lifetime, including time between
    // prompts. Browser connections do not own the harness lifetime.
    yield* Effect.gen(function* () {
      const current = live;
      const pending = initializing;
      const authority = pending ?? current;

      if (!authority) return;

      const authorized = yield* identity.key(authority.token, authority.csrf).pipe(
        Effect.map((key) => Redacted.value(key) === Redacted.value(authority.key)),
        Effect.catch(() => Effect.succeed(false)),
      );

      if (pending) {
        if (initializing === pending && (!authorized || pending.owner.connection?.healthy === false)) {
          yield* Fiber.interrupt(pending.fiber);
        }

        return;
      }

      if (!current || live !== current || (authorized && current.healthy)) return;

      const task = active;

      if (task?.connection === current && task.fiber) yield* Fiber.interrupt(task.fiber);

      yield* disconnect(current);
    }).pipe(Effect.repeat(Schedule.spaced("250 millis")), Effect.forkScoped);

    // Single application process. Never replay an action after process replacement.
    yield* sql`UPDATE turn SET status = 'interrupted', permission = NULL WHERE status = 'running'`;

    const save = Effect.fn("Chat.save")(function* (turn: Turn) {
      yield* sql`UPDATE turn SET answer = ${turn.answer}, activity = ${JSON.stringify(turn.activity)}::jsonb,
        approval_decisions = ${JSON.stringify(turn.approval_decisions)}::jsonb,
        permission = ${turn.permission ? JSON.stringify(turn.permission) : null}::jsonb, status = ${turn.status},
        stop_reason = ${turn.stop_reason} WHERE id = ${turn.id} AND status = 'running'`;
    }, Effect.mapError(() => new ChatError()));

    const reconcile = Effect.fn("Chat.reconcile")(function* () {
      const previous = active;

      if (previous?.persistenceFailed) {
        yield* save(previous.turn);

        if (active === previous) active = undefined;
      }
    });

    const list = Effect.fn("Chat.list")(function* (token: string) {
      yield* identity.session(token);

      const rows = yield* sql`SELECT id, title FROM conversation ORDER BY created_at DESC LIMIT 100`
        .pipe(Effect.mapError(() => new ChatError()));

      return yield* Effect.try(() => z.array(Conversation).parse(rows)).pipe(Effect.mapError(() => new ChatError()));
    });

    const create = Effect.fn("Chat.create")(function* (token: string, csrf: string) {
      yield* identity.authorize(token, csrf);
      const id = randomUUID();
      yield* sql`INSERT INTO conversation (id, title) VALUES (${id}, 'New conversation')`;

      return id;
    }, sql.withTransaction, Effect.mapError(() => new ChatError()));

    const view = Effect.fn("Chat.view")(function* (token: string, id: string) {
      yield* identity.session(token);
      yield* reconcile();

      const turns = yield* sql`SELECT id, ordinal, prompt, answer, activity, permission, approval_decisions, status, stop_reason
        FROM turn WHERE conversation_id = ${id} ORDER BY ordinal`
        .pipe(Effect.mapError(() => new ChatError()));

      const mcpHistory = yield* mcp.view(id).pipe(Effect.mapError(() => new ChatError()));

      const usage = live?.healthy && live.token === token && live.session?.conversation === id
        ? live.usage.get(live.session.id) ?? null : null;

      return yield* Effect.try(() => ChatView.parse({ turns, mcp: mcpHistory, usage })).pipe(Effect.mapError(() => new ChatError()));
    });

    const loadSession = Effect.fn("Chat.loadSession")(function* (
      owner: SessionOwner, token: string, csrf: string, conversation: string,
    ) {
      if (active && active !== owner) return yield* new ChatBusy();

      return yield* Effect.gen(function* () {
        const rows = yield* sql`SELECT native_id FROM conversation WHERE id = ${conversation}`;
        const parsed = yield* Effect.try(() => z.array(z.object({ native_id: z.string().nullable() })).length(1).parse(rows));
        const nativeId = parsed[0].native_id;
        // Read authority inside the lifecycle permit, after any queued work or
        // database wait, rather than retaining the key from HTTP admission.
        const key = yield* identity.key(token, csrf);
        const mcpSettings = yield* desiredTools();
        const approvalPolicy = yield* desiredPolicy();
        const fiber = yield* Effect.fiber;
        initializing = { owner, fiber, token, csrf, key };
        const connection = yield* connect(owner, token, csrf, key, mcpSettings.disabled_tools, approvalPolicy, conversation, mcpSettings.permissions);
        const client = connection.client;
        let sessionId = connection.session?.conversation === conversation ? connection.session.id : null;

        if (!sessionId) {
          const previous = connection.session;

          if (previous) yield* Effect.tryPromise(() => client.closeSession(previous.id));
          connection.session = undefined;

          if (nativeId) {
            yield* Effect.tryPromise(() => client.resumeSession(nativeId, { mcpServers: [] }));
            sessionId = nativeId;
          } else {
            sessionId = (yield* Effect.tryPromise(() => client.newSession({ mcpServers: [] }))).sessionId;
            yield* sql`UPDATE conversation SET native_id = ${sessionId} WHERE id = ${conversation}`;
          }

          // Camenae currently has one application-owned persona and no user mode
          // selector. Apply it on both new and restored native sessions, including
          // conversations created before the custom mode was introduced.
          const selectedSessionId = sessionId;
          yield* Effect.tryPromise(() => client.setMode(selectedSessionId, camenaeMode.slug));
          connection.session = { conversation, id: sessionId };

          for (const id of connection.usage.keys()) {
            if (id !== sessionId) connection.usage.delete(id);
          }
        }

        return { connection, sessionId };
      }).pipe(
        Effect.onError(() => owner.connection ? retire(owner.connection) : Effect.void),
        Effect.ensuring(Effect.sync(() => { if (initializing?.owner === owner) initializing = undefined; })),
      );
    }, lifecycle.withPermit, Effect.mapError((error) =>
      error instanceof ChatBusy || error instanceof AccessDenied || error instanceof IdentityError ? error : new ChatError()));

    const prepare = Effect.fn("Chat.prepare")(function* (token: string, csrf: string, id: string) {
      yield* identity.authorize(token, csrf);
      yield* reconcile();

      // Reopening the running conversation is a view operation, not a request
      // to reload its native session. A different conversation cannot displace it.
      if (active?.conversation === id) return;

      const owner: SessionOwner = {};
      // As with turns, the application owns initialization even if the tab closes.
      const preparation = yield* loadSession(owner, token, csrf, id).pipe(Effect.interruptible, Effect.forkIn(scope));
      yield* Fiber.join(preparation);
    });

    const execute = Effect.fn("Chat.execute")(function* (
      task: ActiveTurn, token: string, csrf: string, conversation: string,
    ) {
      let overflow = false;
      const turn = task.turn;

      const work = Effect.scoped(Effect.gen(function* () {
        const { connection, sessionId: promptSessionId } = yield* loadSession(task, token, csrf, conversation);
        const client = connection.client;

        const unsubscribe = client.subscribe((event) => {
          if (event.type === "permission_auto_decision") {
            if (event.sessionId !== promptSessionId) return;

            // A turn never reconnects/replays: its UUID scopes client-local
            // permission IDs. Several requests may share an opaque tool-call ID.
            if (turn.approval_decisions.some((decision) => decision.permissionId === event.permissionId)) return;

            if (turn.approval_decisions.length < 100) {
              const { permissionId, toolCallId, match, kind, decision } = event;

              turn.approval_decisions.push(match === "category"
                ? { permissionId, toolCallId, match, kind, decision }
                : { permissionId, toolCallId, match, kind, decision });
            } else overflow = true;
            task.dirty = true;

            return;
          }

          if (event.type === "permission_request") {
            if (event.request.sessionId !== promptSessionId) return;
            turn.permission = { id: event.permissionId, title: event.request.toolCall.title ?? "Tool permission",
              kind: event.request.toolCall.kind ?? "unknown",
              // Native Always choices bypass future SDK requests. Lasting
              // approval decisions belong exclusively to persisted preferences.
              options: event.request.options.filter((option) => option.kind === "allow_once" || option.kind === "reject_once")
                .map(({ optionId, name, kind }) => ({ optionId, name, kind })) };
            task.dirty = true;
          }

          if (event.type !== "session_update" || event.notification.sessionId !== promptSessionId) return;
          const update = event.notification.update;

          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            if (Buffer.byteLength(turn.answer) + Buffer.byteLength(update.content.text) > 256 * 1024) overflow = true;
            else turn.answer += update.content.text;
            task.dirty = true;
          }

          if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
            const previous = turn.activity.find((item) => item.id === update.toolCallId);

            if (previous) {
              previous.title = update.title ?? previous.title;
              previous.status = update.status ?? previous.status;
            } else if (turn.activity.length < 100) {
              turn.activity.push({ id: update.toolCallId, title: update.title ?? "Tool", status: update.status ?? "pending" });
            } else overflow = true;
            task.dirty = true;
          }
        });

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

        const monitor = Effect.gen(function* () {
          if (overflow) return yield* new ChatError();

          if (task.dirty) {
            task.dirty = false;
            yield* save(turn);
          }
        }).pipe(Effect.repeat(Schedule.spaced("250 millis")), Effect.andThen(Effect.never));

        const result = yield* Effect.tryPromise(() => {
          task.sessionId = promptSessionId;

          return client.prompt(promptSessionId, [{ type: "text", text: turn.prompt }]);
        })
          .pipe(Effect.raceFirst(monitor), Effect.timeout("10 minutes"));

        turn.stop_reason = result.stopReason;
        turn.status = result.stopReason === "cancelled" ? "cancelled" : "completed";
      })).pipe(Effect.onExit((exit) => Exit.isFailure(exit) && task.connection ? disconnect(task.connection) : Effect.void));

      yield* work.pipe(
        Effect.catchCause(() => Effect.sync(() => { turn.status = task.cancelled ? "cancelled" : "failed"; })),
        Effect.ensuring(Effect.gen(function* () {
          if (turn.status === "running") turn.status = task.cancelled ? "cancelled" : "interrupted";
          turn.permission = null;
          // Retain the terminal persistence obligation if the database is down.
          // The next admission retries only this write, never the harness prompt.
          yield* save(turn).pipe(
            Effect.tap(() => Effect.sync(() => { if (active === task) active = undefined; })),
            Effect.catchTag("ChatError", () => Effect.sync(() => { task.persistenceFailed = true; })),
          );
        })),
      );
    }, Effect.mapError(() => new ChatError()));

    const start = Effect.fn("Chat.start")(function* (token: string, csrf: string, id: string, prompt: string) {
      yield* identity.authorize(token, csrf);

      yield* reconcile();

      if (active) return yield* new ChatBusy();

      const task: ActiveTurn = { conversation: id, cancelled: false, dirty: false, persistenceFailed: false, turn: {
        id: randomUUID(), ordinal: 0, prompt, answer: "", activity: [], approval_decisions: [], permission: null, status: "running", stop_reason: null,
      } };

      active = task;

      const admission = sql.withTransaction(Effect.gen(function* () {
        yield* identity.key(token, csrf);
        const counts = yield* sql`SELECT count(*)::int AS count FROM turn WHERE conversation_id = ${id}`;
        const count = yield* Effect.try(() => z.array(z.object({ count: z.number().int().max(49) })).length(1).parse(counts));
        task.turn.ordinal = count[0].count + 1;
        yield* sql`INSERT INTO turn (id, conversation_id, ordinal, prompt, status)
          VALUES (${task.turn.id}, ${id}, ${task.turn.ordinal}, ${prompt}, 'running')`;
        yield* sql`UPDATE conversation SET title = ${prompt.slice(0, 80)} WHERE id = ${id} AND title = 'New conversation'`;

      }));

      yield* admission.pipe(Effect.tapError(() => Effect.sync(() => { active = undefined; })),
        Effect.mapError(() => new ChatError()));

      task.fiber = yield* execute(task, token, csrf, id).pipe(Effect.interruptible, Effect.forkIn(scope));
    }, Effect.uninterruptible);

    const cancel = Effect.fn("Chat.cancel")(function* (token: string, csrf: string, id: string) {
      yield* identity.authorize(token, csrf);
      const task = active;

      if (!task || task.turn.id !== id || !task.fiber) return yield* new ChatError();
      task.cancelled = true;
      const fiber = task.fiber;
      const client = task.connection?.client;
      const sessionId = task.sessionId;

      if (!client || !sessionId) {
        yield* Fiber.interrupt(fiber);

        return;
      }

      // Keep a healthy connection after native cancellation settles. If it does
      // not settle, interruption tears down the worker rather than admitting a
      // new prompt beside unfinished tool execution.
      yield* Effect.tryPromise(() => client.cancel(sessionId)).pipe(
        Effect.andThen(Fiber.join(fiber)), Effect.timeout("5 seconds"),
        Effect.catch(() => Fiber.interrupt(fiber)),
      );
    });

    const approve = Effect.fn("Chat.approve")(function* (token: string, csrf: string, id: string, permissionId: string, optionId: string | null) {
      yield* identity.authorize(token, csrf);
      const task = active;
      const permission = task?.turn.permission;

      const client = task?.connection?.client;

      if (!client || task?.turn.id !== id || permission?.id !== permissionId ||
        (optionId !== null && !permission.options.some((option) => option.optionId === optionId))) return yield* new ChatError();
      yield* Effect.try(() => client.respondToPermission(permissionId, optionId)).pipe(Effect.mapError(() => new ChatError()));
      task.turn.permission = null;
      task.dirty = true;
    });

    return Chat.of({ list, create, prepare, view, start, cancel, approve, approveMcp, mcpSettings, saveMcpSettings, approvalSettings, saveApprovalSettings });
  }).pipe(Effect.mapError(() => new ChatError())));
}
