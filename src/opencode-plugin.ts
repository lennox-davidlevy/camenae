import { readdir } from "node:fs/promises";
import { Plugin } from "@opencode/plugin";
import { z } from "zod";

const empty = { type: "object", properties: {}, additionalProperties: false } as const;

/** Trusted application plugin, installed outside the writable workspace. */
export default Plugin.define({
  id: "camenae.capabilities",
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "camenae_workspace", description: "List the names of top-level files and directories in the Camenae workspace.",
        input: empty, options: { permission: "camenae_workspace", codemode: false },
        execute: async () => ({ content: (await readdir(context.location.directory)).slice(0, 200).join("\n") }),
      });
    });

    await context.rpc.register({
      id: "camenae.runtime",
      events: {},
      methods: {
        identity: { input: empty, output: { type: "string" } },
        claim: { input: { type: "object", properties: { owner: { type: "string" } }, required: ["owner"], additionalProperties: false }, output: { type: "boolean" } },
        retire: { input: empty, output: { type: "boolean" } },
      },
    }, {
      claim: async (input) => {
        const claim = z.object({ owner: z.uuid() }).parse(input);
        // Native plugin modules are reloaded independently for each location.
        // The environment belongs to the worker process and survives those reloads;
        // the worker entrypoint clears it when a new execution lifetime starts.
        const owner = process.env.CAMENAE_OPENCODE_OWNER;

        if (owner && owner !== claim.owner) return false;
        process.env.CAMENAE_OPENCODE_OWNER = claim.owner;

        return true;
      },
      identity: async () => {
        const lifetime = process.env.CAMENAE_OPENCODE_LIFETIME;

        if (!lifetime) throw new Error("Worker lifetime is unavailable");

        return lifetime;
      },
      retire: async () => {
        // Whole-process retirement is handled by the worker entrypoint and Docker.
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);

        return true;
      },
    });
  },
});
