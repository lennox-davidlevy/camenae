import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { OpenCode } from "@camenae/opencode";
import { z } from "zod";

const settings = z.object({ CAMENAE_OPENCODE_URL: z.string(), CAMENAE_OPENCODE_PASSWORD: z.string() }).parse(process.env);

const client = await OpenCode.connect({ baseUrl: settings.CAMENAE_OPENCODE_URL, password: settings.CAMENAE_OPENCODE_PASSWORD,
  workspace: "/data/workspace", model: { providerID: "camenae", id: "assistant" } });

try {
  const owner = randomUUID();
  const contender = randomUUID();

  const call = (directory: string, method: string, input: { owner?: string }) => client.native.rpc.call({
    rpcID: "camenae.runtime", method, input, location: { directory },
  });

  const lifetime = await call("/data/workspace", "identity", {});
  assert.equal((await call("/data/workspace", "claim", { owner })).output, true);
  await mkdir("/data/workspace/other-location", { recursive: true });
  assert.deepEqual(await call("/data/workspace/other-location", "identity", {}), lifetime);
  assert.equal((await call("/data/workspace/other-location", "claim", { owner: contender })).output, false,
    "A second location must not reset worker ownership");
  await client.native.debug.location.evict({ location: { directory: "/data/workspace" } });
  assert.equal((await call("/data/workspace", "claim", { owner: contender })).output, false,
    "Evicting and reloading a location must not reset worker ownership");
  console.log("Native worker ownership survives location changes and reloads.");
} finally { await client.close(); }
