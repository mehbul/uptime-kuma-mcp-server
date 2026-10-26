# Uptime Kuma MCP server

Connect an MCP client to an existing Uptime Kuma instance to inspect monitors, review checks, manage monitors, and read Prometheus metrics. This is an independent community integration; it is not an official Uptime Kuma component.

## Requirements and verification

Use Node.js 22 or newer. All 12 tools were exercised over both stdio and authenticated HTTP through an MCP client against a disposable Uptime Kuma **2.5.7** instance on Windows with Node.js 24.15.0. See [validation](docs/VALIDATION.md) and the [demo](DEMO.md). HTTP, keyword, TCP port, ping, DNS and push monitor lifecycles are live-tested. Steam, MQTT and Docker creation is not exposed; configure those in Kuma directly. Other Kuma versions need additional testing.

```sh
npm ci
npm test
```

## Connect over stdio

Build with `npm run build`, then add this configuration to your MCP client. Replace the path and credentials with your own values:

```json
{
  "mcpServers": {
    "uptime-kuma": {
      "command": "node",
      "args": ["/absolute/path/to/uptime-kuma-mcp-server/dist/index.js"],
      "env": {
        "UPTIME_KUMA_URL": "http://127.0.0.1:3001",
        "UPTIME_KUMA_USERNAME": "your-username",
        "UPTIME_KUMA_PASSWORD": "your-password"
      }
    }
  }
}
```

Alternatively set `UPTIME_KUMA_TOKEN` to a Kuma login JWT. `UPTIME_KUMA_API_KEY` is only for `/metrics`; it does not authenticate Socket.IO tools. Username/password login supports `UPTIME_KUMA_TOTP` when a fresh two-factor code is required. The first successful password/TOTP login caches its returned JWT in memory for later calls. A fresh process needs a new code or an explicit login JWT. Reusing a one-time code for another password login will not work.

## Local Streamable HTTP

HTTP mode requires a separate `MCP_HTTP_TOKEN`. It binds to **127.0.0.1** and accepts non-browser clients with `Authorization: Bearer <MCP_HTTP_TOKEN>`. It rejects browser Origin headers and unexpected Host headers. It is not a public hosting configuration.

PowerShell:

```powershell
$env:UPTIME_KUMA_URL = 'http://127.0.0.1:3001'
$env:UPTIME_KUMA_USERNAME = 'your-username'
$env:UPTIME_KUMA_PASSWORD = 'your-password'
$env:MCP_HTTP_TOKEN = 'replace-with-a-long-random-token'
$env:TRANSPORT = 'http'
$env:PORT = '3000'
node dist/index.js
```

Point your MCP client to `http://127.0.0.1:3000/mcp` with that bearer header. `/health` is an unauthenticated liveness endpoint; it does not check Kuma connectivity. Concurrent requests use independent MCP server instances.

## Tools

| Tool prefix: `uptime_kuma_` | Behavior |
|---|---|
| `list_monitors` | Search and paginate monitor configuration |
| `get_monitor` | Read one monitor without credential fields |
| `create_monitor` | Create an HTTP, keyword, port, ping, DNS or push monitor |
| `edit_monitor` | Merge provided fields; active changes invoke Kuma pause/resume |
| `delete_monitor` | Delete a monitor and its history |
| `pause_monitor` / `resume_monitor` | Stop/start monitoring |
| `get_heartbeats` | Recent checks, newest first |
| `get_status` | Successful-check ratio and weighted average ping from Kuma chart buckets |
| `list_notifications` | Channel ID, name, type and active state; credentials omitted |
| `list_status_pages` | Status-page configuration |
| `get_metrics` | Prometheus exposition from authenticated `/metrics` |

`list_monitors` supports `limit`, `offset`, and `search`. Read tools with a `response_format` parameter accept `markdown` or `json`. An API failure returns `isError: true`; status with no observations returns null instead of inventing 0% uptime. Status comes from Kuma's aggregate chart buckets, not a separately calculated wall-clock SLA.

Creating a push monitor returns its secret `push_url`; keep that URL private. DNS creation accepts `dns_resolve_type`, `dns_resolve_server`, and an optional resolver `port`.

Monitor credential fields are filtered, but names, URLs, descriptions, heartbeats and metrics can still contain private operational information. Only connect clients you trust. Write tools use your Kuma account's permissions; tool annotations do not enforce user approval.

## Development

```sh
npm test
```

To reproduce the live demo, install a separate Kuma 2.5.7 source checkout with `npm ci --omit=dev`. Then:

```powershell
$env:KUMA_TEST_SERVER_DIR = 'C:\path\to\uptime-kuma-2.5.7'
npm run test:live
```

The runner uses an ephemeral loopback port and a new temporary SQLite data directory, creates its own demo account, runs the tools, and stops the server. It does not connect to an existing deployment. Temporary test data is retained under the system temp directory for diagnosis.

See [contributing](CONTRIBUTING.md) for upstream discussion and review requirements.

## License

MIT. See [LICENSE](LICENSE).
