# Contributing to uptime-kuma-mcp-server

This MCP server is designed to be contributed upstream to `louislam/uptime-kuma` (90k stars, MIT). Below is the path we followed using `agent-reach` (gh CLI + Exa) and `mcp-builder`.

## How we found the gap
- `agent-reach doctor --json` verified `gh CLI` auth (`mehbul`) and `Exa via mcporter`
- `gh search repos "uptime-kuma mcp"` → only `DavidFuchs/mcp-uptime-kuma` (47 stars, 230 dl/week) — no `louislam` org official
- Exa `Uptime Kuma MCP official docs` → no official, only wiki Internal-API + DeepWiki REST/Socket.IO docs
- `gh api repos/louislam/uptime-kuma` → 90,788 stars, MIT, 793 issues — ideal visibility

## Local dev
```bash
npm install
npm run build
# test without live Kuma (tools/list + graceful error)
node test-mcp2.js
# inspect
npx @modelcontextprotocol/inspector node dist/index.js
```

With live Kuma:
```bash
export UPTIME_KUMA_URL=http://localhost:3001
export UPTIME_KUMA_USERNAME=admin
export UPTIME_KUMA_PASSWORD=secret
node dist/index.js  # stdio
TRANSPORT=http PORT=3000 node dist/index.js  # http → http://localhost:3000/mcp
```

## PR to upstream
Proposed location: `louislam/uptime-kuma` → `examples/mcp-server/` or new `louislam/uptime-kuma-mcp-server`

Template title: `feat: add official MCP server (12 tools, stdio + streamable HTTP)`

Body:
- Fills gap: no official MCP (<0.1% community)
- 12 curated tools (readOnly 7, create/update 4, destructive 1)
- Transports: Stdio + Streamable HTTP (stateless)
- Auth: reuse `login`/`loginByToken` (Socket.IO) — mirrors `src/mixins/socket.js`
- Includes `evaluation.xml` (10 QAs) per mcp-builder

## Code standards
- `registerTool` with Zod `.strict()`, annotations, markdown/json dual format, pagination, `CHARACTER_LIMIT=25000`
- `npm run build` must pass, no `any`, strict TS

## License
MIT — same as Uptime Kuma
