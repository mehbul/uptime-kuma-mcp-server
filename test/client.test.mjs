import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { Server } from "socket.io";
import * as client from "../dist/services/uptime-kuma-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const http = createServer();
const io = new Server(http);
const monitors = { "1": { id: 1, name: "Example", type: "http", active: true, interval: 60 } };
let connections = 0;
let rejectLogin = false;
let rejectChart = false;
let emptyChart = false;
let passwordLogins = 0;
let tokenLogins = 0;
io.on("connection", (socket) => {
  connections++;
  socket.on("disconnect", () => connections--);
  const login = (...args) => {
    const cb = args.at(-1);
    if (rejectLogin) return cb({ ok: false, msg: "Invalid credentials" });
    // Kuma 2.5.7 calls afterLogin BEFORE acknowledging either login method.
    socket.emit("monitorList", monitors);
    socket.emit("notificationList", [{ id: 1, name: "Private", active: true, config: { type: "webhook", webhookURL: "secret" } }]);
    socket.emit("statusPageList", { "1": { id: 1, slug: "public", title: "Public", published: true } });
    cb({ ok: true, token: "fixture-login-jwt" });
  };
  // The real server awaits sendInfo before installing login handlers.
  setTimeout(() => {
    socket.on("login", (...args) => { passwordLogins++; login(...args); });
    socket.on("loginByToken", (...args) => { tokenLogins++; login(...args); });
    socket.emit("info", { version: "2.5.7" });
  }, 20);
  socket.on("getMonitorList", (cb) => { socket.emit("monitorList", monitors); cb?.({ ok: true }); });
  socket.on("getMonitor", (_id, cb) => cb({ ok: true, monitor: { ...monitors["1"], basic_auth_pass: "fixture-private-password", bearer_token: "fixture-private-token", headers: "private-header", pushToken: "private-push-token" } }));
  socket.on("getMonitorChartData", (_id, _period, cb) => cb(rejectChart
    ? { ok: false, msg: "Monitor not found" }
    : { ok: true, data: emptyChart ? [] : [{ up: 3, down: 1, avgPing: 20 }, { up: 1, down: 0, avgPing: 40 }] }));
});
before(async () => {
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  process.env.UPTIME_KUMA_URL = `http://127.0.0.1:${http.address().port}`;
  process.env.UPTIME_KUMA_USERNAME = "test";
  process.env.UPTIME_KUMA_PASSWORD = "test";
  delete process.env.UPTIME_KUMA_TOKEN;
});
after(async () => { await new Promise((resolve) => io.close(resolve)); });

test("notification list captures pushes before login acknowledgement and excludes credentials", async () => {
  assert.deepEqual(await client.listNotifications(), [{ id: 1, name: "Private", type: "webhook", active: true }]);
});
test("monitor list uses the pushed payload rather than expecting callback data", async () => {
  assert.deepEqual(await client.listMonitors(), monitors);
});
test("status pages normalize Kuma's object payload to an array", async () => {
  assert.deepEqual(await client.listStatusPages(), [{ id: 1, slug: "public", title: "Public", published: true }]);
});
test("token login also captures lists emitted before acknowledgement", async () => {
  process.env.UPTIME_KUMA_TOKEN = "fixture-token";
  try { assert.deepEqual(await client.listMonitors(), monitors); }
  finally { delete process.env.UPTIME_KUMA_TOKEN; }
});
test("subsequent calls reuse the login JWT instead of hitting the password-login limiter", async () => {
  const passwordsBefore = passwordLogins;
  const tokensBefore = tokenLogins;
  await client.listMonitors();
  await client.listMonitors();
  assert.ok(passwordLogins - passwordsBefore <= 1);
  assert.ok(tokenLogins > tokensBefore);
});
test("status uses real chart counters and weights ping by successful checks", async () => {
  const result = await client.getMonitorStatus(1, 24);
  assert.equal(result.uptime, 4 / 5);
  assert.equal(result.avgPing, 25);
});
test("status propagates server errors rather than reporting zero uptime", async () => {
  rejectChart = true;
  try { await assert.rejects(client.getMonitorStatus(999, 24), /Monitor not found/); }
  finally { rejectChart = false; }
});
test("no observations is unknown rather than zero uptime", async () => {
  emptyChart = true;
  try { assert.deepEqual(await client.getMonitorStatus(1), { uptime: null, avgPing: null }); }
  finally { emptyChart = false; }
});
test("get-monitor MCP output excludes monitor credentials", async () => {
  const mcp = new Client({ name: "credential-test", version: "1.0.0" });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, TRANSPORT: "stdio" }, stderr: "pipe" }));
    const result = await mcp.callTool({ name: "uptime_kuma_get_monitor", arguments: { monitor_id: 1, response_format: "json" } });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.id, 1);
    assert.doesNotMatch(JSON.stringify(result), /fixture-private|private-header|private-push-token/);
  } finally { await mcp.close(); }
});
test("failed authentication disconnects its socket", async () => {
  rejectLogin = true;
  try { await assert.rejects(client.getMonitor(1), /Invalid credentials/); }
  finally { rejectLogin = false; }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(connections, 0);
});
