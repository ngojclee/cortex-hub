# Cortex Hub — Handoff Prompt for Next AI Agent

## Context
This prompt is a handoff from a previous Claude Code session that ran out of context. The previous agent was working on Phase 5D/5E/5F features, debugging auth/MCP/deployment issues, and syncing infrastructure config.

## Current State (as of 2026-04-06)

### Git State
- **Branch:** master
- **Latest commit:** `adcfb14` — "feat: polish settings branding and graph drill-down"
- **Version:** 0.4.25
- **Live server:** `http://10.21.1.108:4000` running v0.4.25, commit adcfb14
- **Public URL:** https://cortexhub.lengoc.me
- **Status:** `degraded` (mem9 in error state, everything else ok)

### Uncommitted Local Changes (need to be committed)
1. `apps/dashboard-api/src/middleware/auth.ts` — **CRITICAL FIX**: Added `/api/keys/verify` to auth middleware skip list. Without this, MCP connections fail when AUTH_ENABLED=true because hub-mcp's key verification call gets blocked by the dashboard auth middleware.
2. `apps/dashboard-api/package.json` — minor dependency addition
3. `.docs/plan.md`, `.docs/task.md` — updated phase tracking docs
4. `CLAUDE.md` — auto-MCP instructions update

### MCP Connection Issue (FOUND ROOT CAUSE)
**Problem:** MCP clients (Claude Code, etc.) cannot connect to `https://cortexhub.lengoc.me/mcp`
**Root cause:** When `AUTH_ENABLED=true`, the dashboard auth middleware (`apps/dashboard-api/src/middleware/auth.ts`) blocks `/api/keys/verify` because it's not in the skip list. The hub-mcp container calls `http://cortex-api:4000/api/keys/verify` to validate API keys, but gets 401 from the auth middleware instead.
**Fix:** Added `path === '/api/keys/verify'` to the auth skip conditions (line 26 in auth.ts).
**Status:** Fix is in local code but NOT deployed yet. Needs commit + push + rebuild + redeploy.

### Auth System
- AUTH_ENABLED=true on live server
- Telegram bot notifications working (bot: @luxeclaw_bot added to group)
- Login flow: email → Telegram approval → session cookie
- Cloudflare Access bypass added for `/api/*` routes
- Auth config confirmed: `{"enabled":true,"telegramConfigured":true}`

### Infrastructure
- Docker Compose synced between repo and server (infra/docker-compose.yml, infra/.env.example)
- Portainer stack deployment — requires Stop → Remove Containers → Deploy for env changes to take effect
- GitHub Actions auto-builds on push to master (workflow_dispatch also available)
- Watchtower auto-pulls new images (~5 min)

## Task List Status

### Completed in Previous Session
- [x] Phase 5D: Graph visual improvements (symbol context panel, impact analysis, upstream/downstream toggle, process detail drill-down, Cypher playground)
- [x] Phase 5E: Auth & session observability (AUTH_ENABLED wiring, Telegram notifications, dashboard logout, split Sessions page, MCP connection-source headers)
- [x] Phase 5F: MCP public discovery (fixed /.well-known/ to return public URL, forwarded x-forwarded-host/proto)
- [x] Docker Compose sync (infra/docker-compose.yml and infra/.env.example match server)
- [x] Telegram bot integration debug (bot needed to be added to group)

### Remaining Tasks (from task.md)
- [ ] **Deploy auth middleware fix** — commit + push the /api/keys/verify skip fix, rebuild, redeploy
- [ ] **Smoke-test MCP resources** from a real client session (Phase 2 release gate item)
- [ ] **Re-run indexing** after GitNexus registration fix and compare quality (Phase 5B item)
- [ ] **Redeploy and verify** /sessions shows active agent/API/MCP connections (Phase 5E item)
- [ ] **Redeploy and verify** /.well-known/oauth-protected-resource/mcp returns public URL (Phase 5F — code fix done, needs redeploy verification)
- [ ] **Verify external MCP client** reconnects and starts a visible work session (Phase 5F)
- [ ] **Decide** whether public /api/* routes should stay behind Cloudflare Access (Phase 5F)
- [ ] **Keep cortex_code_rename deferred** until resource/process contracts are stable (Phase 5D)

## What to Do Next (Priority Order)

### P0: Fix MCP Connection (IMMEDIATE)
1. Commit the auth middleware fix in `apps/dashboard-api/src/middleware/auth.ts`
2. Push to origin/master
3. Wait for GitHub Actions to build new Docker image (or trigger manually)
4. Redeploy cortex-api container (Stop → Remove → Deploy in Portainer, or docker compose up)
5. Verify MCP connection: `claude mcp get cortex-hub` should show "Connected"
6. Test with: `cortex_session_start` tool call

### P1: Deploy Phase 5F MCP Discovery Verification
After MCP is connected:
1. Run `curl https://cortexhub.lengoc.me/.well-known/oauth-protected-resource/mcp` — should return `https://cortexhub.lengoc.me/mcp`
2. Verify an external MCP client reconnects successfully
3. Check /sessions page shows the new work session

### P2: Phase 5B — Re-run Indexing
1. Re-index the cortex-hub project: `POST /api/projects/proj-44576c69/index`
2. Compare symbol/process/cluster quality before vs after
3. Check graph page shows meaningful clusters and processes

### P3: Phase 5D/5E Remaining Items
1. Verify /sessions page shows both dashboard login sessions AND agent/API/MCP work sessions
2. Decide on Cloudflare Access policy for /api/* routes
3. Keep cortex_code_rename deferred

## Key Files to Know

| File | Purpose |
|------|---------|
| `apps/dashboard-api/src/middleware/auth.ts` | Dashboard auth middleware — controls which routes require login |
| `apps/dashboard-api/src/routes/keys.ts` | API key CRUD + verify endpoint |
| `apps/hub-mcp/src/middleware/auth.ts` | MCP auth middleware — validates Bearer tokens via dashboard-api |
| `apps/hub-mcp/src/index.ts` | MCP server entry point |
| `apps/dashboard-api/src/index.ts` | Dashboard API entry point, route registration |
| `apps/dashboard-web/src/app/graph/page.tsx` | Graph explorer page (clusters, processes, symbol tree, Cypher) |
| `apps/dashboard-web/src/lib/api.ts` | Frontend API client with all endpoint functions |
| `infra/docker-compose.yml` | Docker Compose config (synced with server) |
| `infra/.env.example` | Environment variables template |
| `.docs/gitnexus-context-phase1/task.md` | Full task list with verification notes |
| `CLAUDE.md` | Agent instructions for cortex-hub project |

## Architecture Quick Reference

```
[Docker Network]
  cortex-api (:4000) ←→ hub-mcp (:8317)
       ↓                    ↓
  SQLite DB          MCP Streamable HTTP
  GitNexus (:4848)   (validates keys via cortex-api)
  Qdrant (:6333)     (serves MCP tools to clients)
  CLIProxy (:8320)

[External]
  Cloudflare → cortexhub.lengoc.me → cortex-api (:4000)
                                        ├── /api/*    → Dashboard API
                                        ├── /mcp      → Proxy to hub-mcp
                                        └── /*        → Static frontend
```

## API Key for MCP
The MCP server uses API key `sk_ctx_13c711af6dc554ec1410f57ecdfd234d28a57ff5df5a67fd3bc27b51485ab340` registered as a Bearer token. This key needs to be verified by `POST /api/keys/verify` on the dashboard-api — which is exactly what the auth middleware fix enables.

## Tech Stack
- Monorepo: pnpm + Turborepo, TypeScript strict
- Backend: Hono (dashboard-api, hub-mcp)
- Frontend: Next.js 15 (static export), React, SWR
- Database: SQLite (better-sqlite3)
- Vector DB: Qdrant (mem9 embeddings)
- Code Intelligence: GitNexus (eval-server, Cypher queries)
- Container: Docker Compose, Portainer stack
- CI/CD: GitHub Actions → GHCR → Watchtower auto-pull

## Quality Gates
Every session must end with:
```bash
pnpm build && pnpm typecheck && pnpm lint
```
Then call `cortex_quality_report` with results.
