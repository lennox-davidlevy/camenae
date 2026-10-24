export interface ChatRequest {
  csrf: string;
  harness?: "opencode";
  prompt?: string;
  attachments?: string[];
  turnId?: string;
  permissionId?: string;
  optionId?: string | null;
  decision?: "allow" | "deny";
}

export async function request(path: string, body?: ChatRequest) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);

  if (response.status === 401) {
    window.location.assign("/auth/login");
    throw new Error("Please sign in again");
  }

  if (!response.ok) throw new Error(await response.text());

  return response;
}
