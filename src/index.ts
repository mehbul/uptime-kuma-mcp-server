#!/usr/bin/env node
/**
 * uptime-kuma-mcp-server
 * MCP server for Uptime Kuma (louislam/uptime-kuma — 90k stars, MIT)
 * Exposes monitors, heartbeats, status pages, notifications via Socket.IO + REST.
 * No official MCP exists in parent org — this fills the gap.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { CHARACTER_LIMIT, ResponseFormat } from "./constants.js";
import * as client from "./services/uptime-kuma-client.js";

// ---------- helpers ----------
function formatMarkdownMonitors(monitors: Record<string, unknown> | unknown[], total?: number) {
  const list = Array.isArray(monitors) ? monitors : Object.values(monitors as Record<string, unknown>);
  if (!list.length) return "No monitors found.";
  const lines: string[] = [`# Uptime Kuma — Monitors (${total ?? list.length})`, ""];
  for (const m of list as Array<Record<string, unknown>>) {
    const statusMap: Record<number, string> = { 0: "DOWN", 1: "UP", 2: "PENDING", 3: "MAINTENANCE" };
    const status = typeof m.status === "number" ? statusMap[m.status] ?? String(m.status) : m.active === false ? "PAUSED" : "active";
    lines.push(`## ${m.name} (ID: ${m.id})`);
    lines.push(`- **Type**: ${m.type}${m.url ? ` — ${m.url}` : m.hostname ? ` — ${m.hostname}:${m.port}` : ""}`);
    lines.push(`- **Status**: ${status} — active: ${m.active}`);
    lines.push(`- **Interval**: ${m.interval}s`);
    if (m.description) lines.push(`- **Description**: ${m.description}`);
    lines.push("");
  }
  return lines.join("\n");
}

function truncateIfNeeded(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  const truncated = text.slice(0, CHARACTER_LIMIT) + `\n\n… truncated at ${CHARACTER_LIMIT} chars. Use pagination (limit/offset) or filters.`;
  return { text: truncated, truncated: true };
}

// ---------- server ----------
const server = new McpServer({
  name: "uptime-kuma-mcp-server",
  version: "1.0.0",
});

// ---------- Schemas ----------
const ListMonitorsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20).describe("Max monitors to return (1-100)"),
    offset: z.number().int().min(0).default(0).describe("Skip N monitors for pagination"),
    search: z.string().max(200).optional().describe("Filter by name/type substring (case-insensitive)"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json"),
  })
  .strict();

const GetMonitorSchema = z
  .object({
    monitor_id: z.number().int().min(1).describe("Monitor ID (integer)"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json"),
  })
  .strict();

const CreateMonitorSchema = z
  .object({
    name: z.string().min(1).max(200).describe("Monitor display name"),
    type: z.enum(["http", "port", "ping", "keyword", "dns", "push", "steam", "mqtt", "docker"]).default("http").describe("Monitor type"),
    url: z.string().url().optional().describe("URL for http/keyword monitors"),
    hostname: z.string().optional().describe("Hostname for port/ping/dns"),
    port: z.number().int().min(1).max(65535).optional().describe("Port for port monitors"),
    keyword: z.string().optional().describe("Keyword to search for (keyword type)"),
    interval: z.number().int().min(20).max(86400).default(60).describe("Check interval seconds (min 20)"),
    retryInterval: z.number().int().min(20).optional().describe("Retry interval seconds"),
    maxretries: z.number().int().min(0).max(10).optional().describe("Retries before down"),
    description: z.string().max(500).optional().describe("Optional description"),
    notificationIDList: z.record(z.boolean()).optional().describe("Map of notification ID → enabled"),
  })
  .strict();

const EditMonitorSchema = z
  .object({
    id: z.number().int().min(1).describe("Existing monitor ID"),
    name: z.string().min(1).max(200).optional().describe("New name"),
    url: z.string().url().optional().describe("New URL"),
    interval: z.number().int().min(20).max(86400).optional().describe("New interval"),
    active: z.boolean().optional().describe("Active/paused state"),
    description: z.string().max(500).optional().describe("Description"),
  })
  .strict();

const DeleteSchema = z.object({ monitor_id: z.number().int().min(1).describe("Monitor ID to delete") }).strict();
const PauseResumeSchema = z.object({ monitor_id: z.number().int().min(1).describe("Monitor ID") }).strict();

const GetHeartbeatsSchema = z
  .object({
    monitor_id: z.number().int().min(1).describe("Monitor ID"),
    period_hours: z.number().int().min(1).max(720).default(24).describe("Lookback period in hours (1-720)"),
    limit: z.number().int().min(1).max(200).default(50).describe("Max heartbeats to return"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json"),
  })
  .strict();

const GetStatusSchema = z
  .object({
    monitor_id: z.number().int().min(1).describe("Monitor ID"),
    period_hours: z.number().int().min(1).max(720).default(24).describe("Period for uptime calc"),
    response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json"),
  })
  .strict();

// ---------- Tools ----------

// 1. list monitors
server.registerTool(
  "uptime_kuma_list_monitors",
  {
    title: "List Uptime Kuma Monitors",
    description: `List monitors from Uptime Kuma with pagination and optional search.

Args:
- limit (1-100, default 20): max to return
- offset (default 0): skip N for pagination
- search (optional): filter name/type substring
- response_format: markdown (default) or json

Returns paginated list with has_more/next_offset.
Use when: "show my monitors", "list http monitors", "what do I monitor?"
Don't use when: you need single monitor details (use uptime_kuma_get_monitor).`,
    inputSchema: ListMonitorsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const raw = await client.listMonitors();
      let list = Object.values(raw as Record<string, unknown>) as Array<Record<string, unknown>>;
      const totalBefore = list.length;
      if (params.search) {
        const q = params.search.toLowerCase();
        list = list.filter((m) => String(m.name).toLowerCase().includes(q) || String(m.type).toLowerCase().includes(q) || String(m.url || "").toLowerCase().includes(q));
      }
      const total = list.length;
      const sliced = list.slice(params.offset, params.offset + params.limit);
      const has_more = total > params.offset + sliced.length;
      const output = {
        total: totalBefore,
        filtered_total: total,
        count: sliced.length,
        offset: params.offset,
        has_more,
        ...(has_more ? { next_offset: params.offset + sliced.length } : {}),
        monitors: sliced,
      };
      let text: string;
      if (params.response_format === ResponseFormat.JSON) text = JSON.stringify(output, null, 2);
      else {
        text = formatMarkdownMonitors(sliced as unknown as Record<string, unknown>, total);
        text += `\n\n— Pagination: ${sliced.length}/${total} (offset ${params.offset})${has_more ? ` — next_offset ${params.offset + sliced.length}` : ""}`;
      }
      const { text: t } = truncateIfNeeded(text);
      return { content: [{ type: "text", text: t }], structuredContent: output };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 2. get monitor
server.registerTool(
  "uptime_kuma_get_monitor",
  {
    title: "Get Uptime Kuma Monitor",
    description: `Get single monitor details by ID.

Args:
- monitor_id (int): ID from list_monitors
- response_format: markdown or json

Returns all fields (type, url, interval, status, tags).
Use when: need edit/delete/pause context.`,
    inputSchema: GetMonitorSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const m = await client.getMonitor(params.monitor_id);
      if (params.response_format === ResponseFormat.JSON) {
        return { content: [{ type: "text", text: JSON.stringify(m, null, 2) }], structuredContent: m as unknown as Record<string, unknown> };
      }
      const text = formatMarkdownMonitors({ [String(m.id)]: m } as unknown as Record<string, unknown>);
      return { content: [{ type: "text", text }], structuredContent: m as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 3. create monitor
server.registerTool(
  "uptime_kuma_create_monitor",
  {
    title: "Create Uptime Kuma Monitor",
    description: `Create a new monitor. Returns new monitorID.

Args:
- name (required): display name
- type: http|port|ping|keyword|dns|push|steam|mqtt|docker (default http)
- url/hostname/port/keyword as required by type
- interval (default 60, min 20)
- notificationIDList (optional): { "1": true }

Use when: "monitor https://example.com every 60s"
Don't use for edits (use edit_monitor).`,
    inputSchema: CreateMonitorSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (params) => {
    try {
      const payload: Record<string, unknown> = {
        name: params.name,
        type: params.type,
        interval: params.interval,
        active: true,
      };
      if (params.url) payload.url = params.url;
      if (params.hostname) payload.hostname = params.hostname;
      if (params.port) payload.port = params.port;
      if (params.keyword) payload.keyword = params.keyword;
      if (params.retryInterval) payload.retryInterval = params.retryInterval;
      if (params.maxretries !== undefined) payload.maxretries = params.maxretries;
      if (params.description) payload.description = params.description;
      if (params.notificationIDList) payload.notificationIDList = params.notificationIDList;
      // required defaults for http
      if (params.type === "http" && !payload.url) throw new Error("url is required for http monitors");
      if (params.type === "port" && (!payload.hostname || !payload.port)) throw new Error("hostname+port required for port monitors");

      const { monitorID } = await client.createMonitor(payload);
      const text = `Created monitor "${params.name}" (type=${params.type}) with ID ${monitorID}`;
      return { content: [{ type: "text", text }], structuredContent: { monitorID, name: params.name, type: params.type } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 4. edit monitor
server.registerTool(
  "uptime_kuma_edit_monitor",
  {
    title: "Edit Uptime Kuma Monitor",
    description: `Edit existing monitor. Only provided fields are updated.

Args:
- id (required): monitor ID
- name, url, interval, active, description (optional)

Use when: renaming, changing URL/interval.`,
    inputSchema: EditMonitorSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const existing = await client.getMonitor(params.id);
      const merged: Record<string, unknown> = { ...existing, ...params };
      // API expects `id` field
      await client.editMonitor(merged);
      return { content: [{ type: "text", text: `Updated monitor ${params.id}` }], structuredContent: { id: params.id, updated: true } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 5. delete
server.registerTool(
  "uptime_kuma_delete_monitor",
  {
    title: "Delete Uptime Kuma Monitor",
    description: `Delete a monitor and its heartbeat history (destructive).

Args:
- monitor_id (int)

Requires confirmation — this is irreversible.`,
    inputSchema: DeleteSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      await client.deleteMonitor(params.monitor_id);
      return { content: [{ type: "text", text: `Deleted monitor ${params.monitor_id}` }], structuredContent: { deleted: true, id: params.monitor_id } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 6. pause
server.registerTool(
  "uptime_kuma_pause_monitor",
  {
    title: "Pause Uptime Kuma Monitor",
    description: `Pause heartbeat checks for a monitor (sets active=false).

Args: monitor_id`,
    inputSchema: PauseResumeSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      await client.pauseMonitor(params.monitor_id);
      return { content: [{ type: "text", text: `Paused monitor ${params.monitor_id}` }], structuredContent: { id: params.monitor_id, paused: true } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 7. resume
server.registerTool(
  "uptime_kuma_resume_monitor",
  {
    title: "Resume Uptime Kuma Monitor",
    description: `Resume a paused monitor.

Args: monitor_id`,
    inputSchema: PauseResumeSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      await client.resumeMonitor(params.monitor_id);
      return { content: [{ type: "text", text: `Resumed monitor ${params.monitor_id}` }], structuredContent: { id: params.monitor_id, resumed: true } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 8. heartbeats
server.registerTool(
  "uptime_kuma_get_heartbeats",
  {
    title: "Get Uptime Kuma Heartbeats",
    description: `Get recent heartbeats for a monitor (status, ping, msg, time).

Args:
- monitor_id
- period_hours (1-720, default 24)
- limit (1-200, default 50)
- response_format

Returns newest-first list. Use when: "show recent checks for monitor 5", "why was it down?"`,
    inputSchema: GetHeartbeatsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const beats = await client.getMonitorBeats(params.monitor_id, params.period_hours);
      const sliced = beats.slice(-params.limit).reverse(); // newest first
      const output = { monitor_id: params.monitor_id, total: beats.length, count: sliced.length, heartbeats: sliced };
      let text: string;
      if (params.response_format === ResponseFormat.JSON) text = JSON.stringify(output, null, 2);
      else {
        const lines = [`# Heartbeats for monitor ${params.monitor_id} (last ${params.period_hours}h)`, `Total ${beats.length}, showing ${sliced.length}`, ""];
        for (const h of sliced) {
          const s = h.status === 1 ? "UP" : h.status === 0 ? "DOWN" : h.status === 3 ? "MAINT" : String(h.status);
          lines.push(`- **${s}** @ ${h.time} — ping ${h.ping ?? "-"}ms — ${h.msg || ""}`);
        }
        text = lines.join("\n");
      }
      const { text: t } = truncateIfNeeded(text);
      return { content: [{ type: "text", text: t }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 9. status
server.registerTool(
  "uptime_kuma_get_status",
  {
    title: "Get Uptime Kuma Monitor Status",
    description: `Get uptime ratio and avg ping for a monitor over a period.

Args:
- monitor_id
- period_hours (default 24)
- response_format

Returns: uptime (0-1), avgPing ms, computed from heartbeats if needed.`,
    inputSchema: GetStatusSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const { uptime, avgPing } = await client.getMonitorStatus(params.monitor_id, params.period_hours);
      const output = { monitor_id: params.monitor_id, period_hours: params.period_hours, uptime, uptime_percent: +(uptime * 100).toFixed(2), avgPing };
      let text: string;
      if (params.response_format === ResponseFormat.JSON) text = JSON.stringify(output, null, 2);
      else text = `# Status for monitor ${params.monitor_id} (${params.period_hours}h)\n- **Uptime**: ${(uptime * 100).toFixed(2)}% (${uptime.toFixed(4)})\n- **Avg ping**: ${avgPing !== null ? `${avgPing.toFixed(1)}ms` : "n/a"}`;
      return { content: [{ type: "text", text }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 10. notifications
server.registerTool(
  "uptime_kuma_list_notifications",
  {
    title: "List Uptime Kuma Notifications",
    description: `List notification channels (Slack, email, Telegram, etc.) configured in Uptime Kuma.

Returns id/name/type/active. Use when wiring monitor to notification.`,
    inputSchema: z.object({ response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json") }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const list = (await client.listNotifications()) as Array<Record<string, unknown>>;
      const output = { count: list.length, notifications: list };
      let text: string;
      if (params.response_format === ResponseFormat.JSON) text = JSON.stringify(output, null, 2);
      else {
        if (!list.length) text = "No notifications configured.";
        else {
          const lines = [`# Notifications (${list.length})`, ""];
          for (const n of list) {
            const cfg = (n.config as Record<string, unknown> | undefined);
            const t = (cfg?.type as string) || (n.type as string) || "unknown";
            lines.push(`- **${n.name}** (ID ${n.id}) — type ${t} — active ${n.active}`);
          }
          text = lines.join("\n");
        }
      }
      return { content: [{ type: "text", text }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 11. status pages
server.registerTool(
  "uptime_kuma_list_status_pages",
  {
    title: "List Uptime Kuma Status Pages",
    description: `List public status pages.

Returns id/slug/title/published.`,
    inputSchema: z.object({ response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("markdown or json") }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const list = (await client.listStatusPages()) as Array<Record<string, unknown>>;
      const output = { count: list.length, status_pages: list };
      let text: string;
      if (params.response_format === ResponseFormat.JSON) text = JSON.stringify(output, null, 2);
      else {
        if (!list.length) text = "No status pages.";
        else {
          const lines = [`# Status Pages (${list.length})`, ""];
          for (const p of list) lines.push(`- **${p.title}** (slug: ${p.slug}, ID ${p.id}) — published: ${p.published}`);
          text = lines.join("\n");
        }
      }
      return { content: [{ type: "text", text }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// 12. metrics (REST)
server.registerTool(
  "uptime_kuma_get_metrics",
  {
    title: "Get Uptime Kuma Prometheus Metrics",
    description: `Fetch Prometheus metrics from /metrics (requires UPTIME_KUMA_API_KEY or username/password).

Returns raw Prometheus exposition format. Useful for AI to parse monitor_status, monitor_response_time.

No params.`,
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const text = await client.getMetrics();
      const { text: t } = truncateIfNeeded(text);
      return { content: [{ type: "text", text: t }], structuredContent: { metrics: text.slice(0, 5000) } };
    } catch (e) {
      return { content: [{ type: "text", text: client.handleApiError(e) }], isError: true };
    }
  }
);

// ---------- transports ----------
async function runStdio() {
  const url = process.env.UPTIME_KUMA_URL;
  if (!url) {
    console.error("ERROR: UPTIME_KUMA_URL is required (e.g. http://localhost:3001)");
    process.exit(1);
  }
  if (!process.env.UPTIME_KUMA_USERNAME && !process.env.UPTIME_KUMA_TOKEN && !process.env.UPTIME_KUMA_API_KEY) {
    console.error("WARNING: No auth set — set UPTIME_KUMA_USERNAME+UPTIME_KUMA_PASSWORD or UPTIME_KUMA_TOKEN");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("uptime-kuma-mcp-server running via stdio");
}

async function runHTTP() {
  const url = process.env.UPTIME_KUMA_URL;
  if (!url) {
    console.error("ERROR: UPTIME_KUMA_URL is required");
    process.exit(1);
  }
  const app = express();
  app.use(express.json());

  // Health
  app.get("/health", (_req, res) => res.json({ status: "ok", server: "uptime-kuma-mcp-server" }));

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => console.error(`uptime-kuma-mcp-server HTTP on http://localhost:${port}/mcp`));
}

const transport = (process.env.TRANSPORT || "stdio").toLowerCase();
if (transport === "http" || transport === "streamable-http") {
  runHTTP().catch((e) => {
    console.error("HTTP server error:", e);
    process.exit(1);
  });
} else {
  runStdio().catch((e) => {
    console.error("stdio error:", e);
    process.exit(1);
  });
}
