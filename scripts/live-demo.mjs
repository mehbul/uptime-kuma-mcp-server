// Run only against a disposable, loopback Kuma instance: this creates test data.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";

const url = process.env.KUMA_TEST_URL;
if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("Set KUMA_TEST_URL to a disposable loopback Kuma instance.");
}
const socket = io(url, { transports: ["websocket"], reconnection: false, timeout: 10000 });
const rpc = (event, ...args) => socket.timeout(15000).emitWithAck(event, ...args);
const username = "mcp-integration";
const password = process.env.KUMA_TEST_PASSWORD || `Test-${randomBytes(18).toString("hex")}!`;
let mcp;
let httpProcess;
const dns = createSocket("udp4");
dns.on("message", (query, remote) => {
  // Minimal loopback-only A-record fixture; no upstream DNS traffic.
  let end = 12;
  while (query[end]) end += query[end] + 1;
  end += 5;
  const header = Buffer.from([query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
  dns.send(Buffer.concat([header, query.subarray(12, end), answer]), remote.port, remote.address);
});
let pagesOnLogin = {};
socket.on("statusPageList", (pages) => { pagesOnLogin = pages; });
try {
  // Kuma registers its command handlers after an async initial sendInfo call.
  await new Promise((resolve, reject) => { socket.once("info", resolve); socket.once("connect_error", reject); });
  if (await rpc("needSetup")) {
    const result = await rpc("setup", username, password);
    assert.equal(result.ok, true, result.msg);
  }
  const login = await rpc("login", { username, password, token: "" });
  assert.equal(login.ok, true, login.msg);
  // Seed nonempty lists so array normalization and credential filtering are exercised.
  if (!Object.values(pagesOnLogin).some((p) => p.slug === "mcp-integration")) {
    assert.equal((await rpc("addStatusPage", "MCP integration", "mcp-integration")).ok, true);
  }
  const key = await rpc("addAPIKey", { name: "MCP integration", active: true, expires: null });
  assert.equal(key.ok, true, key.msg);
  mcp = new Client({ name: "kuma-live-demo", version: "1.0.0" });
  const env = { ...process.env, TRANSPORT: "stdio", UPTIME_KUMA_URL: url,
      UPTIME_KUMA_USERNAME: username, UPTIME_KUMA_PASSWORD: password,
      UPTIME_KUMA_TOKEN: "", UPTIME_KUMA_API_KEY: key.key };
  if (process.env.KUMA_MCP_TRANSPORT === "http") {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const token = randomBytes(24).toString("hex");
    httpProcess = spawn(process.execPath, ["dist/index.js"], {
      env: { ...env, TRANSPORT: "http", PORT: String(port), MCP_HTTP_TOKEN: token }, stdio: "ignore",
    });
    const endpoint = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${endpoint}/health`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, "HTTP MCP server started");
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  } else {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "pipe", env }));
  }
  console.log(`Transport: ${process.env.KUMA_MCP_TRANSPORT || "stdio"}`);
  const tools = await mcp.listTools();
  assert.equal(tools.tools.length, 12);
  console.log("PASS tools/list: 12 tools");
  async function call(suffix, args = {}) {
    const result = await mcp.callTool({ name: `uptime_kuma_${suffix}`, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    console.log(`PASS ${suffix}`);
    return result.structuredContent;
  }
  // HTTP target stays on this disposable instance; no external monitoring traffic.
  const created = await call("create_monitor", { name: "MCP disposable HTTP", type: "http", url: `${url}/api/entry-page` });
  const id = created.monitorID;
  const list = await call("list_monitors", { search: "MCP disposable", response_format: "json", limit: 1 });
  assert.equal(list.count, 1);
  const monitor = await call("get_monitor", { monitor_id: id, response_format: "json" });
  assert.equal(monitor.id, id);
  await call("edit_monitor", { id, name: "MCP renamed" });
  await call("pause_monitor", { monitor_id: id });
  await call("resume_monitor", { monitor_id: id });
  await call("get_heartbeats", { monitor_id: id, response_format: "json" });
  await call("get_status", { monitor_id: id, response_format: "json" });
  await call("list_notifications", { response_format: "json" });
  const pages = await call("list_status_pages", { response_format: "json" });
  assert.ok(pages.status_pages.some((p) => p.slug === "mcp-integration"));
  await call("get_metrics");
  await call("delete_monitor", { monitor_id: id });
  const missing = await mcp.callTool({ name: "uptime_kuma_get_monitor", arguments: { monitor_id: id } });
  assert.equal(missing.isError, true);
  console.log("PASS deleted monitor returns isError");
  await new Promise((resolve) => dns.bind(0, "127.0.0.1", resolve));
  const cases = [
    { type: "keyword", url: `${url}/api/entry-page`, keyword: "type" },
    { type: "port", hostname: "127.0.0.1", port: Number(new URL(url).port) },
    { type: "ping", hostname: "127.0.0.1" },
    { type: "dns", hostname: "mcp.test", port: dns.address().port, dns_resolve_type: "A", dns_resolve_server: "127.0.0.1" },
    { type: "push" },
  ];
  for (const config of cases) {
    const created = await call("create_monitor", { name: `MCP ${config.type}`, ...config });
    const id = created.monitorID;
    if (config.type === "push") {
      const response = await fetch(`${created.push_url}?status=up&msg=MCP-test&ping=7`);
      assert.equal((await response.json()).ok, true);
    }
    let up = false;
    let lastBeats;
    for (let attempt = 0; attempt < 30; attempt++) {
      lastBeats = await call("get_heartbeats", { monitor_id: id, response_format: "json", limit: 5 });
      if (lastBeats.heartbeats.some((b) => b.status === 1)) { up = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(up, `${config.type} must produce an UP heartbeat: ${JSON.stringify(lastBeats)}`);
    await call("edit_monitor", { id, active: false });
    assert.equal((await call("get_monitor", { monitor_id: id, response_format: "json" })).active, false);
    await call("edit_monitor", { id, active: true });
    assert.equal((await call("get_monitor", { monitor_id: id, response_format: "json" })).active, true);
    await call("delete_monitor", { monitor_id: id });
    console.log(`PASS ${config.type}: creation, UP heartbeat, edit active, deletion`);
  }
  await rpc("deleteAPIKey", key.keyID);
  console.log("PASS all 12 tools against real Uptime Kuma");
} finally {
  await mcp?.close();
  if (httpProcess && httpProcess.exitCode === null) {
    const exited = once(httpProcess, "exit");
    httpProcess.kill();
    await exited;
  }
  socket.disconnect();
  try { dns.close(); } catch {}
}
