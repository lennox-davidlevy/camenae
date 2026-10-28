import { mkdir, mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnableSkill, FailureCode, failureMessages, RemoveSkill, SaveSkill, skillTemplate } from "../src/skills-contract.js";
import { enableSkill, listSkills, removeSkill, saveSkill, SkillProblem } from "../src/skills-store.js";

// The real skill storage code over a throwaway directory, so the dev server behaves like the application.
// State disappears with the process. Skills here are synthetic.
const csrf = "fixture";

const statuses = { INVALID: 400, NOT_FOUND: 404, EXISTS: 409, TOO_MANY: 409 } satisfies Record<FailureCode, number>;

const root = await mkdtemp(join(tmpdir(), "camenae-skills-"));

await mkdir(join(root, "active"));

await mkdir(join(root, "disabled"));

await saveSkill(root, "writer", "---\nname: writer\ndescription: Drafts and edits long-form text in your voice.\n---\nKeep the author's voice. Ask before cutting.\n");

await saveSkill(root, "research-notes", skillTemplate("research-notes"));

await enableSkill(root, "writer", true);

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

const writes = new Map([
  ["/api/skills/save", async (value: string) => {
    const parsed = SaveSkill.safeParse(JSON.parse(value));

    if (!parsed.success) throw new SkillProblem("INVALID");

    return parsed.data.csrf === csrf ? saveSkill(root, parsed.data.name, parsed.data.content) : undefined;
  }],
  ["/api/skills/enable", async (value: string) => {
    const parsed = EnableSkill.safeParse(JSON.parse(value));

    if (!parsed.success) throw new SkillProblem("INVALID");

    return parsed.data.csrf === csrf ? enableSkill(root, parsed.data.name, parsed.data.enabled) : undefined;
  }],
  ["/api/skills/remove", async (value: string) => {
    const parsed = RemoveSkill.safeParse(JSON.parse(value));

    if (!parsed.success) throw new SkillProblem("INVALID");

    return parsed.data.csrf === csrf ? removeSkill(root, parsed.data.name) : undefined;
  }],
]);

export async function skillsRoute(request: IncomingMessage, response: ServerResponse, path: string) {
  try {
    if (request.method === "GET" && path === "/api/skills") return reply(response, { skills: await listSkills(root) });

    const write = request.method === "POST" ? writes.get(path) : undefined;

    if (!write) return reply(response, { code: "INVALID", message: failureMessages.INVALID }, 400);
    await write(await text(request));

    return reply(response, { ok: true });
  } catch (error) {
    const code = error instanceof SkillProblem ? error.code : "INVALID";

    return reply(response, { code, message: failureMessages[code] }, statuses[code]);
  }
}
