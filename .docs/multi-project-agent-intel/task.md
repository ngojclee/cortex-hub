# Task List: Multi-Project Organization & Agent Intelligence

## Phase A: Multi-Project Registration & Knowledge Cleanup
- [x] Register LN-OMS project via session_start auto-create (proj-f9ebd495)
- [ ] Trigger code indexing for LN-OMS via POST /api/projects/{id}/index?branch=main
  - **BLOCKED**: cortex-api container DNS cannot resolve github.com
  - Added pre-flight DNS check in indexer.ts for better error messages
  - User needs to verify `dns: [8.8.8.8, 1.1.1.1]` is on `cortex-api` service in Portainer
- [ ] Wait for index completion, verify symbol count > 0
- [x] Remove misplaced knowledge doc kdoc-6e0101e9 (GitNexus npm README)
- [x] Fix knowledge scoping: re-stored LN-OMS Constitution with project_id: ln-oms
- [x] Store LN-OMS knowledge docs (Architecture, Tech Stack, Constitution, Bootstrap)
- [x] Verify cortex_knowledge_search with projectId=ln-oms filter returns scoped results
- [x] Verify cortex_session_start works with LN-OMS repo URL
- [ ] Verify cortex_list_repos shows 2+ projects with symbol counts (needs indexing)

## Code Improvements (committed but not yet deployed)
- [x] knowledge.ts PUT endpoint: added project_id update support
- [x] indexer.ts: added pre-flight DNS check with actionable error message
- [x] indexer.ts: added GIT_TERMINAL_PROMPT=0 to git clone env

## Phase B: Graph Explorer Enhancement (FUTURE)
- [ ] Add GET /api/intel/resources/project/:id/cluster/:name/members endpoint
- [ ] Add GET /api/intel/resources/project/:id/cross-links endpoint
- [ ] Add detail sidebar panel to graph page (click cluster → member list)
- [ ] Add inter-cluster edge rendering (SVG paths from cross-links data)
- [ ] Typecheck: pnpm --filter @cortex/dashboard-api typecheck
- [ ] Typecheck: pnpm --filter @cortex/dashboard-web typecheck

## Phase C: GitNexus Tool Expansion (FUTURE)
- [ ] Implement cortex_code_rename MCP tool (preview mode)
- [ ] Add POST /api/intel/rename-preview API endpoint
- [ ] Implement cortex_wiki_generate MCP tool
- [ ] Add POST /api/intel/wiki-generate API endpoint
- [ ] Add GET /api/intel/resources/project/:id/symbol/:name/tree endpoint
- [ ] Typecheck: pnpm --filter @cortex/hub-mcp typecheck

## Verification Notes
- LN-OMS project ID: `proj-f9ebd495`, slug: `ln-oms`
- Cortex-hub project ID: `proj-44576c69`, slug: `cortex-hub`
- Knowledge search filter uses slug (not UUID): `projectId=ln-oms`
- Knowledge docs for LN-OMS: kdoc-8f944278 (Architecture), kdoc-00ca71e7 (Tech Stack), kdoc-ba0fffee (Constitution), kdoc-aa6a88fc (Bootstrap)
- DNS error in container: "fatal: could not read Username for 'https://github.com': No such device or address"
- Portainer stack needs `dns: [8.8.8.8, 1.1.1.1]` on `cortex-api` service specifically
