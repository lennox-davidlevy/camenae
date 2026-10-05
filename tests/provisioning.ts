import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run the actual entrypoints in a fresh test-owned checkout shape, not against
// existing .env/auth files. Other suites create .cache before invoking auth:init.
const directory = await mkdtemp(join(tmpdir(), "camenae-provisioning-"));

try {
  await mkdir(join(directory, "scripts"));

  for (const name of ["dev-init.ts", "auth-init.ts"]) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(directory, "scripts", name));
  }

  const run = async (name: string) => {
    const child = Bun.spawn([process.execPath, join(directory, "scripts", name)], {
      cwd: directory, stdout: "pipe", stderr: "pipe",
    });

    const [exit, output, error] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);

    return { exit, message: output + error };
  };

  const auth = await run("auth-init.ts");
  assert.equal(auth.exit, 0, "auth:init must provision without an existing .cache directory");
  assert.ok(auth.message.includes("Provisioned owner login"));
  const dev = await run("dev-init.ts");
  assert.equal(dev.exit, 0);

  const paths = [".env", ".cache/local-auth/credentials.json", ".cache/local-auth/login.txt"];
  const before = await Promise.all(paths.map((path) => readFile(join(directory, path))));
  assert.equal((await stat(join(directory, ".cache/local-auth"))).mode & 0o777, 0o700);

  for (const path of paths) {
    assert.equal((await stat(join(directory, path))).mode & 0o777, 0o600);
  }

  assert.notEqual((await run("auth-init.ts")).exit, 0, "Existing auth directory must be refused");
  assert.notEqual((await run("dev-init.ts")).exit, 0, "Existing .env must be refused");

  for (const [index, path] of paths.entries()) {
    assert.ok(before[index]?.equals(await readFile(join(directory, path))), "Provisioning retry changed private bytes");
  }

  console.log("Fresh provisioning, private file modes, and overwrite refusal passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
