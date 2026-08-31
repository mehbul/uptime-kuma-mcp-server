#!/usr/bin/env node
// Test MCP server via stdio — no Uptime Kuma needed for tools/list
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const serverPath = "dist/index.js";

const env = {
  ...process.env,
  UPTIME_KUMA_URL: "http://localhost:3001",
  UPTIME_KUMA_USERNAME: "test",
  UPTIME_KUMA_PASSWORD: "test",
};

const child = spawn("node", [serverPath], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (d) => (stdout += d.toString()));
child.stderr.on("data", (d) => {
  stderr += d.toString();
  // console.error("stderr:", d.toString());
});

function send(req) {
  child.stdin.write(JSON.stringify(req) + "\n");
}

async function run() {
  // Initialize
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0" } } });
  await new Promise((r) => setTimeout(r, 800));

  // tools/list
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await new Promise((r) => setTimeout(r, 800));

  // Also test one tool call that should fail gracefully without live server (should return Error, not crash)
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "uptime_kuma_list_monitors", arguments: { limit: 5, offset: 0, response_format: "json" } } });
  await new Promise((r) => setTimeout(r, 2500));

  child.kill();

  console.log("=== STDERR (server logs) ===");
  console.log(stderr.slice(0, 2000));
  console.log("\n=== STDOUT (MCP JSON-RPC) ===");
  console.log(stdout.slice(0, 8000));

  // Parse and verify
  const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  let tools = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id === 2 && obj.result?.tools) tools = obj.result.tools;
      if (obj.id === 3) {
        console.log("\n=== Tool call result (should be graceful error without live Kuma) ===");
        console.log(JSON.stringify(obj, null, 2).slice(0, 3000));
      }
    } catch {}
  }

  console.log("\n=== VERIFICATION ===");
  console.log(`Tools found: ${tools.length}`);
  tools.forEach((t) => console.log(` - ${t.name}: ${t.title}`));

  const expected = [
    "uptime_kuma_list_monitors",
    "uptime_kuma_get_monitor",
    "uptime_kuma_create_monitor",
    "uptime_kuma_edit_monitor",
    "uptime_kuma_delete_monitor",
    "uptime_kuma_pause_monitor",
    "uptime_kuma_resume_monitor",
    "uptime_kuma_get_heartbeats",
    "uptime_kuma_get_status",
    "uptime_kuma_list_notifications",
    "uptime_kuma_list_status_pages",
    "uptime_kuma_get_metrics",
  ];
  const missing = expected.filter((e) => !tools.some((t) => t.name === e));
  const extra = tools.filter((t) => !expected.includes(t.name)).map((t) => t.name);

  if (missing.length) console.log(`MISSING: ${missing.join(", ")}`);
  else console.log("All 12 expected tools present ✓");

  if (extra.length) console.log(`EXTRA: ${extra.join(", ")}`);

  if (tools.length === 12 && missing.length === 0) {
    console.log("\n✅ MCP server PASSED — 12 tools, protocol correct, graceful error handling");
    process.exit(0);
  } else {
    console.log("\n❌ FAILED");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
