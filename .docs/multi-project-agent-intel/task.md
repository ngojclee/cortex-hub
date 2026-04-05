# Task List: Multi-Project Organization & Agent Intelligence

## Phase A: Multi-Project Registration & Knowledge Cleanup
- [ ] Register LN-OMS project via POST /api/orgs/org-default/projects
- [ ] Trigger code indexing for LN-OMS via POST /api/projects/{id}/index?branch=main
- [ ] Wait for index completion, verify symbol count > 0
- [ ] Remove misplaced knowledge doc kdoc-6e0101e9 (GitNexus npm README)
- [ ] Verify knowledge scoping: cortex_knowledge_search with projectId filter
- [ ] Verify cortex_list_repos shows 2+ projects with symbol counts
- [ ] Verify cortex_session_start works with LN-OMS repo URL

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
