/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Conversation } from "../chat-contract.js";
import { threadGroups } from "../thread-groups.js";

interface ThreadListProps {
  conversations: readonly Conversation[];
  selected?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

const threadTime = (date: Date, recent: boolean, now: Date) => {
  if (recent) return date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";

  return date.toLocaleDateString("en", options);
};

export function ThreadList(props: ThreadListProps) {
  const [now, setNow] = createSignal(new Date());
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const groups = createMemo(() => threadGroups(props.conversations, now()));

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(timer);
      const current = new Date();
      setNow(current);
      const tomorrow = new Date(current);
      tomorrow.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, tomorrow.getTime() - current.getTime() + 100);
    };

    refresh();
    document.addEventListener("visibilitychange", refresh);
    onCleanup(() => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); });
  });

  const toggle = (key: string) => setCollapsed((previous) => {
    const next = new Set(previous);

    if (next.has(key)) next.delete(key);
    else next.add(key);

    return next;
  });

  return <nav class="thread-list" aria-label="Conversations">
    <For each={groups()}>{(group) => <section class={group.key === "today" ? "thread-group" : "thread-group thread-group-older"} aria-label={group.label}>
      <button class="thread-group-label" aria-expanded={!collapsed().has(group.key)} aria-controls={`threads-${group.key}`} onClick={() => toggle(group.key)}>
        <span>{group.label}</span><span class="thread-disclosure" aria-hidden="true">{collapsed().has(group.key) ? "▾" : "▴"}</span>
      </button>
      <div id={`threads-${group.key}`} class="thread-group-items" hidden={collapsed().has(group.key)}>
        <For each={group.conversations}>{(item) => {
          const date = () => new Date(item.updatedAt);

          return <button class="thread-item" disabled={props.disabled} aria-current={item.id === props.selected ? "true" : undefined} onClick={() => props.onSelect(item.id)} title={item.title}>
            <span class="thread-title">{item.title}</span>
            <span class="thread-meta">{item.toolCount > 0 && `${item.toolCount} ${item.toolCount === 1 ? "tool" : "tools"} · `}<time dateTime={date().toISOString()} title={date().toLocaleString()}>{threadTime(date(), group.key === "today" || group.key === "yesterday", now())}</time></span>
          </button>;
        }}</For>
      </div>
    </section>}</For>
    <Show when={props.conversations.length === 0}><p>No conversations yet.</p></Show>
  </nav>;
}
