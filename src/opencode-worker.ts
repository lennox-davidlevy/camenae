import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

// This entrypoint runs only in the separately contained worker, never in the app.
process.umask(0o077);

const root = process.env.CAMENAE_OPENCODE_STATE ?? "/data/opencode-state";

const configuration = process.env.CAMENAE_OPENCODE_CONFIG;

const password = process.env.CAMENAE_OPENCODE_PASSWORD;

if (!configuration || !password) throw new Error("OpenCode worker configuration is required");

const content = await readFile(configuration, "utf8");

const proxy = process.env.HTTPS_PROXY;

const apiKey = process.env.CAMENAE_MODEL_API_KEY;

const consoleFree = process.env.CAMENAE_OPENCODE_CONSOLE_FREE === "true";

process.env = {
  PATH: "/usr/local/bin:/usr/bin:/bin", HOME: `${root}/home`,
  XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`,
  XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`,
  TMPDIR: "/tmp", CAMENAE_OPENCODE_LIFETIME: randomUUID(),
};

if (proxy) process.env.HTTPS_PROXY = proxy;

if (apiKey) process.env.CAMENAE_MODEL_API_KEY = apiKey;

if (consoleFree) process.env.CAMENAE_OPENCODE_GATE_TOKEN = password;

for (const name of ["home", "config", "data", "cache", "state"]) await mkdir(`${root}/${name}`, { recursive: true, mode: 0o700 });

const { serve } = await import("@camenae/opencode/worker");

const worker = await serve({
  hostname: "0.0.0.0", port: 4096, password, database: `${root}/sessions.db`,
  configDirectory: `${root}/config/opencode`, configuration: content,
});

let closing = false;

const close = () => {
  if (closing) return;
  closing = true;
  const escalation = setTimeout(() => process.exit(1), 5000);
  void worker.close().then(() => {
    clearTimeout(escalation);
    process.exit(0);
  }, () => process.exit(1));
};

process.on("SIGTERM", close);

process.on("SIGINT", close);
