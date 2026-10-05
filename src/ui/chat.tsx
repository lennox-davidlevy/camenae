import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { z } from "zod";
import { ChatView, Conversation, type Turn } from "../chat-contract.js";
import "./theme.css";
import "./chat.css";
import { LayoutShell, type Screen } from "./layout-shell.js";
import { FileInspector, useWorkspaceFiles, WorkspaceFiles } from "./files.js";
import { McpToolSettings } from "./mcp-settings.js";
import { ApprovalPreferences } from "./approval-settings.js";
import { SettingsInspector, SettingsPage } from "./settings-layout.js";
import { NewChat, NewChatInspector } from "./new-chat.js";
import { ActiveChat, ActiveChatInspector } from "./active-chat.js";
import { SessionUsagePanel } from "./session-usage.js";
import { exampleSkills, SkillsInspector, SkillsPreview } from "./skills.js";

const Bootstrap = z.object({ csrf: z.string(), stored: z.boolean(), readiness: z.object({ bob: z.boolean(), opencode: z.boolean() }), harness: z.enum(["bob", "opencode"]).default("bob"), conversations: z.array(Conversation) });

type ChatRequest = { csrf: string; prompt?: string; turnId?: string; permissionId?: string; optionId?: string | null; decision?: "allow" | "deny" };

async function request(path: string, body?: ChatRequest) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new Error("Please sign in again");
  }

  if (!response.ok) throw new Error(await response.text());

  return response;
}

function App() {
  const [screen, setScreen] = useState<Screen>("Chat");
  const [selectedSkill, setSelectedSkill] = useState(exampleSkills[0]!);
  const [bootstrap, setBootstrap] = useState<z.infer<typeof Bootstrap>>();
  const files = useWorkspaceFiles(screen === "Files" && Boolean(bootstrap), bootstrap?.csrf);
  const [conversation, setConversation] = useState<string>();
  const [conversationHarness, setConversationHarness] = useState<ChatView["harness"]>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [usage, setUsage] = useState<ChatView["usage"]>(null);
  const [mcp, setMcp] = useState<ChatView["mcp"]>({ decisions: [], pending: [], incomplete: false });
  const [requestPending, setPending] = useState(false);
  const [applyingToolSettings, setApplyingToolSettings] = useState(false);
  const pending = requestPending || applyingToolSettings;
  const [preparing, setPreparing] = useState(false);
  const [readyConversation, setReadyConversation] = useState<string>();
  const [error, setError] = useState("");
  const source = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const drafts = useRef(new Map<string, string>());

  const load = useCallback(async (id: string, state: z.infer<typeof Bootstrap>) => {
    const epoch = ++generation.current;
    source.current?.close();
    setError("");
    setConversation(id);
    setConversationHarness(undefined);
    setTurns([]);
    setUsage(null);
    setMcp({ decisions: [], pending: [], incomplete: false });
    setReadyConversation(undefined);
    setPreparing(true);
    window.history.replaceState(null, "", `/chat#${id}`);

    try {
      const snapshot = ChatView.parse(await (await request(`/api/chat/${id}`)).json());

      if (generation.current !== epoch) return;

      setConversationHarness(snapshot.harness);
      setTurns(snapshot.turns);
      setUsage(snapshot.usage);
      setMcp(snapshot.mcp);

      {
        const events = new EventSource(`/api/chat/${id}/events`);
        source.current = events;
        events.onmessage = (event) => {
          if (generation.current !== epoch) return;
          const update = ChatView.safeParse(JSON.parse(event.data));

          if (!update.success) {
            setUsage(null);
            events.close(); setError("Invalid stream response. Reconnect to reload.");

            return;
          }

          setTurns(update.data.turns);
          setUsage(update.data.usage);
          setMcp(update.data.mcp);

        };

        events.onerror = () => {
          events.close();

          if (generation.current === epoch) {
            setUsage(null);
            setError("Stream disconnected. Reconnect to reload; work may still be running.");
          }
        };
      }

      if (state.readiness[snapshot.harness]) {
        await request(`/api/chat/${id}/prepare`, { csrf: state.csrf });

        if (generation.current === epoch) setReadyConversation(id);
      }
    } finally {
      if (generation.current === epoch) setPreparing(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const state = Bootstrap.parse(await (await request("/api/chat")).json());

      if (disposed) return;

      setBootstrap(state);
      const fragment = z.uuid().safeParse(window.location.hash.slice(1));
      const id = fragment.success ? fragment.data : state.conversations[0]?.id;

      if (id) await load(id, state);
    })().catch(() => { if (!disposed) setError("Could not load chat. Check your connection and sign in again."); });

    return () => { disposed = true; generation.current++; source.current?.close(); };
  }, [load]);

  const perform = async (operation: () => Promise<void>) => {
    setError("");
    setPending(true);

    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed"); }
    finally { setPending(false); }
  };

  const current = turns.find((turn) => turn.status === "running");
  const selectedStored = conversationHarness ? bootstrap?.readiness[conversationHarness] : bootstrap?.stored;
  const isNewChat = turns.length === 0 && mcp.pending.length === 0 && mcp.decisions.length === 0 && !mcp.incomplete;

  const messages: ThreadMessageLike[] = turns.flatMap((turn) => [
    { id: `${turn.id}-user`, role: "user", content: [{ type: "text", text: turn.prompt }] },
    { id: turn.id, role: "assistant", metadata: { custom: { turn } }, content: [
      // Browser-only rendering discriminator, not a stored or SDK protocol field.
      ...turn.activity.map((tool) => ({ type: "data" as const, name: "tool-activity", data: tool })),
      { type: "text", text: turn.answer },
    ] },
  ]);

  const runtime = useExternalStoreRuntime({
    adapters: { threadList: { threadId: conversation } },
    messages, convertMessage: (message) => message, isRunning: Boolean(current),
    isDisabled: pending || !conversation || readyConversation !== conversation,
    onNew: async (message) => perform(async () => {
      if (!bootstrap || !conversation) return;

      const prompt = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      await request(`/api/chat/${conversation}`, { csrf: bootstrap.csrf, prompt });
      await load(conversation, bootstrap);
      setBootstrap(Bootstrap.parse(await (await request("/api/chat")).json()));
    }),
    onCancel: async () => perform(async () => {
      if (!bootstrap || !current || !conversation) return;
      await request("/api/chat/cancel", { csrf: bootstrap.csrf, turnId: current.id });
      await load(conversation, bootstrap);
    }),
  });

  // The external-store runtime creates a fresh composer when threadId changes.
  // Restore only that conversation's draft, and keep drafts in this page's memory.
  useEffect(() => {
    if (!conversation) return;
    const composer = runtime.thread.composer;
    composer.setText(drafts.current.get(conversation) ?? "");

    return composer.subscribe(() => {
      const text = composer.getState().text;

      if (text) drafts.current.set(conversation, text);
      else drafts.current.delete(conversation);
    });
  }, [conversation, runtime]);

  return <LayoutShell screen={screen} onScreen={setScreen} conversations={bootstrap?.conversations ?? []} selected={conversation}
    selectionDisabled={pending || preparing} onSelect={(id) => { setScreen("Chat"); void perform(() => bootstrap ? load(id, bootstrap) : Promise.resolve()); }}
    newDisabled={pending || preparing || Boolean(current) || !bootstrap?.stored} onNew={() => void perform(async () => {
      if (!bootstrap) return;
      const created = z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf: bootstrap.csrf })).json());
      setBootstrap(Bootstrap.parse(await (await request("/api/chat")).json()));
      setScreen("Chat");
      await load(created.id, bootstrap);
    })} inspector={screen === "Chat" && isNewChat ? <NewChatInspector
      usage={usage}
      status={preparing ? "Preparing conversation…" : readyConversation ? "Camenae is ready." : "Choose or create a conversation."}
      reconnect={conversation && bootstrap && <button disabled={pending || preparing} onClick={() => void perform(() => load(conversation, bootstrap))}>Reconnect / refresh</button>}
    /> : screen === "Chat" ? <ActiveChatInspector key={conversation} usage={usage} turn={turns.at(-1)} approvals={turns.filter((turn) => turn.permission).length + mcp.pending.length} onSettings={() => setScreen("Settings")} /> : screen === "Skills" ? <SkillsInspector key={selectedSkill.name} skill={selectedSkill} /> : screen === "Files" ? <FileInspector key={files.selected ?? "none"} path={files.selected} preview={files.preview} /> : <SettingsInspector />}>
    <div className={`shell-content${screen === "Chat" ? isNewChat ? " shell-content-new" : " shell-content-active" : ""}${screen === "Skills" ? " shell-content-skills" : ""}${screen === "Files" ? " shell-content-files" : ""}${screen === "Settings" ? " shell-content-settings" : ""}`}>
      {error && <p role="alert">{error}</p>}
      {bootstrap?.harness === "opencode" && <p role="status">New conversations use OpenCode. Existing conversations keep their original harness. Bob approval preferences and Context7 settings apply only to Bob; OpenCode requests one-time native approvals.</p>}
      {(current?.permission || mcp.pending.length > 0) && screen !== "Chat" && <p role="status">An approval is waiting in Chat. <button onClick={() => setScreen("Chat")}>Review approval</button></p>}
      <div className={isNewChat ? undefined : "chat-screen-active"} hidden={screen !== "Chat"}>
      <details className="chat-usage-inline"><summary>Context &amp; session usage</summary><SessionUsagePanel usage={usage} /></details>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className={isNewChat ? "thread" : "active-chat"}>
          {isNewChat ? <NewChat key={conversation ?? "welcome"} status={(!selectedStored || !conversation || preparing || readyConversation !== conversation) && <>
            {!bootstrap && <p>Loading your connection…</p>}
            {bootstrap && !selectedStored && <p><a href="/">Connect a harness</a> to start chatting.</p>}
            {selectedStored && !conversation && <p>Select New Chat above to prepare a conversation.</p>}
            {preparing && <p>Preparing conversation…</p>}
            {conversation && bootstrap && selectedStored && !preparing && readyConversation !== conversation && <p>Conversation is not ready. <button disabled={pending} onClick={() => void perform(() => load(conversation, bootstrap))}>Reconnect</button></p>}
          </>} /> : <ActiveChat
            title={bootstrap?.conversations.find((item) => item.id === conversation)?.title ?? "Conversation"}
            mcp={mcp} pending={pending} onScreen={setScreen}
            status={<>{preparing ? "Preparing conversation…" : current ? "Working" : readyConversation ? "Camenae is ready." : "Conversation not ready."}{!selectedStored && <> <a href="/">Connect a harness</a></>}</>}
            reconnect={conversation && bootstrap && <button disabled={pending || preparing} onClick={() => void perform(() => load(conversation, bootstrap))}>Reconnect / refresh</button>}
            onNativeApprove={(turn, optionId) => void perform(async () => {
              if (!bootstrap || !turn.permission) return;
              await request("/api/chat/approve", { csrf: bootstrap.csrf, turnId: turn.id, permissionId: turn.permission.id, optionId });
            })}
            onMcpApprove={(permissionId, decision) => void perform(async () => {
              if (!bootstrap || !conversation) return;
              await request(`/api/chat/${conversation}/mcp-approve`, { csrf: bootstrap.csrf, permissionId, decision });
            })}
          />}
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      </div>
      <div hidden={screen !== "Skills"}><SkillsPreview selected={selectedSkill} onSelect={setSelectedSkill} /></div>
      <div hidden={screen !== "Files"}>{bootstrap && <WorkspaceFiles files={files} />}</div>
      <div hidden={screen !== "Settings"}>
      <SettingsPage>
      {bootstrap && <ApprovalPreferences csrf={bootstrap.csrf} running={Boolean(current)} preparing={preparing} />}
      {bootstrap && <McpToolSettings csrf={bootstrap.csrf} running={Boolean(current)} preparing={preparing} pending={pending} onApplyingChange={setApplyingToolSettings}
        onApply={conversation && conversationHarness === "bob" && bootstrap.readiness.bob ? () => load(conversation, bootstrap) : undefined} />}
      </SettingsPage>
      </div>
    </div>
  </LayoutShell>;
}

const root = document.getElementById("root");

if (root) createRoot(root).render(<App />);
