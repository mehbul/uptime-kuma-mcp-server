# Demo — End-to-End (Do Everything)

This file shows the full workflow executed via `find-skills` + `mcp-builder` + `agent-reach`.

## 1. Discovery (agent-reach)
```bash
agent-reach doctor --json
# github: warn but gh CLI authenticated (mehbul)
# exa_search: via mcporter
gh search repos "uptime-kuma mcp" --limit 5
# → DavidFuchs/mcp-uptime-kuma 47 stars — no louislam official
gh api repos/louislam/uptime-kuma --jq "{stars, license}"
# → {"stars":90788,"license":"MIT"}
mcporter call exa.web_search_exa --query "Uptime Kuma API documentation"
# → Socket.IO primary + REST /metrics, push
```

## 2. Skill Discovery (find-skills)
```bash
npx skills find mcp
# 1. anthropics/skills@mcp-builder 109K installs ✓ (official, trusted)
# 2. mcp-use/mcp-use@mcp-apps-builder 26.4K
# 3. github/awesome-copilot@typescript-mcp-server-generator 12K
npx skills add anthropics/skills@mcp-builder -g -y
```

## 3. MCP Build (mcp-builder 4 phases)
```bash
mkdir uptime-kuma-mcp-server && cd $_
# package.json, tsconfig.json, src/constants.ts, src/types.ts, src/services/uptime-kuma-client.ts, src/index.ts
npm install
npm run build  # tsc strict — 0 errors
```

Structure:
```
uptime-kuma-mcp-server/
├── src/index.ts (546 lines, 12 tools)
├── src/services/uptime-kuma-client.ts (Socket.IO login + REST)
├── src/constants.ts / src/types.ts
├── evaluation.xml (10 QAs)
├── test-mcp2.js (SDK Client test)
└── dist/ (built)
```

## 4. Test

### Stdio (MCP protocol, no live Kuma needed for tools/list)
```bash
node test-mcp2.js
# Connecting... Connected! Tools found: 12
# All 12 expected tools present ✓
# Tool call → isError:true "Socket connect_error: websocket error" (graceful)
# ✅ PASSED
```

### HTTP
```bash
TRANSPORT=http PORT=3456 node dist/index.js &
curl http://localhost:3456/health
# {"status":"ok","server":"uptime-kuma-mcp-server"}
```

### Build verification
```bash
npm run build  # BUILD_EXIT:0
npx tsc --noEmit --strict  # no output = strict ok
node --check dist/index.js  # ok
```

## 5. Evaluation (Phase 4)
See `evaluation.xml` — 10 independent, read-only, stable QAs:
- list monitors filtered, down count, uptime %, notification mapping, status pages, heartbeats, metrics, etc.
Run via harness:
```bash
pip install anthropic mcp
python scripts/evaluation.py -t stdio -c node -a dist/index.js -e UPTIME_KUMA_URL=http://localhost:3001 evaluation.xml
```

## 6. Git + Open Source
```bash
git init
git add .
git commit -m "feat: initial uptime-kuma-mcp-server — 12 tools, stdio+http, built with mcp-builder (find-skills)"
# Ready to push to github.com/<you>/uptime-kuma-mcp-server
# Then open PR to louislam/uptime-kuma as examples/mcp-server
```

See `CONTRIBUTING.md` for PR template.

## 7. Use with Claude Code / Desktop
Claude Code:
```bash
claude mcp add --transport stdio uptime-kuma -- node C:/Users/Mehbul\ Islam/uptime-kuma-mcp-server/dist/index.js
claude mcp add --transport http uptime-kuma http://localhost:3456/mcp
```

Claude Desktop `claude_desktop_config.json`:
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

Prompt examples:
- "List my down monitors"
- "Create http monitor for https://example.com every 60s"
- "Show last 50 heartbeats for monitor 3"

---
Done — full `find-skills` → `mcp-builder` → `uptime-kuma-mcp-server` → verified → git.
