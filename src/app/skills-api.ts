import { z } from "zod";
import { FailureCode, SkillList } from "../skills-contract.js";

export class SkillRequestError extends Error {}

const Failure = z.object({ code: FailureCode, message: z.string() });

async function check(response: Response) {
  if (response.ok) return response;

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new SkillRequestError("Please sign in again");
  }

  const parsed = Failure.safeParse(await response.json().catch(() => undefined));

  throw new SkillRequestError(parsed.success ? parsed.data.message : "The request failed. Nothing was changed.");
}

export async function listSkills() {
  return SkillList.parse(await (await check(await fetch("/api/skills"))).json()).skills;
}

interface SkillWrite {
  csrf: string;
  name: string;
  content?: string;
  enabled?: boolean;
}

const write = async (action: "save" | "enable" | "remove", body: SkillWrite) => {
  await check(await fetch(`/api/skills/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

export const saveSkill = (csrf: string, name: string, content: string) => write("save", { csrf, name, content });

export const enableSkill = (csrf: string, name: string, enabled: boolean) => write("enable", { csrf, name, enabled });

export const removeSkill = (csrf: string, name: string) => write("remove", { csrf, name });
