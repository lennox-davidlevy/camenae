import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadList, threadGroups } from "../src/ui/thread-list.js";
import type { Conversation } from "../src/chat-contract.js";

const thread = (id: string, date: Date, toolCount = 0): Conversation => ({
  id, title: "Review quarterly figures", harness: "opencode", createdAt: date.getTime(), updatedAt: date.getTime(), toolCount,
});

const cases = [
  { now: new Date(2026, 9, 8, 12), dates: [new Date(2026, 9, 8, 10), new Date(2026, 9, 7, 22), new Date(2026, 9, 5), new Date(2026, 8, 30), new Date(2026, 8, 20), new Date(2025, 8, 20)],
    labels: ["Today", "Yesterday", "This week", "Last week", "September 2026", "September 2025"] },
  // Local calendar arithmetic, including the 23-hour spring-forward day.
  { now: new Date(2026, 2, 9, 0, 30), dates: [new Date(2026, 2, 9), new Date(2026, 2, 8, 0, 15), new Date(2026, 2, 7)],
    labels: ["Today", "Yesterday", "Last week"] },
  { now: new Date(2026, 0, 1, 12), dates: [new Date(2026, 0, 1), new Date(2025, 11, 31), new Date(2025, 11, 29), new Date(2025, 11, 25), new Date(2025, 10, 30)],
    labels: ["Today", "Yesterday", "This week", "Last week", "November 2025"] },
];

for (const sample of cases) {
  const conversations = sample.dates.map((date, index) => thread(String(index), date)).reverse();
  const groups = threadGroups(conversations, sample.now);
  assert.deepEqual(groups.map((group) => group.label), sample.labels);
  assert.deepEqual(groups.flatMap((group) => group.conversations.map((item) => item.id)), sample.dates.map((_, index) => String(index)));
}

const now = new Date();

now.setHours(12, 40, 0, 0);

const html = renderToStaticMarkup(<ThreadList conversations={[thread("selected", now, 3), { ...thread("escaped", now, 1), title: "<script>bad()</script>" }]}
  selected="selected" disabled={false} onSelect={() => { throw new Error("Static render must not navigate"); }} />);

assert.ok(html.includes('aria-expanded="true"'));

assert.ok(html.includes('aria-current="true"'));

assert.ok(html.includes('3 tools · <time'));

assert.ok(html.includes('1 tool · <time'));

assert.ok(html.includes('>12:40</time>'));

assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));

assert.equal(html.includes('<script>bad()'), false);

console.log("Thread grouping, calendar boundaries, ordering, metadata and safe title rendering passed.");
