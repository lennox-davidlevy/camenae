export interface ChatRequest {
  csrf: string;
  harness?: "opencode";
  model?: string;
  prompt?: string;
  attachments?: string[];
  turnId?: string;
  permissionId?: string;
  optionId?: string | null;
}

export interface SettingsRequest {
  csrf: string;
  provider?: "console";
  model?: string;
  key?: string;
  limit?: number | null;
  refresh?: boolean;
  revision?: number;
}

export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function request(path: string, body?: ChatRequest | SettingsRequest) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new RequestError(401, "Please sign in again");
  }

  if (!response.ok) throw new RequestError(response.status, await response.text());

  return response;
}
