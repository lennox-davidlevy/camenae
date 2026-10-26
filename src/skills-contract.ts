import { z } from "zod";

// A skill is a folder holding one SKILL.md. The folder name is the skill's identity.
export const skillFile = "SKILL.md";

export const skillSizeLimit = 64 * 1024;

export const skillCountLimit = 100;

export const descriptionLimit = 1024;

export const SkillName = z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const FailureCode = z.enum(["INVALID", "NOT_FOUND", "EXISTS", "TOO_MANY"]);

export type FailureCode = z.infer<typeof FailureCode>;

export const failureMessages = {
  INVALID: "That skill is not valid. Nothing was changed.",
  NOT_FOUND: "That skill no longer exists.",
  EXISTS: "A skill with that name already exists. Nothing was changed.",
  TOO_MANY: "The skill library is full. Remove a skill first.",
} satisfies Record<FailureCode, string>;

export const Skill = z.object({
  name: SkillName,
  description: z.string(),
  enabled: z.boolean(),
  content: z.string().max(skillSizeLimit),
});

export type Skill = z.infer<typeof Skill>;

export const SkillList = z.object({ skills: z.array(Skill) });

export const SaveSkill = z.object({ csrf: z.string(), name: SkillName, content: z.string().max(skillSizeLimit) });

export const EnableSkill = z.object({ csrf: z.string(), name: SkillName, enabled: z.boolean() });

export const RemoveSkill = z.object({ csrf: z.string(), name: SkillName });

const plain = (text: string) => ![...text].some((character) => {
  const code = character.codePointAt(0) ?? 0;

  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 || (code >= 0xd800 && code <= 0xdfff);
});

const unquote = (value: string) => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  return trimmed.length >= 2 && (quote === "\"" || quote === "'") && trimmed.endsWith(quote) ? trimmed.slice(1, -1) : trimmed;
};

export type Parsed = { ok: true; name: string; description: string } | { ok: false };

// Only the two top-level fields every harness requires. The rest of the front matter is left to the harness.
export function parseSkill(content: string): Parsed {
  if (!plain(content) || content.length === 0) return { ok: false };
  const lines = content.replaceAll("\r\n", "\n").split("\n");

  if (lines[0]?.trim() !== "---") return { ok: false };
  const end = lines.indexOf("---", 1);

  if (end === -1) return { ok: false };
  const fields = new Map<string, string>();

  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);

    if (match?.[1] !== undefined && match[2] !== undefined && !fields.has(match[1])) fields.set(match[1], unquote(match[2]));
  }

  const name = SkillName.safeParse(fields.get("name"));
  const description = fields.get("description") ?? "";

  if (!name.success || description === "" || description.length > descriptionLimit) return { ok: false };

  return { ok: true, name: name.data, description };
}

export const skillTemplate = (name: string) => `---\nname: ${name}\ndescription: Say when to use this skill.\n---\nWrite the instructions here.\n`;
