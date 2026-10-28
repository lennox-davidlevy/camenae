import type { Conversation } from "./chat-contract.js";

export function threadGroups(conversations: readonly Conversation[], now: Date) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - (week.getDay() + 6) % 7);
  const lastWeek = new Date(week);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const groups = new Map<string, { key: string; label: string; conversations: Conversation[] }>();

  for (const conversation of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))) {
    const date = new Date(conversation.updatedAt);

    const group = date >= today ? { key: "today", label: "Today" }
      : date >= yesterday ? { key: "yesterday", label: "Yesterday" }
      : date >= week ? { key: "this-week", label: "This week" }
      : date >= lastWeek ? { key: "last-week", label: "Last week" }
      : { key: `${date.getFullYear()}-${date.getMonth()}`, label: date.toLocaleDateString("en", { month: "long", year: "numeric" }) };

    const existing = groups.get(group.key);

    if (existing) existing.conversations.push(conversation);
    else groups.set(group.key, { ...group, conversations: [conversation] });
  }

  return [...groups.values()];
}
