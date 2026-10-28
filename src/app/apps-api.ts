import { AppList, AppView, EntryReply, Failure, type EntryChanges } from "../apps-contract.js";

export class AppRequestError extends Error {
  constructor(message: string, readonly problems: readonly string[] = []) {
    super(message);
  }
}

async function check(response: Response) {
  if (response.ok) return response;

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new AppRequestError("Please sign in again");
  }

  const parsed = Failure.safeParse(await response.json().catch(() => undefined));

  throw parsed.success ? new AppRequestError(parsed.data.message, parsed.data.problems) : new AppRequestError("The request failed. Nothing was changed.");
}

export async function listApps() {
  return AppList.parse(await (await check(await fetch("/api/apps"))).json()).apps;
}

export async function loadApp(id: string) {
  return AppView.parse(await (await check(await fetch(`/api/apps/${encodeURIComponent(id)}`))).json());
}

interface EntryWrite {
  csrf: string;
  app: string;
  collection?: string;
  id?: string;
  values?: EntryChanges;
}

const post = (action: "add" | "update" | "remove", body: EntryWrite) =>
  fetch(`/api/apps/entries/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(check);

export const addEntry = async (csrf: string, app: string, collection: string, values: EntryChanges) =>
  EntryReply.parse(await (await post("add", { csrf, app, collection, values })).json()).entry;

export const updateEntry = async (csrf: string, app: string, id: string, values: EntryChanges) =>
  EntryReply.parse(await (await post("update", { csrf, app, id, values })).json()).entry;

export const removeEntry = async (csrf: string, app: string, id: string) => {
  await post("remove", { csrf, app, id });
};
