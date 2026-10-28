import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { OpenCode } from "@camenae/opencode";
import { z } from "zod";
import { SkillList } from "../src/skills-contract.js";

const { cookie } = z.object({ cookie: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const settings = z.object({ CAMENAE_OPENCODE_URL: z.string(), CAMENAE_OPENCODE_PASSWORD: z.string() }).parse(process.env);

const base = "http://127.0.0.1:3000";

const origin = process.env.CAMENAE_ORIGIN ?? base;

const { csrf } = z.object({ csrf: z.string() }).parse(await (await fetch(`${base}/api/chat`, { headers: { cookie } })).json());

interface Options {
  token?: string;
  requestOrigin?: string;
  type?: string;
  signed?: boolean;
}

const post = (action: string, body: string, options: Options = {}) => {
  const headers = new Headers({ origin: options.requestOrigin ?? origin, "content-type": options.type ?? "application/json" });

  if (options.signed !== false) headers.set("cookie", cookie);

  return fetch(`${base}/api/skills/${action}`, { method: "POST", body, headers });
};

const send = (action: string, fields: Record<string, string | boolean>, options: Options = {}) => post(action, JSON.stringify({ csrf: options.token ?? csrf, ...fields }), options);

const library = async () => SkillList.parse(await (await fetch(`${base}/api/skills`, { headers: { cookie } })).json()).skills;

const document = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\nSynthetic instructions.\n`;

const name = "probe-skill";

assert.equal((await fetch(`${base}/api/skills`)).status, 401, "Listing needs a session");

assert.deepEqual((await library()).filter((skill) => skill.name === name), []);

const client = await OpenCode.connect({ baseUrl: settings.CAMENAE_OPENCODE_URL, password: settings.CAMENAE_OPENCODE_PASSWORD,
  workspace: "/data/workspace", model: { providerID: "camenae", id: "big-pickle" } });

// The SDK's worker runs OpenCode without a file watcher, so the harness reads skills when it loads the
// workspace location; reload() rebuilds it. The chat itself reloads before its next turn (tests/opencode-chat.ts).
const visible = async (expected: boolean) => {
  await client.reload();

  for (let attempt = 0; attempt < 30; attempt++) {
    const listed = await client.native.skill.list({ location: { directory: "/data/workspace" } });

    if (listed.data.length > 0 && listed.data.some((skill) => skill.name === name) === expected) return;
    await Bun.sleep(500);
  }

  assert.fail(`After a reload the harness should ${expected ? "see" : "not see"} the skill`);
};

try {
  // Refusals leave nothing behind.
  assert.equal((await send("save", { name, content: document(name, "x") }, { token: "wrong" })).status, 401);
  assert.equal((await send("save", { name, content: document(name, "x") }, { signed: false })).status, 401);
  assert.equal((await send("save", { name, content: document(name, "x") }, { requestOrigin: "https://attacker.invalid" })).status, 400);
  assert.equal((await send("save", { name, content: document(name, "x") }, { type: "text/plain" })).status, 400);
  assert.equal((await send("save", { name: "Not Valid", content: document("not-valid", "x") })).status, 400);
  assert.equal((await send("save", { name: "../escape", content: document("escape", "x") })).status, 400);
  assert.equal((await send("save", { name, content: document("other-name", "x") })).status, 400, "The folder name and the document name must agree");
  assert.equal((await send("save", { name, content: "no front matter" })).status, 400);
  assert.equal((await send("save", { name, content: document(name, "") })).status, 400, "A description is required");
  assert.equal((await send("save", { name, content: `${document(name, "x")}${"y".repeat(70_000)}` })).status, 400);
  assert.equal((await post("save", JSON.stringify({ csrf, name, content: "z".repeat(300_000) }))).status, 413);
  assert.deepEqual((await library()).filter((skill) => skill.name === name), []);

  // A new skill is stored but not exposed to the harness.
  assert.equal((await send("save", { name, content: document(name, "Synthetic probe.") })).status, 200);
  const created = (await library()).find((skill) => skill.name === name);
  assert.equal(created?.enabled, false);
  assert.equal(created?.description, "Synthetic probe.");
  await visible(false);

  assert.equal((await send("enable", { name, enabled: true })).status, 200);
  assert.equal((await library()).find((skill) => skill.name === name)?.enabled, true);
  await visible(true);

  assert.equal((await send("save", { name, content: document(name, "Edited while on.") })).status, 200);
  const edited = (await library()).find((skill) => skill.name === name);
  assert.equal(edited?.enabled, true, "Saving must not change whether a skill is on");
  assert.equal(edited?.description, "Edited while on.");

  assert.equal((await send("enable", { name, enabled: false })).status, 200);
  await visible(false);
  assert.equal((await send("enable", { name: "missing-skill", enabled: true })).status, 404);

  // Skills live outside the workspace.
  assert.equal((await readdir("/data/workspace")).includes(name), false);

  assert.equal((await send("remove", { name })).status, 200);
  assert.deepEqual((await library()).filter((skill) => skill.name === name), []);
  assert.equal((await send("remove", { name })).status, 404);
  console.log("Skills: validation, request guards, on/off exposure to the harness, edit, and delete passed.");
} finally {
  await client.close();
}
