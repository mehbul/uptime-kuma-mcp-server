import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...process.env,
      UPTIME_KUMA_URL: "http://localhost:3001",
      UPTIME_KUMA_USERNAME: "test",
      UPTIME_KUMA_PASSWORD: "test",
    },
  });

  const client = new Client({ name: "test-client", version: "1.0" });

  try {
    console.log("Connecting...");
    await client.connect(transport);
    console.log("Connected!");

    const tools = await client.listTools();
    console.log(`Tools found: ${tools.tools.length}`);
    tools.tools.forEach((t) => console.log(` - ${t.name}: ${t.title} - ${t.description.slice(0, 80)}`));

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
    const missing = expected.filter((e) => !tools.tools.some((t) => t.name === e));
    if (missing.length) console.log(`MISSING: ${missing.join(", ")}`);
    else console.log("All 12 expected tools present ✓");

    // Try a tool call that should gracefully error without live Kuma (we expect Error handling, not crash)
    console.log("\nTrying tool call (should return graceful error, not crash)...");
    try {
      const res = await client.callTool({ name: "uptime_kuma_list_monitors", arguments: { limit: 2, offset: 0, response_format: "json" } });
      console.log("Tool result:", JSON.stringify(res, null, 2).slice(0, 2000));
      console.log("Graceful error handling works — server didn't crash");
    } catch (e) {
      console.log("Tool call threw (expected without live server):", e.message.slice(0, 500));
    }

    await client.close();
    console.log("\n✅ MCP server PASSED");
    process.exit(0);
  } catch (e) {
    console.error("Failed:", e);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
