import { createSignal } from "solid-js";
import { listPaths } from "./files-api.js";

// Every visible workspace path, re-read at most every few seconds so files saved
// meanwhile appear. Shared by the @ finder and attachment naming.
export function createWorkspacePaths() {
  const [paths, setPaths] = createSignal<readonly string[]>([]);
  let loadedAt = 0;

  const load = async (force = false) => {
    if (!force && Date.now() - loadedAt < 5000) return;
    loadedAt = Date.now();

    try { setPaths((await listPaths()).paths); }
    catch { /* The list keeps what it had. */ }
  };

  return { paths, load };
}

export type WorkspacePaths = ReturnType<typeof createWorkspacePaths>;
