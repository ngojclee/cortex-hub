# Task List: Multi-Project Organization & Agent Intelligence

## Phase A: Multi-Project Registration & Knowledge Cleanup
- [x] Register LN-OMS project via session_start auto-create (proj-f9ebd495)
- [x] Trigger code indexing for LN-OMS via POST /api/projects/{id}/index?branch=main
  - **BLOCKED**: cortex-api container DNS cannot resolve github.com
  - Added pre-flight DNS check in indexer.ts for better error messages
  - User needs to verify `dns: [8.8.8.8, 1.1.1.1]` is on `cortex-api` service in Portainer
- [x] Wait for index completion, verify symbol count > 0 // Manually pulled, auto-indexed 3190 symbols
- [x] Remove misplaced knowledge doc kdoc-6e0101e9 (GitNexus npm README)
- [x] Fix knowledge scoping: re-stored LN-OMS Constitution with project_id: ln-oms
- [x] Store LN-OMS knowledge docs (Architecture, Tech Stack, Constitution, Bootstrap)
- [x] Verify cortex_knowledge_search with projectId=ln-oms filter returns scoped results
- [x] Verify cortex_session_start works with LN-OMS repo URL
- [x] Verify cortex_list_repos shows 2+ projects with symbol counts (needs indexing)

## Code Improvements (committed but not yet deployed)
- [x] knowledge.ts PUT endpoint: added project_id update support
- [x] indexer.ts: added pre-flight DNS check with actionable error message
- [x] indexer.ts: added GIT_TERMINAL_PROMPT=0 to git clone env

## Phase B: Graph Explorer Enhancement
- [x] Add GET /api/intel/resources/project/:id/cluster/:name/members endpoint
- [x] Add GET /api/intel/resources/project/:id/cross-links endpoint
- [x] Add detail sidebar panel to graph page (click cluster → member list)
- [x] Add inter-cluster edge rendering (SVG paths from cross-links data)
- [x] Convert graph layout to app-centered hub with orbiting branches
- [x] Add branch focus mode to dim unrelated graph regions
- [x] Add edge-semantic filters wired into symbol tree traversal
- [x] Add breadcrumb and minimap to preserve graph context
- [x] Add analysis presets for overview / dependency / type-system lenses
- [x] Deepen branch drill-down so selected slices expose before/after relationships more directly
- [x] Add symbol-level canvas emphasis so traced members/steps are highlighted directly on the graph
- [x] Add mini before/after chain overlay directly on the graph canvas for traced symbols
- [x] Typecheck: pnpm --filter @cortex/dashboard-api typecheck ✅
- [x] Typecheck: pnpm --filter @cortex/dashboard-web typecheck ✅

## Auth Boundary Fix
- [x] Allow machine-facing dashboard API routes to accept Bearer API keys in `dashboardAuth()`
- [x] Keep dashboard/browser session auth as the default for UI-facing routes
- [x] Return explicit `Invalid or expired API key` for machine clients instead of misclassifying API keys as expired sessions

## Phase C: GitNexus Tool Expansion
- [x] Implement cortex_code_rename MCP tool (preview mode)
- [x] Add POST /api/intel/rename API endpoint
- [x] Implement cortex_wiki_generate MCP tool
- [x] Add POST /api/intel/wiki API endpoint
- [x] Add GET /api/intel/resources/project/:id/symbol/:name/tree endpoint
- [x] Implement cortex_code_tree MCP tool
- [x] Integrate Symbol Tree (Dependency Tree) into Graph Explorer (v0.3.2.0)
- [x] Typecheck: pnpm --filter @cortex/hub-mcp typecheck ✅
- [x] Typecheck: pnpm --filter @cortex/dashboard-api typecheck ✅
- [x] Typecheck: pnpm --filter @cortex/dashboard-web typecheck ✅
- [x] Build: pnpm --filter @cortex/dashboard-api build ✅
- [x] Build: pnpm --filter @cortex/dashboard-web build ✅ (fixed ESLint errors: no-explicit-any, unused vars)

## Phase D: Session Management UI (PLANNED)
- [ ] Add GET /api/auth/sessions → list all active sessions with email, IP, user-agent, created_at
- [ ] Add DELETE /api/auth/sessions/:id → revoke specific session
- [ ] Add DELETE /api/auth/sessions → revoke all sessions (admin panic button)
- [ ] Create /sessions page in dashboard-web with session list, revoke buttons
- [ ] Add session expiry display and auto-cleanup logic

## Verification Notes
- LN-OMS project ID: `proj-f9ebd495`, slug: `ln-oms`
- Cortex-hub project ID: `proj-44576c69`, slug: `cortex-hub`
- Knowledge search filter uses slug (not UUID): `projectId=ln-oms`
- Git Auth Fix (v0.3.1.0):
  - Fixed "could not read Username" error in Project Settings > Test Connection.
  - Added global token fallback to connection test and branch listing.
  - Set `GIT_TERMINAL_PROMPT=0` to prevent interactive hangs in all services.
- Symbol Tree (v0.3.2.0):
  - Graph Explorer now includes a "Tree" action for every symbol in cluster sidebars.
  - Retreives and visualizes recursive dependency paths via GitNexus Cypher matching.
- Docker Build Fix (v0.3.2.0):
  - Fixed ESLint `no-explicit-any` error in SymbolTreeViewer.tsx (replaced `any` with proper interfaces).
  - Fixed `loadingTree` unused variable error by using it as loading indicator UI.
  - Fixed `totalCount` property error (does not exist on API response, used `members.length` instead).
  - Fixed non-null assertions (`projects[0]!`, `selectedCluster!`) with safe alternatives.
- DNS Note: Container needs `dns: [8.8.8.8, 1.1.1.1]` in Portainer config if repo host is unreachable.
