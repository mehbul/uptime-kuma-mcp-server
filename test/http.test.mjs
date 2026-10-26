import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("HTTP authenticates requests and supports independent concurrent MCP clients", async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["dist/index.js"], {
    env: { ...process.env, TRANSPORT: "http", PORT: String(port), MCP_HTTP_TOKEN: "test-http-token", UPTIME_KUMA_URL: "http://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (data) => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  const clients = [];
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { Authorization: "Bearer test-http-token", Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
    await Promise.all([1, 2, 3].map(async (n) => {
      const client = new Client({ name: `http-test-${n}`, version: "1.0.0" });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: "Bearer test-http-token" } } }));
      assert.equal((await client.listTools()).tools.length, 12);
      assert.equal((await client.listTools()).tools.length, 12);
    }));
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    const exit = once(child, "exit");
    child.kill();
    await exit;
  }
});
