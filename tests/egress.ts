import assert from "node:assert/strict";
import { connect } from "node:net";
import { z } from "zod";
import { readManagedServers } from "../src/managed-mcp.js";

const proxy = new URL(z.string().parse(process.env.HTTPS_PROXY));

// The smoke starts a real listener on Docker's host network and independently
// verifies it is reachable there. Isolated gateway mode must block the worker.
const hostReachable = await new Promise<boolean>((resolve) => {
  const socket = connect({ host: proxy.hostname.replace(/\.2$/, ".1"), port: 48923 });
  socket.setTimeout(1500, () => socket.destroy(new Error("unreachable")));
  socket.once("error", () => resolve(false));
  socket.once("connect", () => { resolve(true); socket.destroy(); });
});

assert.equal(hostReachable, false, "Worker reached the Docker host outside the inference proxy");

for (const authority of ["example.com:443", "api.us-east.bob.ibm.com.evil.test:443", "api.us-east.bob.ibm.com:80", "mcp.context7.com:443", "mcp.context7.com.evil.test:443", "mcp.context7.com:80", "127.0.0.1:443", "169.254.169.254:80"]) {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: proxy.hostname, port: Number(proxy.port) });
    socket.setTimeout(5000, () => socket.destroy(new Error("Proxy check timeout")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); });
  });

  assert.match(response, /^HTTP\/1\.[01] 403 /);
}

console.log("Egress denies other hosts, deceptive suffixes, non-TLS ports, loopback, and metadata endpoints.");

if (process.argv.includes("--mcp-gate")) {
  const gate = (await readManagedServers()).find((server) => server.name === "context7");
  assert.ok(gate && "type" in gate, "No managed gate configured");
  const response = await fetch(gate.url, { headers: { authorization: "Bearer invalid-fixture-token" }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 401, "Worker cannot reach the authenticated gate boundary");
  console.log("Worker reaches the gate but cannot bypass its authentication or use direct Context7 proxy access.");
}
