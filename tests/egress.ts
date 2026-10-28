import assert from "node:assert/strict";
import { connect } from "node:net";
import { z } from "zod";

const proxy = new URL(z.string().parse(process.env.HTTPS_PROXY));

// The smoke starts a real listener on Docker's host network and independently
// verifies it is reachable there. Isolated gateway mode must block this container.
const hostReachable = await new Promise<boolean>((resolve) => {
  const socket = connect({ host: proxy.hostname.replace(/\.2$/, ".1"), port: 48923 });
  socket.setTimeout(1500, () => socket.destroy(new Error("unreachable")));
  socket.once("error", () => resolve(false));
  socket.once("connect", () => { resolve(true); socket.destroy(); });
});

assert.equal(hostReachable, false, "Container reached the Docker host outside the egress proxy");

// Run from the worker, which is not the trusted gate: the provider host is refused for it too.
for (const authority of ["example.com:443", "opencode.ai:443", "opencode.ai.evil.test:443", "opencode.ai:80", "127.0.0.1:443", "169.254.169.254:80"]) {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: proxy.hostname, port: Number(proxy.port) });
    socket.setTimeout(5000, () => socket.destroy(new Error("Proxy check timeout")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); });
  });

  assert.match(response, /^HTTP\/1\.[01] 403 /);
}

console.log("Egress denies other hosts, deceptive suffixes, non-TLS ports, loopback, and metadata endpoints for the worker.");
