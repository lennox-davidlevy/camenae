import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { InlineConfig, Plugin } from "vite";
import solid from "vite-plugin-solid";

export const repository = fileURLToPath(new URL("../", import.meta.url));

const root = `${repository}src/app`;

const fonts = ["gloock", "geist", "geist-medium", "geist-semibold", "geist-italic", "geist-mono", "geist-mono-medium"];

const files = new Map<string, { path: string; type: string }>([
  ["/fonts.css", { path: `${repository}src/ui/fonts.css`, type: "text/css" }],
  ["/assets/camenae-coin.png", { path: `${repository}src/ui/assets/camenae-coin.png`, type: "image/png" }],
  ...fonts.map((name) => [`/fonts/${name}.ttf`, { path: `${repository}src/ui/fonts/${name}.ttf`, type: "font/ttf" }] as const),
]);

// Serves the same fixed asset URLs the application serves, from the source tree.
const assets: Plugin = {
  name: "camenae-assets",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const file = files.get(new URL(request.url ?? "/", "http://localhost").pathname);

      if (!file) return next();
      response.setHeader("content-type", file.type);
      response.end(await readFile(file.path));
    });
  },
};

export const appConfig: InlineConfig = {
  configFile: false,
  root,
  appType: "mpa",
  plugins: [solid(), assets],
  build: { outDir: `${repository}public/app`, emptyOutDir: true },
};
