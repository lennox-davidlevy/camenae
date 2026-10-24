import { createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { z } from "zod";
import { Bootstrap } from "../bootstrap-contract.js";
import { ChatView, type Conversation, type Turn } from "../chat-contract.js";
import type { ConsoleModel } from "../console-contract.js";
import { request } from "./api.js";

const loadBootstrap = async () => Bootstrap.parse(await (await request("/api/chat")).json());

// One conversation at a time, with the same request, stream, and recovery
// behavior as the React UI. Attachments, model choice, and usage are not included yet.
export function createChatSession() {
  const [bootstrap, setBootstrap] = createSignal<Bootstrap>();
  const [conversation, setConversation] = createSignal<string>();
  const [state, setState] = createStore<{ view?: ChatView }>({});
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [preparing, setPreparing] = createSignal(false);
  const [ready, setReady] = createSignal<string>();
  const drafts = new Map<string, string>();

  // Stream updates arrive as fresh objects. Reconciling by id updates the same turns in place,
  // so open details, selections, and scroll position survive each update.
  const view = () => state.view;
  const setView = (next: ChatView | undefined) => setState("view", next ? reconcile(next, { key: "id" }) : undefined);
  let source: EventSource | undefined;
  let generation = 0;

  const running = createMemo(() => view()?.turns.find((turn) => turn.status === "running"));
  const conversations = createMemo(() => bootstrap()?.conversations ?? []);
  const harness = createMemo(() => view()?.harness ?? bootstrap()?.harness ?? "opencode");
  const configured = createMemo(() => bootstrap()?.readiness.opencode ?? false);
  const idle = createMemo(() => !pending() && !preparing() && !running());

  const updateConversation = (detail: Conversation) => setBootstrap((previous) => {
    const current = previous?.conversations.find((item) => item.id === detail.id);

    if (!previous || !current || (current.title === detail.title && current.updatedAt === detail.updatedAt && current.toolCount === detail.toolCount)) return previous;

    return { ...previous, conversations: previous.conversations.map((item) => item.id === detail.id ? detail : item) };
  });

  const refreshBootstrap = async (epoch: number) => {
    const next = await loadBootstrap();

    if (generation === epoch) setBootstrap(next);
  };

  const connect = (id: string, epoch: number, first: ChatView) => {
    const events = new EventSource(`/api/chat/${id}/events`);
    let wasRunning = first.turns.some((turn) => turn.status === "running");
    source = events;

    events.onmessage = (event) => {
      if (generation !== epoch) return;
      const update = ChatView.safeParse(JSON.parse(event.data));

      if (!update.success) {
        events.close();
        setError("Invalid stream response. Reconnect to reload.");

        return;
      }

      setView(update.data);
      updateConversation(update.data.conversation);
      const isRunning = update.data.turns.some((turn) => turn.status === "running");

      if (wasRunning && !isRunning) void refreshBootstrap(epoch).catch(() => undefined);
      wasRunning = isRunning;
    };

    events.onerror = () => {
      events.close();

      if (generation === epoch) setError("Stream disconnected. Reconnect to reload; work may still be running.");
    };
  };

  const open = async (id: string, state: Bootstrap) => {
    const epoch = ++generation;
    const same = conversation() === id;
    source?.close();
    setError("");
    setConversation(id);

    // Refreshing the open conversation keeps its messages on screen; only a different one starts blank.
    if (!same) {
      setView(undefined);
      setReady(undefined);
    }

    setPreparing(true);
    window.history.replaceState(null, "", `#${id}`);

    try {
      const snapshot = ChatView.parse(await (await request(`/api/chat/${id}`)).json());

      if (generation !== epoch) return;
      setView(snapshot);
      updateConversation(snapshot.conversation);
      connect(id, epoch, snapshot);

      if (state.readiness[snapshot.harness]) {
        await request(`/api/chat/${id}/prepare`, { csrf: state.csrf });

        if (generation === epoch) setReady(id);
      }
    } finally {
      if (generation === epoch) setPreparing(false);
    }
  };

  const perform = async (operation: () => Promise<void>) => {
    setError("");
    setPending(true);

    try { await operation(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed");

      try { setBootstrap(await loadBootstrap()); }
      catch { /* Keep the original operation error when status cannot be refreshed. */ }
    }
    finally { setPending(false); }
  };

  const start = async () => {
    try {
      const state = await loadBootstrap();
      setBootstrap(state);
      const fragment = z.uuid().safeParse(window.location.hash.slice(1));
      const id = fragment.success ? fragment.data : state.conversations[0]?.id;

      if (id) await open(id, state);
    } catch { setError("Could not load chat. Check your connection and sign in again."); }
  };

  onCleanup(() => { generation++; source?.close(); });

  const select = (id: string) => perform(async () => {
    const state = bootstrap();

    if (state) await open(id, state);
  });

  const reconnect = () => {
    const id = conversation();

    return id ? select(id) : Promise.resolve();
  };

  // Settings changes report here: refresh the allowance, and re-prepare after a key change.
  const refreshStatus = async (connectionChanged: boolean) => {
    setBootstrap(await loadBootstrap());

    if (connectionChanged) setReady(undefined);
  };

  const create = () => perform(async () => {
    const state = bootstrap();

    if (!state) return;
    const created = z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf: state.csrf, harness: state.harness })).json());
    const next = await loadBootstrap();
    setBootstrap(next);
    await open(created.id, next);
  });

  const send = (prompt: string, attachments: readonly string[] = []) => perform(async () => {
    const state = bootstrap();
    const id = conversation();

    if (!state || !id) return;

    try { await request(`/api/chat/${id}`, { csrf: state.csrf, prompt, attachments: [...attachments] }); }
    catch (failure) {
      drafts.set(id, prompt);
      throw failure;
    }

    drafts.delete(id);
    await open(id, state);
    setBootstrap(await loadBootstrap());
  });

  const cancel = () => perform(async () => {
    const state = bootstrap();
    const turn = running();
    const id = conversation();

    if (!state || !turn || !id) return;
    await request("/api/chat/cancel", { csrf: state.csrf, turnId: turn.id });
    await open(id, state);
  });

  const selectModel = (model: ConsoleModel) => perform(async () => {
    const state = bootstrap();
    const id = conversation();

    if (!state || !id) return;
    await request(`/api/chat/${id}/model`, { csrf: state.csrf, model });
    await open(id, state);
  });

  const approveNative = (turn: Turn, optionId: string | null) => perform(async () => {
    const state = bootstrap();

    if (!state || !turn.permission) return;
    await request("/api/chat/approve", { csrf: state.csrf, turnId: turn.id, permissionId: turn.permission.id, optionId });
  });

  return { bootstrap, conversations, conversation, view, error, pending, preparing, ready, running, harness, configured, idle, drafts,
    start, select, reconnect, create, send, cancel, selectModel, approveNative, refreshStatus };
}
