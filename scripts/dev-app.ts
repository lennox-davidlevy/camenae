import { createServer, mergeConfig } from "vite";
import { appConfig, repository } from "./app-vite.js";
import { fixtureBackend } from "./dev-app-fixture.js";

// Fast loop for the Solid UI: no Docker, no image builds. Default data is synthetic.
// `--backend http://127.0.0.1:PORT` proxies /api and /auth to a separate loopback instance.
const usage = "Usage: bun scripts/dev-app.ts [--backend http://127.0.0.1:3000] [--port 5174]";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);

  return index === -1 ? undefined : process.argv[index + 1];
};

const port = Number(argument("--port") ?? "5174");

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port. ${usage}`);

const backendText = argument("--backend");

const origin = `http://127.0.0.1:${port}`;

const backend = backendText ? new URL(backendText) : undefined;

if (backend && (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.origin === origin
  || backend.pathname !== "/" || backend.search || backend.hash || backend.username || backend.password)) {
  throw new Error(`The backend must be a different loopback HTTP origin. ${usage}`);
}

const server = await createServer(mergeConfig(appConfig, {
  plugins: backend ? [] : [fixtureBackend],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    cors: false,
    allowedHosts: ["127.0.0.1"],
    fs: { strict: true, allow: [`${repository}src`, `${repository}node_modules`] },
    proxy: backend ? { "^/(api|auth)(/|$)": { target: backend.origin, changeOrigin: false } } : undefined,
  },
}));

await server.listen();

server.printUrls();

process.stdout.write(backend ? `Proxying /api and /auth to ${backend.origin}\n` : "Using synthetic fixture data (no backend)\n");
