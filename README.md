# uptime-kuma-mcp-server

MCP server for [Uptime Kuma](https://github.com/louislam/uptime-kuma) — 90k stars, MIT — a fancy self-hosted monitoring tool.

This is **Option 1** from the agent-reach research: the top open-source project with no official MCP in the parent org (only a 47-star community fork `DavidFuchs/mcp-uptime-kuma`). Built with the `mcp-builder` skill (Anthropic `anthropics/skills@mcp-builder`, 109K installs) following TypeScript best practices.

## Why this repo?
- 90,788 stars, 793 open issues — highly active, contributor-friendly
- No `louislam/uptime-kuma` official MCP — community gap <0.1% parent size
- Socket.IO primary API (real-time) + REST `/metrics` — perfect MCP surface
- Use case: `Claude: "what's down? pause monitors for deploy, create https check for new service"`

## Tools (12) — curated 19% of API surface

| Tool | Description | Annotations |
|---|---|---|
| `uptime_kuma_list_monitors` | List with pagination + search | readOnly |
| `uptime_kuma_get_monitor` | Get single monitor details | readOnly |
| `uptime_kuma_create_monitor` | Create (http/port/ping/keyword/dns/push…) | create |
| `uptime_kuma_edit_monitor` | Edit existing (merge) | update |
| `uptime_kuma_delete_monitor` | Delete (destructive) | destructive |
| `uptime_kuma_pause_monitor` | Pause checks | update |
| `uptime_kuma_resume_monitor` | Resume | update |
| `uptime_kuma_get_heartbeats` | Recent heartbeats (limit/period) | readOnly |
| `uptime_kuma_get_status` | Uptime % + avg ping | readOnly |
| `uptime_kuma_list_notifications` | Slack/email/etc channels | readOnly |
| `uptime_kuma_list_status_pages` | Public status pages | readOnly |
| `uptime_kuma_get_metrics` | Prometheus `/metrics` | readOnly |

All list tools support `limit/offset/search` pagination and `response_format: markdown|json`, `CHARACTER_LIMIT=25000` truncation.

## Quick start

### 1. Env
```bash
# required
export UPTIME_KUMA_URL=http://localhost:3001
# auth: either JWT token or username+password
export UPTIME_KUMA_TOKEN=eyJ...        # from login with Remember Me
# or
export UPTIME_KUMA_USERNAME=admin
export UPTIME_KUMA_PASSWORD=secret
export UPTIME_KUMA_TOTP=123456         # if 2FA enabled

# optional for /metrics REST
export UPTIME_KUMA_API_KEY=uk2_xxxx
export TRANSPORT=stdio   # or http
export PORT=3000
```

### 2. Install & build
```bash
npm install
npm run build
```

### 3. Run

**stdio (Claude Desktop / Cursor):**
```json
{
  "mcpServers": {
    "uptime-kuma": {
      "command": "node",
      "args": ["C:/Users/Mehbul Islam/uptime-kuma-mcp-server/dist/index.js"],
      "env": {
        "UPTIME_KUMA_URL": "http://localhost:3001",
        "UPTIME_KUMA_USERNAME": "admin",
        "UPTIME_KUMA_PASSWORD": "secret"
      }
    }
  }
}
```

**Streamable HTTP (remote):**
```bash
TRANSPORT=http PORT=3000 node dist/index.js
# → http://localhost:3000/mcp  + /health
```
Claude Code:
```bash
claude mcp add --transport http uptime-kuma http://localhost:3000/mcp
```

### 4. Test with Inspector
```bash
npm run inspect
# or
npx @modelcontextprotocol/inspector node dist/index.js
```

## Example prompts
- "List my down monitors"
- "Create an http monitor for https://example.com every 60s and notify via Slack"
- "Pause monitor 5 during maintenance, resume after"
- "Show last 50 heartbeats for monitor 3, why did it fail?"
- "What's the 24h uptime % for monitor 1?"
- "List my status pages"

## Architecture
- **Transport:** `StdioServerTransport` (local) + `StreamableHTTPServerTransport` (stateless, per-request, JSON)
- **Auth:** Socket.IO `login`/`loginByToken` flow (mirrors Vue frontend `src/mixins/socket.js`), REST Basic Auth for `/metrics`
- **Validation:** Zod `.strict()` with constraints, actionable errors
- **Pagination:** `has_more`/`next_offset`, respects limit

## Contributing upstream
This server is designed to be proposed to `louislam/uptime-kuma` as `examples/mcp-server` or standalone `louislam/uptime-kuma-mcp-server`. It improves on existing community (47 stars, 230 dl/week) with full pagination, markdown/json, 12 tools vs 5, and HTTP+stdio.

## License
MIT — same as Uptime Kuma.
