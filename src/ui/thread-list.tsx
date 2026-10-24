import { useEffect, useState } from "react";
import type { Conversation } from "../chat-contract.js";
import { threadGroups } from "../thread-groups.js";

export { threadGroups };

export function ThreadList({ conversations, selected, disabled, onSelect }: {
  conversations: readonly Conversation[];
  selected?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [collapsed, setCollapsed] = useState(() => new Set<string>());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

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

    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  return <nav className="thread-list" aria-label="Conversations">
    {threadGroups(conversations, now).map((group) => <section className={`thread-group${group.key === "today" ? "" : " thread-group-older"}`} key={group.key} aria-label={group.label}>
      <button className="thread-group-label" aria-expanded={!collapsed.has(group.key)} aria-controls={`threads-${group.key}`} onClick={() => setCollapsed((previous) => {
        const next = new Set(previous);

        if (next.has(group.key)) next.delete(group.key);
        else next.add(group.key);

        return next;
      })}><span>{group.label}</span><span className="thread-disclosure" aria-hidden="true">{collapsed.has(group.key) ? "▾" : "▴"}</span></button>
      <div id={`threads-${group.key}`} className="thread-group-items" hidden={collapsed.has(group.key)}>
        {group.conversations.map((item) => {
          const date = new Date(item.updatedAt);
          const recent = group.key === "today" || group.key === "yesterday";
          const dateOptions: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

          if (date.getFullYear() !== now.getFullYear()) dateOptions.year = "numeric";

          const time = recent ? date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
            : date.toLocaleDateString("en", dateOptions);

          return <button className="thread-item" key={item.id} disabled={disabled} aria-current={item.id === selected ? "true" : undefined} onClick={() => onSelect(item.id)} title={item.title}>
            <span className="thread-title">{item.title}</span>
            <span className="thread-meta">{item.toolCount > 0 && `${item.toolCount} ${item.toolCount === 1 ? "tool" : "tools"} · `}<time dateTime={date.toISOString()} title={date.toLocaleString()}>{time}</time></span>
          </button>;
        })}
      </div>
    </section>)}
    {conversations.length === 0 && <p>No conversations yet.</p>}
  </nav>;
}
