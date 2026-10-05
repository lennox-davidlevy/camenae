import type { BobManagedMcpServer } from "@camenae/bob";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile, unlink } from "node:fs/promises";
import { z } from "zod";

export const managedMcpPath = "/run/camenae-mcp/servers.json";

export const workerMcpPath = "/run/bob/mcp-snapshot.json";

// Decode the application/worker JSON boundary. Gateway owns semantic validation
// and all translation to Bob's native format; this is not a native-file schema.
const pairs = z.array(z.strictObject({ name: z.string(), value: z.string() }));

const common = { name: z.string(), disabledTools: z.array(z.string()).optional(), alwaysAllow: z.array(z.string()).optional() };

const Servers = z.array(z.union([
  z.strictObject({ ...common, type: z.literal("http"), url: z.string(), headers: pairs }),
  z.strictObject({ ...common, command: z.string(), args: z.array(z.string()), env: pairs }),
]));

export function mcpFingerprint(servers: BobManagedMcpServer[]): string {
  return createHash("sha256").update(JSON.stringify(Servers.parse(servers))).digest("hex");
}

export async function writeSnapshot(path: string, value: BobManagedMcpServer[] | string): Promise<void> {
  // Both directories are deployment-owned, outside the Bob workspace. Worker
  // has a read-only mount of desired configuration; Bob cannot change it.
  const temporary = `${path}.${randomUUID()}`;

  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) throw error;
    });
  }
}

export async function readManagedServers(): Promise<BobManagedMcpServer[]> {
  let content: string;

  try { content = await readFile(managedMcpPath, "utf8"); }
  catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return [];
    throw error;
  }

  return Servers.parse(JSON.parse(content));
}

export async function readWorkerFingerprint(): Promise<string> {
  return z.string().regex(/^[a-f0-9]{64}$/).parse(JSON.parse(await readFile(workerMcpPath, "utf8")));
}
