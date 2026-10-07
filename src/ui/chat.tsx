import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { z } from "zod";
import { ConsoleModel, ConsoleUsage, consoleModels, consoleExhausted } from "../console-contract.js";
import { ChatView, Conversation, type Turn } from "../chat-contract.js";
import "./theme.css";
import "./chat.css";
import { LayoutShell, type Screen } from "./layout-shell.js";
import { FileInspector, uploadWorkspaceFile, useWorkspaceFiles, WorkspaceFiles } from "./files.js";
import { McpToolSettings } from "./mcp-settings.js";
import { ApprovalPreferences } from "./approval-settings.js";
import { OpenCodeSettings } from "./opencode-settings.js";
import { RequestLimitNotice, SettingsInspector, SettingsPage } from "./settings-layout.js";
import { NewChat, NewChatInspector } from "./new-chat.js";
import { ActiveChat, ActiveChatInspector } from "./active-chat.js";
import { SessionUsagePanel } from "./session-usage.js";
import { exampleSkills, SkillsInspector, SkillsPreview } from "./skills.js";
import { AttachmentControl, type AttachmentUpload, type SelectedAttachment } from "./attachments.js";
import { attachmentCountLimit, filePreviewLimit } from "../file-contract.js";

const Bootstrap = z.object({ csrf: z.string(), stored: z.boolean(), readiness: z.object({ bob: z.boolean(), opencode: z.boolean() }), consoleUsage: ConsoleUsage.nullable(), harness: z.enum(["bob", "opencode"]).default("bob"), conversations: z.array(Conversation) });

type ChatRequest = { csrf: string; model?: ConsoleModel; harness?: "bob" | "opencode"; prompt?: string; attachments?: string[]; turnId?: string; permissionId?: string; optionId?: string | null; decision?: "allow" | "deny" };

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
  const [bootstrap, setBootstrapState] = useState<z.infer<typeof Bootstrap>>();

  const setBootstrap = useCallback((next: z.infer<typeof Bootstrap>) => {
    setBootstrapState((previous) => {
      if (!previous?.consoleUsage || !next.consoleUsage || previous.consoleUsage.revision < next.consoleUsage.revision) return next;

      if (previous.consoleUsage.revision === next.consoleUsage.revision && previous.consoleUsage.used <= next.consoleUsage.used) return next;
      const consoleUsage = previous.consoleUsage;
      const readiness = { ...next.readiness, opencode: (consoleUsage.revision > next.consoleUsage.revision ? previous.readiness.opencode : next.readiness.opencode) && !consoleExhausted(consoleUsage) };

      return { ...next, consoleUsage, readiness, stored: readiness[next.harness] };
    });
  }, []);

  const [newHarness, setNewHarness] = useState<"bob" | "opencode">("bob");
  const files = useWorkspaceFiles(screen === "Files" && Boolean(bootstrap), bootstrap?.csrf);
  const [conversation, setConversation] = useState<string>();
  const [conversationTitle, setConversationTitle] = useState("Conversation");
  const [conversationHarness, setConversationHarness] = useState<ChatView["harness"]>();
  const [model, setModel] = useState<ChatView["model"]>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [usage, setUsage] = useState<ChatView["usage"]>(null);
  const [mcp, setMcp] = useState<ChatView["mcp"]>({ decisions: [], pending: [], incomplete: false });
  const [requestPending, setPending] = useState(false);
  const [applyingToolSettings, setApplyingToolSettings] = useState(false);
  const [uploads, setUploads] = useState<Record<string, AttachmentUpload | undefined>>({});
  const uploadPending = useRef(false);
  const uploading = Object.values(uploads).some((upload) => upload && !upload.error);
  const pending = requestPending || applyingToolSettings;
  const [preparing, setPreparing] = useState(false);
  const [readyConversation, setReadyConversation] = useState<string>();
  const [error, setError] = useState("");
  const source = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, SelectedAttachment[]>>({});

  const uploadAttachment = async (file: File) => {
    if (!conversation || !bootstrap || uploadPending.current) return;
    const id = conversation;
    uploadPending.current = true;
    setUploads((previous) => ({ ...previous, [id]: { file } }));

    try {
      const selected = attachmentDrafts[id] ?? [];

      if (selected.length >= attachmentCountLimit || selected.reduce((sum, item) => sum + item.bytes, 0) + file.size > filePreviewLimit) {
        throw new Error("Keep attachments within four files and 64 KiB total.");
      }

      const uploaded = await uploadWorkspaceFile(file, bootstrap.csrf, id);
      setAttachmentDrafts((previous) => ({ ...previous, [id]: [...previous[id] ?? [], uploaded] }));
      setUploads((previous) => ({ ...previous, [id]: undefined }));
    } catch (failure) {
      setUploads((previous) => ({ ...previous, [id]: { file, error: failure instanceof Error ? failure.message : "Upload failed. Please retry." } }));
    } finally { uploadPending.current = false; }
  };

  const updateConversation = useCallback((detail: Conversation) => {
    setConversationTitle(detail.title);
    setBootstrapState((previous) => {
      const current = previous?.conversations.find((item) => item.id === detail.id);

      if (!previous || !current || (current.title === detail.title && current.updatedAt === detail.updatedAt && current.toolCount === detail.toolCount)) return previous;

      return { ...previous, conversations: previous.conversations.map((item) => item.id === detail.id ? detail : item) };
    });
  }, []);

  const onOpenCodeChanged = useCallback(async (connectionChanged: boolean) => {
    setBootstrap(Bootstrap.parse(await (await request("/api/chat")).json()));

    if (connectionChanged && conversationHarness === "opencode") setReadyConversation(undefined);
  }, [conversationHarness, setBootstrap]);

  const load = useCallback(async (id: string, state: z.infer<typeof Bootstrap>) => {
    const epoch = ++generation.current;
    source.current?.close();
    setError("");
    setConversation(id);
    setConversationTitle("Conversation");
    setConversationHarness(undefined);
    setModel(null);
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
      updateConversation(snapshot.conversation);
      setModel(snapshot.model);
      setTurns(snapshot.turns);
      setUsage(snapshot.usage);
      setMcp(snapshot.mcp);

      {
        const events = new EventSource(`/api/chat/${id}/events`);
        let wasRunning = snapshot.turns.some((turn) => turn.status === "running");
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
          updateConversation(update.data.conversation);
          setModel(update.data.model);
          setUsage(update.data.usage);
          setMcp(update.data.mcp);
          const isRunning = update.data.turns.some((turn) => turn.status === "running");

          if (wasRunning && !isRunning) {
            void request("/api/chat").then((response) => response.json()).then((value) => {
              if (generation.current === epoch) setBootstrap(Bootstrap.parse(value));
            }).catch(() => { if (generation.current === epoch) setError("Could not refresh the request allowance. Refresh status in Settings before sending again."); });
          }

          wasRunning = isRunning;

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
  }, [setBootstrap, updateConversation]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const state = Bootstrap.parse(await (await request("/api/chat")).json());

      if (disposed) return;

      setBootstrap(state);
      setNewHarness(state.harness);
      const fragment = z.uuid().safeParse(window.location.hash.slice(1));
      const id = fragment.success ? fragment.data : state.conversations[0]?.id;

      if (id) await load(id, state);
    })().catch(() => { if (!disposed) setError("Could not load chat. Check your connection and sign in again."); });

    return () => { disposed = true; generation.current++; source.current?.close(); };
  }, [load, setBootstrap]);

  const perform = async (operation: () => Promise<void>) => {
    setError("");
    setPending(true);

    try { await operation(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed");

      // A failed native request may have consumed the last locally permitted request.
      try { setBootstrap(Bootstrap.parse(await (await request("/api/chat")).json())); }
      catch { /* Keep the original operation error when status cannot be refreshed. */ }
    }
    finally { setPending(false); }
  };

  const current = turns.find((turn) => turn.status === "running");
  const selectedStored = bootstrap?.readiness[conversationHarness ?? newHarness];
  const exhausted = bootstrap?.consoleUsage && consoleExhausted(bootstrap.consoleUsage);
  const isNewChat = turns.length === 0 && mcp.pending.length === 0 && mcp.decisions.length === 0 && !mcp.incomplete;

  const messages: ThreadMessageLike[] = turns.flatMap((turn) => [
    { id: `${turn.id}-user`, role: "user", metadata: { custom: { turn } }, content: [{ type: "text", text: turn.prompt }] },
    { id: turn.id, role: "assistant", metadata: { custom: { turn } }, content: [
      // Browser-only rendering discriminator, not a stored or SDK protocol field.
      ...turn.activity.map((tool) => ({ type: "data" as const, name: "tool-activity", data: tool })),
      { type: "text", text: turn.answer },
    ] },
  ]);

  const runtime = useExternalStoreRuntime({
    adapters: { threadList: { threadId: conversation } },
    messages, convertMessage: (message) => message, isRunning: Boolean(current),
    isDisabled: pending || !selectedStored || !conversation || readyConversation !== conversation,
    isSendDisabled: uploading || Boolean(conversation && uploads[conversation]),
    onNew: async (message) => perform(async () => {
      if (!bootstrap || !conversation) return;

      const prompt = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

      try {
        await request(`/api/chat/${conversation}`, { csrf: bootstrap.csrf, prompt, attachments: (attachmentDrafts[conversation] ?? []).map((file) => file.path) });
      } catch (failure) {
        runtime.thread.composer.setText(prompt);
        throw failure;
      }

      setAttachmentDrafts((previous) => ({ ...previous, [conversation]: [] }));
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

  const attachmentControl = <AttachmentControl key={conversation ?? "none"} selected={conversation ? attachmentDrafts[conversation] ?? [] : []}
    disabled={pending || uploading || preparing || Boolean(current) || !conversation || readyConversation !== conversation || !selectedStored}
    upload={conversation ? uploads[conversation] : undefined} onUpload={(file) => void uploadAttachment(file)}
    onRemoveUpload={() => { if (conversation) setUploads((previous) => ({ ...previous, [conversation]: undefined })); }}
    onChange={(next) => { if (conversation) setAttachmentDrafts((previous) => ({ ...previous, [conversation]: next })); }} />;

  return <LayoutShell screen={screen} onScreen={setScreen} conversations={bootstrap?.conversations ?? []} selected={conversation}
    newHarness={<label className="masthead-harness"><span>New chat harness</span><select aria-label="New chat harness" value={newHarness} disabled={pending || preparing || Boolean(current)}
      onChange={(event) => setNewHarness(z.enum(["bob", "opencode"]).parse(event.target.value))}>
      <option value="bob">Bob{bootstrap?.readiness.bob ? "" : " — setup required"}</option>
      <option value="opencode">OpenCode{exhausted ? " — request limit reached" : bootstrap?.readiness.opencode ? "" : " — setup required"}</option>
    </select></label>}
    selectionDisabled={pending || preparing || uploading} onSelect={(id) => { setScreen("Chat"); void perform(() => bootstrap ? load(id, bootstrap) : Promise.resolve()); }}
    newDisabled={pending || preparing || uploading || Boolean(current) || !bootstrap?.readiness[newHarness]} onNew={() => void perform(async () => {
      if (!bootstrap) return;
      const created = z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf: bootstrap.csrf, harness: newHarness })).json());
      setBootstrap(Bootstrap.parse(await (await request("/api/chat")).json()));
      setScreen("Chat");
      await load(created.id, bootstrap);
    })} inspector={screen === "Chat" && isNewChat ? <NewChatInspector
      usage={usage}
       status={preparing ? "Preparing conversation…" : exhausted && conversationHarness === "opencode" ? "Local request limit reached." : readyConversation ? "Camenae is ready." : "Choose or create a conversation."}
      reconnect={conversation && bootstrap && <button disabled={pending || preparing} onClick={() => void perform(() => load(conversation, bootstrap))}>Reconnect / refresh</button>}
    /> : screen === "Chat" ? <ActiveChatInspector key={conversation} usage={usage} turn={turns.at(-1)} attachments={turns.flatMap((turn) => turn.attachments)} approvals={turns.filter((turn) => turn.permission).length + mcp.pending.length} onSettings={() => setScreen("Settings")} /> : screen === "Skills" ? <SkillsInspector key={selectedSkill.name} skill={selectedSkill} /> : screen === "Files" ? <FileInspector key={files.selected ?? "none"} path={files.selected} preview={files.preview} /> : <SettingsInspector />}>
    <div className={`shell-content${screen === "Chat" ? isNewChat ? " shell-content-new" : " shell-content-active" : ""}${screen === "Skills" ? " shell-content-skills" : ""}${screen === "Files" ? " shell-content-files" : ""}${screen === "Settings" ? " shell-content-settings" : ""}`}>
      {error && <p role="alert">{error}</p>}
      {screen === "Chat" && exhausted && bootstrap?.consoleUsage && (conversationHarness === "opencode" || newHarness === "opencode") && <RequestLimitNotice usage={bootstrap.consoleUsage}><button onClick={() => setScreen("Settings")}>Open Settings</button></RequestLimitNotice>}
      {screen !== "Settings" && conversationHarness && <p role="status">This conversation uses {conversationHarness === "bob" ? "Bob" : "OpenCode"}. The New Chat selector does not change existing conversations.{conversationHarness === "opencode" && " Bob approval preferences and Context7 settings apply only to Bob; OpenCode requests one-time native approvals."}</p>}
      {(current?.permission || mcp.pending.length > 0) && screen !== "Chat" && <p role="status">An approval is waiting in Chat. <button onClick={() => setScreen("Chat")}>Review approval</button></p>}
      <div className={isNewChat ? undefined : "chat-screen-active"} hidden={screen !== "Chat"}>
       {model !== null && <section className="chat-model-picker" aria-label="Conversation model">
         <label>Model for this chat <select aria-label="Model for this chat" value={model} disabled={pending || preparing || Boolean(current)} onChange={(event) => {
           const selected = ConsoleModel.parse(event.target.value);
           void perform(async () => {
             if (!conversation || !bootstrap) return;
             await request(`/api/chat/${conversation}/model`, { csrf: bootstrap.csrf, model: selected });
             await load(conversation, bootstrap);
           });
         }}>{ConsoleModel.options.map((id) => <option key={id} value={id}>{consoleModels[id]} · Free</option>)}</select></label>
         <small>Applies to the next turn. Chat history is retained and sent to the selected model. Free-model pricing can change. <a href="https://opencode.ai/v2/docs/console/models#privacy" target="_blank" rel="noreferrer">Data-use terms ↗</a></small>
         {model !== "longcat-2.5-preview-free" && model !== "space-bunny-free" && <small role="status">This provider may use submitted data to improve models. Nemotron is trial-only: do not submit personal or confidential data.</small>}
       </section>}
      <details className="chat-usage-inline"><summary>Context &amp; session usage</summary><SessionUsagePanel usage={usage} /></details>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className={isNewChat ? "thread" : "active-chat"}>
          {isNewChat ? <NewChat key={conversation ?? "welcome"} attachments={attachmentControl} status={(!selectedStored || !conversation || preparing || readyConversation !== conversation) && <>
            {!bootstrap && <p>Loading your connection…</p>}
             {bootstrap && !selectedStored && !(exhausted && (conversationHarness ?? newHarness) === "opencode") && <p><button onClick={() => setScreen("Settings")}>Open connection settings</button> to start chatting.</p>}
            {selectedStored && !conversation && <p>Select New Chat above to prepare a conversation.</p>}
            {preparing && <p>Preparing conversation…</p>}
            {conversation && bootstrap && selectedStored && !preparing && readyConversation !== conversation && <p>Conversation is not ready. <button disabled={pending} onClick={() => void perform(() => load(conversation, bootstrap))}>Reconnect</button></p>}
          </>} /> : <ActiveChat
            title={conversationTitle} attachments={attachmentControl}
            mcp={mcp} pending={pending} onScreen={setScreen}
             status={<>{preparing ? "Preparing conversation…" : current ? "Working" : exhausted && conversationHarness === "opencode" ? "Local request limit reached." : readyConversation ? "Camenae is ready." : "Conversation not ready."}{!selectedStored && !(exhausted && conversationHarness === "opencode") && <> <button onClick={() => setScreen("Settings")}>Open connection settings</button></>}</>}
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
       {bootstrap && <SettingsPage csrf={bootstrap.csrf} conversationHarness={conversationHarness} newHarness={newHarness} onNewHarness={setNewHarness}
         disabled={pending || preparing || Boolean(current)} readiness={bootstrap.readiness} consoleUsage={bootstrap.consoleUsage}
       openCode={<OpenCodeSettings csrf={bootstrap.csrf} active={screen === "Settings"} usage={bootstrap.consoleUsage} onChanged={onOpenCodeChanged} />}
       approvals={<ApprovalPreferences csrf={bootstrap.csrf} running={Boolean(current)} preparing={preparing} />}
       tools={<McpToolSettings csrf={bootstrap.csrf} running={Boolean(current)} preparing={preparing} pending={pending} onApplyingChange={setApplyingToolSettings}
         onApply={conversation && conversationHarness === "bob" && bootstrap.readiness.bob ? () => load(conversation, bootstrap) : undefined} />}
       />}
      </div>
    </div>
  </LayoutShell>;
}

const root = document.getElementById("root");

if (root) createRoot(root).render(<App />);
