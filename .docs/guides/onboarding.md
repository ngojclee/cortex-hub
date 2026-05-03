# Onboarding Guide — Cortex Hub

> Get started with Cortex Hub in under 5 minutes.

---

## How It Works

Cortex Hub connects AI agents through a unified **MCP (Model Context Protocol)** endpoint. Agents authenticate with **Bearer API keys**, and all LLM calls route through CLIProxy (multi-provider gateway with OAuth support).

```
AI Agent → MCP Server (Bearer token) → Dashboard API → Backend Services
                                          ├── Qdrant (vectors)
                                          ├── GitNexus (code intelligence)
                                          ├── mem9 (agent memory)
                                          └── CLIProxy → OpenAI/Gemini/Claude
```

---

## First-Time Setup (Admin)

### 1. Open Cortex Hub Dashboard

Navigate to the private LAN/NetBird dashboard first: **http://10.21.1.108:4000**

Use **https://cortexhub.lengoc.me** only as a controlled public fallback.

The **Setup Wizard** launches automatically on first visit — configure your LLM provider (OAuth or API key).

### 2. Create Organization & Projects

```
Organization: MyTeam
├── Project: main-app
├── Project: api-service
└── Project: docs
```

### 3. Generate API Keys

Go to **Settings → API Keys → Generate New**:

| Field | Example |
|-------|---------|
| Name | `agent-claude-prod` |
| Scope | Organization: MyTeam |
| Permissions | code.search, memory.store, knowledge.* |
| Expires | 90 days |

Copy the key — it won't be shown again.

---

## Team Member Setup

### 1. Clone & Run Bootstrap

```bash
git clone https://github.com/lktiep/cortex-hub.git
cd cortex-hub
bash scripts/bootstrap.sh
# Select: "2) Member"
```

The script will prompt for:
- **MCP URL** (default private: `http://10.21.1.108:4000/mcp`; public fallback: `https://cortexhub.lengoc.me/mcp`)
- **API Key** (get from your Hub admin or Dashboard → API Keys)

### 2. Onboard Your AI Agent

```bash
bash scripts/onboard.sh
```

This auto-detects your IDE (Claude Code, Cursor, Windsurf, VS Code) and:
- Injects MCP server config
- Generates `lefthook.yml` (quality gates)
- Creates `.cortex/project-profile.json`
- Sets up post-push webhook

### 3. Verify Connection

```bash
curl -s -X POST 'http://10.21.1.108:4000/mcp' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_KEY' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -100
```

You should see a list of Cortex tools.

### 4. Connect Your Agent Config

For **Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "cortex-hub": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://10.21.1.108:4000/mcp", "--header", "Authorization: Bearer YOUR_KEY"]
    }
  }
}
```

For other tools, `onboard.sh` handles this automatically.

---

## Infrastructure Endpoints

| Service | URL | Port |
|---------|-----|------|
| Dashboard | http://10.21.1.108:4000 | 4000 |
| Public fallback | https://cortexhub.lengoc.me | 4000 |
| API | http://10.21.1.108:4000 | 4000 |
| MCP Server | http://10.21.1.108:4000/mcp | 4000 |
| LLM Proxy (internal) | http://llm-proxy:8317 | 8317 |
| GitNexus (internal) | http://gitnexus:4848 | 4848 |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `502 Bad Gateway` | Services not started — `docker compose up -d` |
| `401 Unauthorized` | API key invalid or expired — regenerate at Dashboard → API Keys |
| OAuth login fails | Check CLIProxy logs: `docker logs cortex-llm-proxy` |
| MCP tools not available | Verify onboard.sh completed — check agent MCP config |
| Post-push webhook not firing | Set `CORTEX_API_URL` env var, preferably to the LAN/NetBird URL (`http://10.21.1.108:4000`) |
