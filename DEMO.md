# Reproducible MCP demo

The automated demo launches a fresh Uptime Kuma 2.5.7 backend with an isolated SQLite database and loopback port. It creates a disposable local account, status page, and metrics API key, then repeats this sequence over stdio and authenticated Streamable HTTP using the MCP SDK client:

1. Discover all 12 tools.
2. Create an HTTP monitor targeting the local test server.
3. Search for it, inspect it, rename it, pause it, and resume it.
4. Read its heartbeats and statistics.
5. List notification channels and the seeded status page.
6. Fetch authenticated Prometheus metrics.
7. Delete the monitor and confirm subsequent lookup returns `isError`.
8. Create keyword, port, ping, DNS and push monitors using loopback fixtures; require UP heartbeats, verify active-state edits, and delete them.
9. Enable 2FA on the disposable account, verify missing/invalid/reused-code rejection, fresh TOTP login, cached-JWT reuse and explicit-JWT login, then disable 2FA.

```powershell
$env:KUMA_TEST_SERVER_DIR = 'C:\path\to\installed-uptime-kuma-2.5.7'
npm run test:live
```

Expected output includes `PASS tools/list: 12 tools`, each tool name, and `PASS all 12 tools against real Uptime Kuma`. This is an executable API demo, not a recording of a human using an AI client.

## Human walkthrough before an upstream submission

Use a disposable Kuma instance, create a test account in its browser dashboard, and connect your preferred MCP client using the README configuration. Ask it to create a monitor for a local test URL, rename it, pause and resume it, inspect its checks, and delete it. Confirm each change in the Kuma dashboard. Also inspect the returned notification and monitor data for unexpected credential fields.

In HTTP mode, set `MCP_HTTP_TOKEN` and configure the same bearer token in the client. Confirm an unauthenticated request fails. Never use a production instance for the delete demonstration.

The contributor must personally review the code and perform this walkthrough before submitting generated work to upstream, as required by upstream's AGENTS.md.
