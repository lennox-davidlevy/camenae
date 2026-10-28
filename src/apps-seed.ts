import type { App, Definition, EntryValues } from "./apps-contract.js";

// The hand-written pilot app. Seeded only by the development fixture and tests until the assistant can
// create apps; an installation starts with none.
const games = "c_games0001";

export const backlogFields = {
  title: "f_title0001", platform: "f_platform01", status: "f_status0001", hours: "f_hours00001", started: "f_started001", notes: "f_notes00001",
} as const;

const { title, platform, status, hours, started, notes } = backlogFields;

const definition: Definition = {
  collections: [{
    id: games, label: "Games", fields: [
      { id: title, label: "Title", type: "text", required: true },
      { id: platform, label: "Platform", type: "choice", options: ["PC", "Switch", "PlayStation", "Xbox", "Steam Deck"] },
      { id: status, label: "Status", type: "choice", options: ["Up next", "Playing", "Finished", "Dropped"], required: true },
      { id: hours, label: "Hours", type: "number", min: 0, max: 10_000 },
      { id: started, label: "Started", type: "date" },
      { id: notes, label: "Notes", type: "longText" },
    ],
  }],
  actions: [{ action: "entry.add", collection: games }, { action: "entry.update", collection: games }, { action: "entry.remove", collection: games }],
  spec: {
    root: "page",
    elements: {
      "page": { type: "Page", props: { title: "Game backlog", description: "What to play next, what you're playing, and what you've finished." }, children: ["summary", "games", "add"] },
      "summary": { type: "Columns", props: { count: 3 }, children: ["stat-next", "stat-playing", "stat-hours"] },
      "stat-next": { type: "Stat", props: { label: "Up next", collection: games, measure: "count", where: { field: status, equals: "Up next" } }, children: [] },
      "stat-playing": { type: "Stat", props: { label: "Playing", collection: games, measure: "count", where: { field: status, equals: "Playing" } }, children: [] },
      "stat-hours": { type: "Stat", props: { label: "Hours played", collection: games, measure: "sum", field: hours }, children: [] },
      "games": { type: "Section", props: { title: "Games" }, children: ["table"] },
      "table": { type: "Table", props: {
        collection: games, columns: [title, platform, status, hours, started], sort: { field: title, direction: "asc" },
        filters: [platform, status], edit: [status, hours], remove: true, muted: { field: status, equals: "Dropped" },
        empty: "No games yet. Add one below.",
      }, children: [] },
      "add": { type: "Section", props: { title: "Add a game" }, children: ["form"] },
      "form": { type: "EntryForm", props: { collection: games, fields: [title, platform, status, hours, started, notes], submit: "Add game" }, children: [] },
    },
  },
};

export const backlog: App = { id: "backlog", name: "Backlog", icon: "🎮", definition };

export const backlogCollection = games;

export const backlogSamples: EntryValues[] = [
  { [title]: "Outer Wilds", [platform]: "PC", [status]: "Up next" },
  { [title]: "Hollow Knight", [platform]: "Switch", [status]: "Playing", [hours]: 14, [started]: "2026-10-02" },
  { [title]: "Celeste", [platform]: "Switch", [status]: "Finished", [hours]: 22 },
];
