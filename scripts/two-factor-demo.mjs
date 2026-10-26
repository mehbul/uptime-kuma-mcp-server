import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { io } from "socket.io-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const url = process.env.KUMA_TEST_URL;
if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("A disposable loopback Kuma instance is required.");
const password = process.env.KUMA_TEST_PASSWORD;
if (!password) throw new Error("KUMA_TEST_PASSWORD is required");
const socket = io(url, { transports: ["websocket"], reconnection: false });
const rpc = (event, ...args) => socket.timeout(15000).emitWithAck(event, ...args);
const clients = [];
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function mcp(env = {}) {
  const client = new Client({ name: "two-factor-test", version: "1.0" });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "pipe",
    env: { ...process.env, TRANSPORT: "stdio", UPTIME_KUMA_URL: url, UPTIME_KUMA_USERNAME: "mcp-integration", UPTIME_KUMA_PASSWORD: password, UPTIME_KUMA_TOKEN: "", UPTIME_KUMA_TOTP: "", ...env } }));
  return client;
}
const list = (client) => client.callTool({ name: "uptime_kuma_list_monitors", arguments: { response_format: "json" } });
let enabled = false;
try {
  await new Promise((resolve, reject) => { socket.once("info", resolve); socket.once("connect_error", reject); });
  const login = await rpc("login", { username: "mcp-integration", password, token: "" });
  assert.equal(login.ok, true, login.msg);
  const setup = await rpc("prepare2FA", password);
  assert.equal(setup.ok, true, setup.msg);
  const secret = new URL(setup.uri).searchParams.get("secret");
  assert.equal((await rpc("save2FA", password)).ok, true);
  enabled = true;
  const noCode = await list(await mcp());
  assert.equal(noCode.isError, true);
  assert.match(JSON.stringify(noCode.content), /Two-factor code required/);
  console.log("PASS 2FA challenge gives actionable error");
  const code = totp(secret);
  const invalid = code === "000000" ? "111111" : "000000";
  assert.equal((await list(await mcp({ UPTIME_KUMA_TOTP: invalid }))).isError, true);
  console.log("PASS invalid 2FA code rejected");
  const usedCode = totp(secret);
  const authenticated = await mcp({ UPTIME_KUMA_TOTP: usedCode });
  assert.notEqual((await list(authenticated)).isError, true);
  assert.notEqual((await list(authenticated)).isError, true);
  console.log("PASS fresh TOTP login and subsequent cached-JWT call");
  assert.equal((await list(await mcp({ UPTIME_KUMA_TOTP: usedCode }))).isError, true);
  console.log("PASS reused one-time code rejected on a fresh login");
  assert.notEqual((await list(await mcp({ UPTIME_KUMA_TOKEN: login.token }))).isError, true);
  console.log("PASS explicit JWT login with 2FA enabled");
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  if (enabled) await rpc("disable2FA", password);
  socket.disconnect();
}
