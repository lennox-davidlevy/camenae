import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AddEntry, appLimits, checkDefinition, checkValues, failureMessages, RemoveEntry, UpdateEntry, type Entry, type FailureCode } from "../src/apps-contract.js";
import { backlog, backlogCollection, backlogSamples } from "../src/apps-seed.js";

// The seeded backlog with the application's own definition and value checks, over entries kept in this
// dev server's memory. Postgres storage is covered by tests/apps.ts on a disposable stack. Synthetic data only.
const csrf = "fixture";

const statuses = { INVALID: 400, NOT_FOUND: 404, TOO_MANY: 409 } satisfies Record<FailureCode, number>;

const checked = checkDefinition(JSON.stringify(backlog.definition));

if (!checked.ok) throw new Error(`The seeded backlog is invalid: ${checked.problems.join(" ")}`);

const { definition } = checked;

const collection = definition.collections[0];

const entries: Entry[] = backlogSamples.map((values, index) => ({
  id: randomUUID(), collection: backlogCollection, values, createdAt: Date.now() - (3 - index) * 60_000, updatedAt: Date.now() - (3 - index) * 60_000,
}));

class Refused extends Error {
  constructor(readonly code: FailureCode, readonly problems: readonly string[] = []) {
    super(code);
  }
}

const reply = <T,>(response: ServerResponse, value: T, status = 200) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const text = (request: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

const json = (body: string) => {
  try { return JSON.parse(body); } catch { throw new Refused("INVALID"); }
};

const find = (app: string, id: string) => {
  const entry = app === backlog.id ? entries.find((candidate) => candidate.id === id) : undefined;

  if (!entry) throw new Refused("NOT_FOUND");

  return entry;
};

type Written = { entry: Entry } | { ok: true };

const writes = new Map<string, (body: string) => Written>([
  ["/api/apps/entries/add", (body: string) => {
    const input = AddEntry.safeParse(json(body));

    if (!input.success || input.data.csrf !== csrf) throw new Refused("INVALID");

    if (input.data.app !== backlog.id || input.data.collection !== collection?.id) throw new Refused("NOT_FOUND");
    const values = checkValues(collection, input.data.values, undefined);

    if (!values.ok) throw new Refused("INVALID", values.problems);

    if (entries.length >= appLimits.entries) throw new Refused("TOO_MANY");
    const entry: Entry = { id: randomUUID(), collection: collection.id, values: values.values, createdAt: Date.now(), updatedAt: Date.now() };
    entries.push(entry);

    return { entry };
  }],
  ["/api/apps/entries/update", (body: string) => {
    const input = UpdateEntry.safeParse(json(body));

    if (!input.success || input.data.csrf !== csrf || !collection) throw new Refused("INVALID");
    const entry = find(input.data.app, input.data.id);
    const values = checkValues(collection, input.data.values, entry.values);

    if (!values.ok) throw new Refused("INVALID", values.problems);
    entry.values = { ...Object.fromEntries(Object.entries(entry.values).filter(([field]) => !values.cleared.includes(field))), ...values.values };
    entry.updatedAt = Date.now();

    return { entry };
  }],
  ["/api/apps/entries/remove", (body: string) => {
    const input = RemoveEntry.safeParse(json(body));

    if (!input.success || input.data.csrf !== csrf) throw new Refused("INVALID");
    const entry = find(input.data.app, input.data.id);
    entries.splice(entries.indexOf(entry), 1);

    return { ok: true } as const;
  }],
]);

export async function appsRoute(request: IncomingMessage, response: ServerResponse, path: string) {
  try {
    if (request.method === "GET" && path === "/api/apps") return reply(response, { apps: [{ id: backlog.id, name: backlog.name, icon: backlog.icon }] });

    if (request.method === "GET" && path.startsWith("/api/apps/")) {
      if (path !== `/api/apps/${backlog.id}`) throw new Refused("NOT_FOUND");

      return reply(response, { app: { ...backlog, definition }, entries });
    }

    const write = request.method === "POST" ? writes.get(path) : undefined;

    if (!write) throw new Refused("NOT_FOUND");

    return reply(response, write(await text(request)));
  } catch (error) {
    const refusal = error instanceof Refused ? error : new Refused("INVALID");

    return reply(response, { code: refusal.code, message: failureMessages[refusal.code], problems: refusal.problems }, statuses[refusal.code]);
  }
}
