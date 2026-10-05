import assert from "node:assert/strict";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { z } from "zod";
import { DatabaseLive } from "../src/database.js";
import { ChatView } from "../src/chat-contract.js";

const mode = z.enum(["reauth", "cancel", "cancel-running", "switch", "revoke", "idle-revoke", "recovery"]).parse(process.argv[2]);

const input = z.object({ cookie: z.string(), conversation: z.uuid(), word: z.string(), password: z.string() }).parse(JSON.parse(await Bun.stdin.text()));

const base = "http://127.0.0.1:3000";

const request = (path: string, body?: Record<string, string | null>) => fetch(base + path, {
  method: body ? "POST" : "GET", headers: { cookie: input.cookie, origin: base, "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
});

const database = <A,>(effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) => Effect.runPromise(effect.pipe(Effect.provide(DatabaseLive)));

const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

let phase = "bootstrap";

try {
  if (mode === "reauth") {
    const login = await fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { origin: base },
      body: new URLSearchParams({ username: "owner", password: input.password }) });

    assert.equal(login.status, 303);
    input.cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  const { csrf } = z.object({ csrf: z.string() }).parse(await (await request("/api/chat")).json());

  const conversation = mode === "switch"
    ? z.object({ id: z.uuid() }).parse(await (await request("/api/chat", { csrf })).json()).id : input.conversation;

  if (mode === "recovery") {
    // Fail terminal database writes, not Bob or the application service. The
    // sequence records an attempted write despite transaction rollback.
    await database(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE SEQUENCE terminal_write_attempt`;
      yield* sql`CREATE FUNCTION fail_terminal_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status <> 'running' THEN
          PERFORM nextval('terminal_write_attempt'); RAISE EXCEPTION 'synthetic unavailable';
        END IF; RETURN NEW; END $$`;
      yield* sql`CREATE TRIGGER terminal_write_failure BEFORE UPDATE ON turn FOR EACH ROW EXECUTE FUNCTION fail_terminal_write()`;
    }));
  }

  phase = "start";
  assert.equal((await request(`/api/chat/${conversation}`, {
    csrf, prompt: ["reauth", "recovery", "idle-revoke", "switch"].includes(mode) ? "Reply with exactly recovery-ok. Do not use tools." :
      "Use a shell tool to sleep for 60 seconds, then reply done. This is a synthetic cancellation test. Do not read files or use the network.",
  })).status, 200);
  const initial = ChatView.parse(await (await request(`/api/chat/${conversation}`)).json());
  const current = initial.turns.at(-1);
  assert.equal(current?.status, "running");
  assert.ok(current);

  if (mode === "cancel" || mode === "cancel-running") {
    phase = "pending-permission";
    let permissionPending = false;
    const deadline = Date.now() + 90_000;

    while (!permissionPending && Date.now() < deadline) {
      const view = ChatView.parse(await (await request(`/api/chat/${input.conversation}`)).json());
      permissionPending = Boolean(view.turns.at(-1)?.permission);

      if (!permissionPending) await pause();
    }

    assert.ok(permissionPending, "Cancellation did not reach a native permission request");

    if (mode === "cancel-running") {
      phase = "running-tool";
      const pending = ChatView.parse(await (await request(`/api/chat/${conversation}`)).json()).turns.at(-1)?.permission;
      const option = pending?.options.find((item) => item.kind === "allow_once");
      assert.ok(pending && option);
      assert.equal((await request("/api/chat/approve", { csrf, turnId: current.id, permissionId: pending.id, optionId: option.optionId })).status, 200);
      let running = false;

      while (!running && Date.now() < deadline) {
        const view = ChatView.parse(await (await request(`/api/chat/${conversation}`)).json());
        running = view.turns.at(-1)?.activity.some((item) => item.status === "in_progress") ?? false;

        if (!running) await pause();
      }

      assert.ok(running, "Cancellation did not reach tool execution");
    }

    phase = "cancel";
    assert.equal((await request("/api/chat/cancel", { csrf, turnId: current.id })).status, 200);
    const result = ChatView.parse(await (await request(`/api/chat/${input.conversation}`)).json());
    assert.equal(result.turns.at(-1)?.status, "cancelled");
    assert.equal(result.turns.at(-1)?.stop_reason, "cancelled", "Cancellation did not settle through native ACP");
    assert.equal(result.turns.at(-1)?.permission, null);
  } else if (mode === "revoke" || mode === "idle-revoke") {
    if (mode === "idle-revoke") {
      const deadline = Date.now() + 90_000;
      let completed = false;

      while (!completed && Date.now() < deadline) {
        const view = ChatView.parse(await (await request(`/api/chat/${input.conversation}`)).json());
        completed = view.turns.at(-1)?.status === "completed";

        if (!completed) await pause();
      }

      assert.ok(completed, "Idle revocation requires a completed response");
    }

    phase = "open-stream";
    const stream = await request(`/api/chat/${input.conversation}/events`);
    assert.ok(stream.body);
    const reader = stream.body.getReader();
    assert.equal((await reader.read()).done, false);
    phase = "logout";

    const logout = await fetch(base + "/auth/logout", {
      method: "POST", redirect: "manual", headers: { cookie: input.cookie, origin: base }, body: new URLSearchParams({ csrf }),
    });

    assert.equal(logout.status, 303);
    phase = "stream-revoked";
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        (async () => { try { while (!(await reader.read()).done) { /* drain in-flight bytes */ } } catch { /* revoked stream */ } })(),
        new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error("Stream stayed open")), 3000); }),
      ]);
    } finally { clearTimeout(watchdog); }

    assert.equal((await request(`/api/chat/${input.conversation}`)).status, 401);

    phase = "relogin";

    const loginRequest = () => fetch(base + "/auth/login", { method: "POST", redirect: "manual", headers: { origin: base },
      body: new URLSearchParams({ username: "owner", password: input.password }) });

    let login = await loginRequest();
    const loginDeadline = Date.now() + 6_000;

    // Adjacent logout cases can finish within the real five-second login limit.
    while (login.status === 429 && Date.now() < loginDeadline) {
      await login.body?.cancel();
      await pause();
      login = await loginRequest();
    }

    assert.equal(login.status, 303);
    input.cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  } else if (mode === "switch" || mode === "reauth") {
    phase = "switched-conversation";
    const deadline = Date.now() + 90_000;
    let completed = false;

    while (!completed && Date.now() < deadline) {
      const view = ChatView.parse(await (await request(`/api/chat/${conversation}`)).json());
      const turn = view.turns.at(-1);
      completed = turn?.status === "completed" && turn.answer.includes("recovery-ok");

      if (!completed) await pause();
    }

    assert.ok(completed, "Switching conversations failed");
  } else {
    phase = "failed-terminal-write";
    const deadline = Date.now() + 90_000;
    let attempted = false;

    while (!attempted && Date.now() < deadline) {
      attempted = await database(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = z.array(z.object({ is_called: z.boolean() })).parse(yield* sql`SELECT is_called FROM terminal_write_attempt`);

        return rows[0]?.is_called ?? false;
      }));

      if (!attempted) await pause();
    }

    assert.ok(attempted);
    await database(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TRIGGER terminal_write_failure ON turn`;
      yield* sql`DROP FUNCTION fail_terminal_write()`;
      yield* sql`DROP SEQUENCE terminal_write_attempt`;
    }));
    phase = "reconnect-reconciliation";
    let recovered = false;

    for (let attempt = 0; attempt < 30 && !recovered; attempt++) {
      const view = ChatView.parse(await (await request(`/api/chat/${input.conversation}`)).json());
      const turn = view.turns.at(-1);
      recovered = turn?.status === "completed" && turn.answer.includes("recovery-ok");
      assert.equal(view.turns.length, initial.turns.length, "Recovery replayed the prompt");

      if (!recovered) await pause();
    }

    assert.ok(recovered, "Reconnect did not recover the terminal write");
  }

  console.log(JSON.stringify({ cookie: input.cookie, conversation: input.conversation, word: input.word }));
  console.error(`Chat ${mode} passed.`);
} catch {
  console.error(`Chat ${mode} failed at ${phase}.`);
  process.exitCode = 1;
}
