import type { Plugin } from "vite";

const minute = 60_000;

const day = 24 * 60 * minute;

// Synthetic conversations only: nothing here is read from an installation.
const conversation = (id: string, title: string, harness: "bob" | "opencode", age: number, toolCount: number) => ({
  id, title, harness, toolCount, createdAt: Date.now() - age - 5 * minute, updatedAt: Date.now() - age,
});

const conversations = () => [
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d01", "Plan a game backlog tracker", "opencode", 12 * minute, 4),
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d02", "Summarize last week's reading notes", "bob", 3 * 60 * minute, 0),
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d03", "Rename the files in the reports folder", "bob", day + 2 * 60 * minute, 7),
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d04", "Draft a calendar view with a dark theme", "opencode", 3 * day, 1),
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d05", "Compare two meal tracker layouts", "bob", 11 * day, 2),
  conversation("5b3f0c1e-7a41-4c52-9c11-0a1f2b3c4d06", "Old experiment with a very long title that should wrap across two lines in the sidebar", "bob", 45 * day, 0),
];

export const fixtureBackend: Plugin = {
  name: "camenae-fixture-backend",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.method !== "GET" || new URL(request.url ?? "/", "http://localhost").pathname !== "/api/chat") return next();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ csrf: "fixture", conversations: conversations() }));
    });
  },
};
