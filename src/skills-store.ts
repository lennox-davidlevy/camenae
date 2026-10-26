import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type FailureCode, parseSkill, type Skill, skillCountLimit, skillFile, SkillName, skillSizeLimit } from "./skills-contract.js";

export class SkillProblem extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

// Names are validated before any path is built, so a name can never leave its folder.
const valid = (name: string) => {
  if (!SkillName.safeParse(name).success) throw new SkillProblem("INVALID");
};

const location = async (root: string, name: string) => {
  valid(name);

  for (const state of ["active", "disabled"] as const) {
    if (await exists(join(root, state, name))) return state;
  }

  return undefined;
};

async function read(root: string, state: "active" | "disabled", name: string): Promise<Skill | undefined> {
  const file = join(root, state, name, skillFile);
  const info = await lstat(file).catch(() => undefined);

  if (!info?.isFile() || info.size > skillSizeLimit) return undefined;
  const content = await readFile(file, "utf8");
  const parsed = parseSkill(content);

  return parsed.ok && parsed.name === name ? { name, description: parsed.description, enabled: state === "active", content } : undefined;
}

export async function listSkills(root: string) {
  const skills: Skill[] = [];

  for (const state of ["active", "disabled"] as const) {
    const entries = await readdir(join(root, state), { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !SkillName.safeParse(entry.name).success) continue;
      const skill = await read(root, state, entry.name);

      if (skill) skills.push(skill);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// New skills start disabled: a skill steers the agent, so it is reviewed before the harness can see it.
export async function saveSkill(root: string, name: string, content: string) {
  const parsed = parseSkill(content);

  if (!parsed.ok || parsed.name !== name || Buffer.byteLength(content) > skillSizeLimit) throw new SkillProblem("INVALID");
  const state = await location(root, name);

  if (!state && (await listSkills(root)).length >= skillCountLimit) throw new SkillProblem("TOO_MANY");
  const directory = join(root, state ?? "disabled", name);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const temporary = join(directory, `.${skillFile}.${process.pid}.tmp`);
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, join(directory, skillFile));
}

export async function enableSkill(root: string, name: string, enabled: boolean) {
  const state = await location(root, name);

  if (!state) throw new SkillProblem("NOT_FOUND");

  if ((state === "active") === enabled) return;
  const target = join(root, enabled ? "active" : "disabled", name);

  if (await exists(target)) throw new SkillProblem("EXISTS");
  await rename(join(root, state, name), target);
}

export async function removeSkill(root: string, name: string) {
  const state = await location(root, name);

  if (!state) throw new SkillProblem("NOT_FOUND");
  await rm(join(root, state, name), { recursive: true });
}
