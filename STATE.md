# Cortex Hub — Current State

> Auto-read by agents at session start. Update at session end.

## Active Phase
- **Phase:** 6 (Polish, docs, testing, GA release)
- **Gate Passed:** Gate 5 (Phase 5→6) on 2026-03-19

## Current Task — Dashboard Redesign + Identity Resolution
- [x] Auto-detect Git provider from repo URL in project creation (`d0b28ee`)
- [x] X-API-Key-Owner identity resolution: apiCall injects header, quality/session handlers use it (`d0b28ee`)
- [x] Dashboard redesign: hero bar, project overview cards, intelligence panels (`d8efdef`)
- [x] New `/api/metrics/overview-v2` endpoint: per-project GitNexus/Mem9 status (`d8efdef`)
- [x] LLM Telemetry: Track `compute_tokens` / `compute_model` from mem9-proxy back to `query_logs` via MCP `apiCall`, and expose via stats endpoints.
- [x] Knowledge + Graph normalization: accept `projectId`/`project_id`, normalize knowledge project refs to slug, improve discovery candidate matching, and sort project resources by indexing/branch readiness.
- [x] Graph data-quality hardening: classify umbrella/knowledge-only/placeholder projects, suppress false "fresh" repo status for non-indexable projects, and surface GitNexus alias drift in Graph UI.
- [x] MCP admin cleanup tools: list/update knowledge docs, list/update raw projects, and audit GitNexus alias drift via machine-facing admin routes.
- [x] API Keys UI now exposes admin-capable scope/permission presets so MCP cleanup tokens can be minted from the dashboard without manual DB edits.
- [x] Admin project patch now respects explicit `null` for nullable fields, so MCP cleanup can truly clear stale repo/index metadata.
- [x] GitNexus registry cleanup flow now supports preview/apply for alias dedupe and stale unmapped repo removal, backed by the shared `/root/.gitnexus/registry.json` volume.
- [x] Project cleanup flow now supports preview/apply for umbrella/placeholder normalization, including clearing stale `indexed_at` / `indexed_symbols` hints.
- [x] Build ✅ | Typecheck ✅ | Lint ✅ | Quality: A (100/100)

## Architecture — 2-Service Model
- **cortex-api** (port 4000): Dashboard API + Dashboard Web static files
- **cortex-mcp** (port 8317): MCP Gateway (standalone, calls cortex-api over Docker network)
- hub-mcp uses `DASHBOARD_API_URL=http://cortex-api:4000` for real HTTP calls

## MCP Server Status ✅
- **Endpoint:** `POST https://cortexhub.lengoc.me/mcp`
- **Auth:** Bearer token (`sk_ctx_...`)
- **12 tools operational:** session_start, session_end, changes, code_search, code_impact, code_reindex, memory_search, memory_store, knowledge_search, knowledge_store, quality_report, health
- **Transport:** Streamable HTTP (WebStandardStreamableHTTPServerTransport)
- **Identity:** X-API-Key-Owner header for server-resolved agent identity
- **Agent workflow:** session_start → code_search → implement → quality_report → memory_store → session_end

## In Progress
- [x] MCP auth + handler fix chain (5 bugs fixed in `3df37dd`)
- [x] Onboarding: `mcp-remote` + URL as-is + connection test
- [x] Uninstall script + bootstrap option
- [x] Lefthook YAML key fix
- [x] Mobile-Responsive UI (6 files, committed `56b8dbb`)
- [x] MCP Streamable HTTP transport fix (`6b0fbe4`)
- [x] MCP tool name fix: dot → underscore (`8e6e50b`)
- [x] Docker Node 24 + corepack upgrade (`dc963ad`)
- [x] Docker build fix: add python3/make/g++ to builder (`6bc87f7`)
- [x] mem0→mem9 migration + fix all MCP tools (`8ffb854`)
- [x] Docker build optimization: cache mounts + shared base + .dockerignore (`35848b5`)
- [x] session_start: real DB records + project context (`85e0fd7`)
- [x] cortex_code_reindex tool + project lookup route (`0c0c45a`)
- [x] Fix self-fetch deadlock: apiCall + setInternalFetch for in-memory routing (`bba043d`)
- [x] Service separation: split All-in-One into cortex-api + cortex-mcp
- [x] Agent workflow gaps: catch-all routing, continue.md path fix, onboard.sh env var
- [x] Fix onboard.ps1 syntax parsing bug in Windows PowerShell 5.1 (Removed UTF-8 characters misread as ANSI smart quotes, decoupled `} else {` to bypass LF Lexer bugs, fixed $null pipeline errors in Add-Member for empty configs, and corrected Antigravity config path to `.gemini/settings.json`)
- [x] Version display: Sidebar footer shows version badge, docker-compose build args
- [x] Auto-detect Git provider from repo URL in project creation form
- [x] X-API-Key-Owner identity resolution (api-call.ts → quality.ts/sessions)
- [x] Dashboard redesign: hero stats bar, project cards, intelligence panels
- [x] `/api/metrics/overview-v2` endpoint with per-project GitNexus/Mem9 status
- [x] mem9 API key resolution: read from provider_accounts DB as fallback
- [x] Global MCP Telemetry: intercept `tools/call` in `hub-mcp` and log to dashboard API (`query_logs`)
- [x] **Multi-Repo Code Intelligence** — GitNexus auto-discovery + multi-candidate repo routing (`fe1ff04`, `3f2e60c`, `b48c385`)
- [x] **Tool Usage Analytics** — token tracking (input_size/output_size), tool-analytics API, `cortex_tool_stats` MCP tool, and comprehensive Token Savings Dashboard (Global + Per Session) (`753eaeb`)
- [x] **Compliance Enforcement** — session compliance score (5-category grading on session_end) + MCP response hints injection (contextual reminders in every tool response) (`1be109a`)
- [x] **Cross-Project Intelligence Fixes** — P0: code_context file disambiguation auto-resolve via UID extraction, code_search fallback hints when 0 flows; P1: `cortex_list_repos` MCP tool + `/repos` enrichment with project mapping; P2: cypher schema hints, 4 new hint engine scenarios
- [x] **LLM Telemetry Optimization** — Extracted Mem9 token responses, propagated via MCP storage headers, updated `query_logs` & `usage_logs` bridging, rendering "Compute Cost" widgets in Usage Dashboard.

## Completed (Phase 6)
- [x] Dashboard API — 9 real routes (no stubs)
- [x] Dashboard Web — 8 pages, full-featured
- [x] LLM API Gateway (multi-provider fallback, budget, usage logging)
- [x] Usage page rewired to real `/api/usage` endpoints
- [x] GitNexus as standalone Docker service (eval-server HTTP API on :4848, indexing via clone → analyze → mem9 ingest)
- [x] **Multi-Repo GitNexus** — auto-discovers repos from shared `/app/data/repos/`, analyzes & registers them. 6/8 Yulgang repos loaded (2,569 Methods, 420 Classes in ChinaSource)
- [x] Branch-scoped knowledge (mem9 user_id namespacing, fallback chain)
- [x] MCP branch-aware tools (code.search/impact with branch param)
- [x] Universal Installation & Onboarding (bootstrap.sh → onboard.sh)
- [x] API Key Persistence (SQLite + SWR + permissions)
- [x] **Service Separation: cortex-api + cortex-mcp (2 containers)**
- [x] Providers page (multi-provider LLM config UI)
- [x] Mobile-Responsive Dashboard UI (hamburger sidebar, 3-tier breakpoints)

## Recent Decisions
- **Multi-repo routing:** `callGitNexusWithFallback()` tries slug → URL-derived → projectId → no-filter as cascading fallback when routing to GitNexus eval-server. All intel routes (search, impact, context, cypher, detect-changes) use this helper.
- **GitNexus auto-discovery:** Updated `gitnexus-entrypoint.sh` to scan `/app/data/repos/` for cloned repos and run `gitnexus analyze` on any not already registered in `~/.gitnexus/registry.json`.
- **Identity resolution:** `mcp-remote` drops Authorization header → workaround: apiCall() injects `X-API-Key-Owner` header from `env.API_KEY_OWNER`. Dashboard-api uses this as authoritative identity in quality reports + sessions.
- **Dashboard v2:** Single `/overview-v2` endpoint replaces multiple calls. Returns per-project GitNexus/Mem9 status, quality summary, knowledge stats.
- **Knowledge project refs:** `knowledge_documents.project_id` is normalized to project slug. API filters now accept either project ID or slug, and Knowledge UI uses slug-backed filtering for stable grouping.
- **Admin cleanup auth:** MCP cleanup tools are intentionally restricted to admin-capable API keys. The dashboard Keys page now exposes the required scopes/permissions (`admin`, `owner`, `system`, `write`, `full`, `admin:write`, `project:write`, `knowledge:write`) so operators can mint the right key from UI.
- **Live cleanup path:** dashboard-api and gitnexus share the same `gitnexus-data` volume, so cleanup mutations are applied by editing GitNexus `registry.json` from dashboard-api instead of needing a write-capable GitNexus tool.
- **Service separation:** dashboard-api and hub-mcp run as separate Docker services. hub-mcp calls dashboard-api via real HTTP.
- MCP handler uses `WebStandardStreamableHTTPServerTransport` (stateless, enableJsonResponse)
- Mobile responsive: hamburger toggle + backdrop overlay at ≤768px, CSS-only breakpoints at 3 tiers
- **Context auto-disambiguation:** When `code_context` returns disambiguation list AND `file` param is set, auto-extracts UID and retries
- **Hints engine evolution:** 4 new scenarios (code_search empty → suggest context/cypher, code_context → suggest list_repos, cypher → schema tips, list_repos → next steps)

## Quality Status
- Build ✅ | Typecheck ✅ | Lint ✅ (Verified 2026-03-24T14:17+07:00)
- Architecture: 2-service model (cortex-api + cortex-mcp)
- MCP: 17 tools, hub-mcp as standalone service (latest: cortex_list_repos + cross-project intelligence fixes)
- GitNexus: 6 repos indexed (cortex-hub + 5 Yulgang projects)
