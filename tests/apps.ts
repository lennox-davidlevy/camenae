import assert from "node:assert/strict";
import { Effect } from "effect";
import { z } from "zod";
import { AppList, AppView, EntryReply, Failure } from "../src/apps-contract.js";
import { backlog, backlogCollection, backlogFields } from "../src/apps-seed.js";
import { Apps } from "../src/apps-store.js";
import { AppsLive } from "../src/runtime.js";

// Real routes, guards and Postgres. "seed" creates the pilot app and leaves known entries behind;
// "verify" runs after the stack is replaced and checks they survived. Synthetic data only.
const mode = z.enum(["seed", "verify"]).parse(process.argv[2]);

const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const origin = process.env.CAMENAE_ORIGIN ?? base;

const { csrf } = z.object({ csrf: z.string() }).parse(await (await fetch(`${base}/api/chat`, { headers: { cookie } })).json());

const { title, platform, status, hours } = backlogFields;

const seed = () => Effect.runPromise(Effect.gen(function* () {
  return yield* (yield* Apps).seed(backlog);
}).pipe(Effect.provide(AppsLive)));

const view = async () => AppView.parse(await (await fetch(`${base}/api/apps/${backlog.id}`, { headers: { cookie } })).json());

const titles = async () => (await view()).entries.map((entry) => entry.values[title]).sort();

interface Options {
  token?: string;
  requestOrigin?: string;
  type?: string;
  signed?: boolean;
}

const post = (action: string, body: string, options: Options = {}) => {
  const headers = new Headers({ origin: options.requestOrigin ?? origin, "content-type": options.type ?? "application/json" });

  if (options.signed !== false) headers.set("cookie", cookie);

  return fetch(`${base}/api/apps/entries/${action}`, { method: "POST", body, headers });
};

type Values = Record<string, string | number | boolean | string[] | null>;

const send = (action: string, fields: { app?: string; collection?: string; id?: string; values?: Values }, options: Options = {}) =>
  post(action, JSON.stringify({ csrf: options.token ?? csrf, app: backlog.id, ...fields }), options);

const add = async (values: Values) => {
  const response = await send("add", { collection: backlogCollection, values });
  assert.equal(response.status, 200);

  return EntryReply.parse(await response.json()).entry;
};

const refusal = async (response: Response, status: number) => {
  assert.equal(response.status, status);

  return Failure.parse(await response.json());
};

if (mode === "seed") {
  assert.equal((await fetch(`${base}/api/apps`)).status, 401, "Listing needs a session");
  assert.equal((await fetch(`${base}/api/apps/${backlog.id}`)).status, 401);
  assert.deepEqual(AppList.parse(await (await fetch(`${base}/api/apps`, { headers: { cookie } })).json()).apps, [], "An installation starts with no apps");
  assert.equal(await seed(), true);
  assert.equal(await seed(), false, "Seeding again must not overwrite");
  assert.deepEqual(AppList.parse(await (await fetch(`${base}/api/apps`, { headers: { cookie } })).json()).apps, [{ id: "backlog", name: "Backlog", icon: "🎮" }]);
  assert.deepEqual((await view()).app.definition, backlog.definition);
  assert.equal((await fetch(`${base}/api/apps/missing-app`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/apps/..%2Fescape`, { headers: { cookie } })).status, 400);

  // Refusals leave nothing behind.
  const valid = { collection: backlogCollection, values: { [title]: "Probe", [status]: "Up next" } };
  assert.equal((await send("add", valid, { token: "wrong" })).status, 401);
  assert.equal((await send("add", valid, { signed: false })).status, 401);
  assert.equal((await send("add", valid, { requestOrigin: "https://attacker.invalid" })).status, 400);
  assert.equal((await send("add", valid, { type: "text/plain" })).status, 400);
  assert.equal((await post("add", "{not json")).status, 400);
  assert.equal((await send("add", { ...valid, app: "missing-app" })).status, 404);
  assert.equal((await send("add", { ...valid, collection: "c_missing01" })).status, 404);
  assert.ok((await refusal(await send("add", { collection: backlogCollection, values: { [status]: "Up next" } }), 400)).problems?.includes("Title is required."));
  assert.ok((await refusal(await send("add", { collection: backlogCollection, values: { [title]: "x", [status]: "Someday" } }), 400)).problems?.some((problem) => problem.startsWith("Status")));
  assert.ok((await refusal(await send("add", { collection: backlogCollection, values: { [title]: "x", [status]: "Up next", f_unknown01: "x" } }), 400)).problems?.some((problem) => problem.includes("f_unknown01")));
  assert.equal((await post("add", JSON.stringify({ csrf, app: backlog.id, ...valid, values: { [title]: "x".repeat(200_000), [status]: "Up next" } }))).status, 413);
  assert.deepEqual(await titles(), []);

  // A round trip: add, edit, clear an optional value, delete.
  const outer = await add({ [title]: "Outer Wilds", [platform]: "PC", [status]: "Up next" });
  const celeste = await add({ [title]: "Celeste", [platform]: "Switch", [status]: "Playing", [hours]: 12 });
  const hades = await add({ [title]: "Hades", [platform]: "Switch", [status]: "Up next" });
  assert.equal(celeste.collection, backlogCollection);
  assert.ok(celeste.createdAt > 0);

  const finished = EntryReply.parse(await (await send("update", { id: celeste.id, values: { [status]: "Finished", [hours]: 22.5 } })).json()).entry;
  assert.deepEqual(finished.values, { [title]: "Celeste", [platform]: "Switch", [status]: "Finished", [hours]: 22.5 });
  assert.ok(finished.updatedAt >= celeste.updatedAt);
  const cleared = EntryReply.parse(await (await send("update", { id: outer.id, values: { [platform]: null } })).json()).entry;
  assert.deepEqual(cleared.values, { [title]: "Outer Wilds", [status]: "Up next" });
  assert.ok((await refusal(await send("update", { id: outer.id, values: { [title]: null } }), 400)).problems?.includes("Title is required."), "A required value cannot be cleared");
  assert.equal((await send("update", { id: crypto.randomUUID(), values: { [status]: "Finished" } })).status, 404);
  assert.equal((await send("update", { app: "other-app", id: outer.id, values: { [status]: "Finished" } })).status, 404, "An entry is reached only through its own app");

  assert.equal((await send("remove", { id: hades.id }, { token: "wrong" })).status, 401);
  assert.equal((await send("remove", { id: hades.id })).status, 200);
  assert.equal((await send("remove", { id: hades.id })).status, 404);
  assert.deepEqual(await titles(), ["Celeste", "Outer Wilds"]);
} else {
  // After the stack is replaced the app and its entries are intact, and seeding still changes nothing.
  assert.equal(await seed(), false);
  const after = await view();
  assert.deepEqual(after.app.definition, backlog.definition);
  assert.deepEqual(after.entries.map((entry) => entry.values).sort((left, right) => String(left[title]).localeCompare(String(right[title]))), [
    { [title]: "Celeste", [platform]: "Switch", [status]: "Finished", [hours]: 22.5 },
    { [title]: "Outer Wilds", [status]: "Up next" },
  ]);
}

console.log(JSON.stringify({ event: "apps_check_passed", mode }));
