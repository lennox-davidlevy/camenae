import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

try {
  await writeFile(new URL("../.env", import.meta.url),
    `CAMENAE_DATABASE_PASSWORD=${randomBytes(32).toString("hex")}\nCAMENAE_OPENCODE_PASSWORD=${randomBytes(32).toString("hex")}\nCAMENAE_HTTP_PORT=3000\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created private .env for local Docker development. Add your provider key in Settings after signing in.");
} catch {
  console.error("Could not create .env. If it already exists, keep it; this command never overwrites credentials.");
  process.exitCode = 1;
}
