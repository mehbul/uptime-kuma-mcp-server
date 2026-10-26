import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const http = createServer();
const io = new Server(http);
const mcp = new Client({ name: "monitor-input-test", version: "1.0" });
const added = [];
let active = true;
io.on("connection", (socket) => {
  socket.on("login", (_data, cb) => cb({ ok: true, token: "jwt" }));
  socket.on("loginByToken", (_jwt, cb) => cb({ ok: true }));
  socket.on("add", (monitor, cb) => { added.push(monitor); cb({ ok: true, monitorID: added.length }); });
  socket.on("getMonitor", (_id, cb) => cb({ ok: true, monitor: { id: 1, name: "Existing", type: "http", active, interval: 60, url: "http://localhost" } }));
  socket.on("editMonitor", (_monitor, cb) => cb({ ok: true })); // upstream ignores active here
  socket.on("pauseMonitor", (_id, cb) => { active = false; cb({ ok: true }); });
  socket.on("resumeMonitor", (_id, cb) => { active = true; cb({ ok: true }); });
  socket.emit("info", { version: "2.5.7" });
});
before(async () => {
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "pipe",
    env: { ...process.env, TRANSPORT: "stdio", UPTIME_KUMA_URL: `http://127.0.0.1:${http.address().port}`, UPTIME_KUMA_USERNAME: "test", UPTIME_KUMA_PASSWORD: "test", UPTIME_KUMA_TOKEN: "" } }));
});
after(async () => { await mcp.close(); await new Promise((resolve) => io.close(resolve)); });
const create = (args) => mcp.callTool({ name: "uptime_kuma_create_monitor", arguments: { name: "Test", ...args } });

test("invalid type-specific inputs fail before creating a monitor", async () => {
  for (const args of [{ type: "http" }, { type: "keyword", url: "http://localhost" }, { type: "ping" }, { type: "dns" }, { type: "port", hostname: "localhost" }]) {
    assert.equal((await create(args)).isError, true, JSON.stringify(args));
  }
  assert.equal(added.length, 0);
});
test("Steam/MQTT/Docker cannot silently create incomplete monitors", async () => {
  for (const type of ["steam", "mqtt", "docker"]) assert.equal((await create({ type })).isError, true);
});
test("DNS settings are passed through to Kuma", async () => {
  const result = await create({ type: "dns", hostname: "test.invalid", port: 5353, dns_resolve_type: "A", dns_resolve_server: "127.0.0.1" });
  assert.notEqual(result.isError, true);
  assert.equal(added.at(-1).dns_resolve_type, "A");
  assert.equal(added.at(-1).dns_resolve_server, "127.0.0.1");
});
test("push creation generates a usable URL and a distinct token per monitor", async () => {
  const first = await create({ type: "push" });
  const token = added.at(-1).pushToken;
  assert.match(token || "", /^[a-f0-9]{32}$/);
  assert.ok(first.structuredContent.push_url.endsWith(`/api/push/${token}`));
  await create({ type: "push" });
  assert.notEqual(added.at(-1).pushToken, token);
});
test("editing active invokes pause/resume rather than claiming a change Kuma ignored", async () => {
  for (const state of [false, true]) {
    const result = await mcp.callTool({ name: "uptime_kuma_edit_monitor", arguments: { id: 1, active: state } });
    assert.notEqual(result.isError, true);
    assert.equal(active, state);
  }
});
