import chat from "../src/ui/dev.html";

// Local UI only: the Docker application owns the harness and persistence.
const backend = new URL(process.env.CAMENAE_DEV_BACKEND ?? "http://127.0.0.1:3000");

const origin = "http://127.0.0.1:5173";

if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.origin === origin || backend.pathname !== "/" || backend.search || backend.hash || backend.username || backend.password) {
  throw new Error("CAMENAE_DEV_BACKEND must be a different loopback HTTP origin");
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 5173,
  development: { hmr: true },
  routes: {
    "/chat": chat,
    "/fonts.css": new Response(Bun.file(new URL("../src/ui/fonts.css", import.meta.url))),
    "/assets/camenae-coin.png": new Response(Bun.file(new URL("../src/ui/assets/camenae-coin.png", import.meta.url))),
  },
  async fetch(request) {
    const url = new URL(request.url);

    // Reject DNS rebinding and cross-origin writes before translating Origin.
    if (url.origin !== origin || request.headers.get("host") !== new URL(origin).host) {
      return new Response("Invalid host", { status: 403 });
    }

    const sourceOrigin = request.headers.get("origin");

    if ((sourceOrigin !== null && sourceOrigin !== origin) || (!["GET", "HEAD"].includes(request.method) && sourceOrigin !== origin)) {
      return new Response("Invalid origin", { status: 403 });
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");

    if (sourceOrigin === origin) headers.set("origin", backend.origin);

    url.host = backend.host;

    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body,
        signal: request.signal,
        redirect: "manual",
      });

      const outgoing = new Headers(response.headers);
      const location = outgoing.get("location");

      if (location?.startsWith(`${backend.origin}/`)) outgoing.set("location", `${origin}${location.slice(backend.origin.length)}`);

      // fetch decodes compressed bodies; do not forward stale encoding/length.
      outgoing.delete("content-encoding");
      outgoing.delete("content-length");

      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch {
      return new Response("Local backend unavailable. Start Camenae's Docker services first.", { status: 502 });
    }
  },
});

console.log(`Camenae UI: ${server.url}chat (live backend: ${backend.origin})`);
