import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// A separate directory lets disposable Docker checks use the same provisioning path.
const directory = resolve(process.argv[2] ?? ".cache/local-auth");

try {
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const password = randomBytes(24).toString("base64url");

  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id", memoryCost: 65536, timeCost: 3,
  });

  await writeFile(resolve(directory, "credentials.json"), JSON.stringify({
    passwordHash, encryptionKey: randomBytes(32).toString("hex"),
  }), { flag: "wx", mode: 0o600 });
  await writeFile(resolve(directory, "login.txt"), password + "\n", { flag: "wx", mode: 0o600 });
  console.log("Provisioned owner login. Read login.txt privately; credentials.json must be retained and backed up separately from Postgres.");
} catch {
  console.error("Provisioning failed. Existing directories/credentials are never overwritten; inspect partial output before retrying.");
  process.exitCode = 1;
}
