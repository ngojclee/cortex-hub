# Task List: Cortex Hub Project Sync & Memories UI

### Phase 1: Database Setup & Auto-Registration Logic
- [x] Create `ensureProjectExists(projectId, projectName?)` helper in `apps/dashboard-api/src/db/utils.ts` (or equivalent location).
- [x] Implement query logic to select/insert "Personal" org if missing.
- [x] Implement query logic to select/insert `projectId` into `projects` table.
- [x] Update `knowledge.ts` (POST `/`) to invoke `ensureProjectExists`.
- [x] Update `mem9-proxy.ts` (POST `/store`) to invoke `ensureProjectExists`.

### Phase 2: Backend API for Memories
- [x] In `apps/dashboard-api/src/routes/mem9-proxy.ts`, add endpoint `GET /list` to retrieve memories from Qdrant.
- [x] In `apps/dashboard-api/src/routes/mem9-proxy.ts`, add endpoint `DELETE /:id` to remove a memory point.
- [x] Test the backend endpoints directly.

### Phase 3: Frontend UI (`/memories`)
- [x] Update `apps/dashboard-web/src/lib/api.ts` to include `getMemories` and `deleteMemory` wrapper functions.
- [x] Add "Memories" route to the sidebar (`apps/dashboard-web/src/components/layout/DashboardLayout.tsx` or wherever the nav is defined).
- [x] Create `apps/dashboard-web/src/app/memories/page.tsx` and its css file.
- [x] Implement memory cards showing `content`, `projectId`, `agentId`, and timestamps.
- [x] Implement project filter dropdown.
- [x] Implement delete button logic with confirmation.

### Phase 4: Build & Deployment
- [x] Commit changes to git and review any missed files.
- [x] Use `/workflow6` or manual script to build the Docker image and push to registry.
- [x] Update Portainer (or wait for Watchtower) to deploy the new image.
- [x] Verify Dashboard UI reflects new Projects and shows the Memories page.

---

### GitNexus Context Fabric Phase 1
- [x] **Completed** — See [.docs/gitnexus-context-phase1/task.md](gitnexus-context-phase1/task.md)
- Delivered: resource APIs, MCP resources/prompts, graph explorer, quality gates, health check tiering, GitNexus CLI Docker fix

### Multi-Project Organization & Agent Intelligence (Active)
- [ ] **Phase A: Registration & Knowledge Cleanup** — See [.docs/multi-project-agent-intel/task.md](multi-project-agent-intel/task.md)
- [x] 2026-04-07: Fixed Knowledge/Graph project normalization mismatch (`projectId` vs `project_id`, slug-backed filtering, discovery matching, project resource sorting)
- [x] 2026-04-07: Fixed auth boundary so machine-facing dashboard APIs can accept Bearer API keys instead of forcing dashboard session auth
- [~] **Phase B: Graph Explorer Enhancement** — orbit hub, symbol tree, focus mode, edge filters, breadcrumb, minimap, analysis presets, branch drill-down, symbol-level canvas tracing, richer SVG branch-chain overlay, click-to-trace recursion, and a native trace constellation layer in the main graph are delivered; next target is final UI debug polish after deploy/review
- [ ] **Phase C: GitNexus Tool Expansion** (future)

### Database Project Normalization (Pending Live Run)
- [x] Added SQLite audit/normalization script: `apps/dashboard-api/src/db/project-normalization.ts`
- [x] Added package command: `pnpm --filter @cortex/dashboard-api run db:project-normalize`
- [x] Added runbook: [.docs/database/project-normalization.md](database/project-normalization.md)
- [x] Added live data-quality SQL audit pack: [.docs/database/data-quality-audit.sql](database/data-quality-audit.sql)
- [x] Added MCP admin cleanup tools for knowledge/project listing and metadata repair
- [x] Added API key dashboard support for admin-capable MCP cleanup scopes/permissions so operators can mint cleanup keys without touching SQLite directly
- [x] Fixed admin project patch semantics so MCP cleanup can clear nullable fields (`gitRepoUrl`, `description`, `indexedAt`, `indexedSymbols`) without fallback bugs
- [x] Added GitNexus registry audit/cleanup apply flow for duplicate aliases and stale unmapped entries
- [x] Added project cleanup preview/apply flow to normalize umbrella/placeholder metadata and clear stale latest-index hints
- [ ] Run dry-run on live `cortex.db` and review findings
- [ ] Run `--apply` on live `cortex.db` after backup review

---

### Reference Repos For AI-First Graph Explorer + Compaction
- [x] Create `.references/` workspace folder for implementation references
- [x] Clone GitNexus reference repo: `.references/GitNexus`
- [x] Clone caveman reference repo: `.references/caveman`
- [x] Review GitNexus API/UI source for raw graph endpoint and browser rendering patterns
- [x] Review GitNexus license risk: use patterns only, do not copy implementation
- [ ] Review caveman-compress validation rules for preservation constraints
- [ ] Record final reference findings in `.docs/research_notes.md`

### Agent Cortex Workflow Guide (Planned)
- [x] Create `.docs/guides/agent-cortex-workflow.md`
- [x] Document the standard ladder: session_start -> memory/knowledge -> context resources -> graph slice -> code context/read -> impact -> detect/verify -> quality -> store -> session_end
- [x] Document current MCP availability and fallback mapping for planned graph tools
- [x] Add memory vs knowledge decision rules
- [x] Add what-to-store and what-not-to-store rubric
- [x] Add required metadata schema for stored memories/knowledge/quality reports
- [x] Add token-saving rules: resources first, graph slice second, compact snippets third, raw code last
- [x] Sync short guide into `AGENTS.md`
- [x] Update onboarding/rules generator so `.cortex/agent-rules.md` receives the guide automatically
- [ ] Update MCP response hints to suggest graph tools once implemented

### AI-First Graph Data API (Planned)
- [ ] Define bounded graph response contract: nodes, edges, visibleCounts, totalCounts, truncated, capReason
- [ ] Add query params: nodeTypes, edgeTypes, focus, depth, community, search, limitNodes, limitEdges, format
- [ ] Implement `GET /api/intel/resources/project/:projectId/graph` with server-side filters and caps
- [ ] Add default AI slice profile: File/Class/Function/Method/Interface + CALLS/IMPORTS/EXTENDS/IMPLEMENTS + depth 2
- [ ] Add optional NDJSON streaming for larger graph snapshots
- [ ] Add tests for caps, truncation metadata, search filtering, and unsupported project states

### Current MCP Coverage For Agent Ladder
- [x] Available: `cortex_session_start`
- [x] Available: `cortex_memory_search`, `cortex_knowledge_search`
- [x] Available: project context resources from `cortex_session_start` / Context Fabric
- [x] Available: `cortex_code_search`, `cortex_code_context`, `cortex_code_read`, `cortex_code_tree`, `cortex_cypher`
- [x] Available: `cortex_code_impact`, `cortex_detect_changes`
- [x] Available: `cortex_quality_report`, `cortex_memory_store`, `cortex_knowledge_store`, `cortex_session_end`
- [ ] Missing dedicated: `cortex_graph_search`
- [ ] Missing dedicated: `cortex_graph_slice`
- [ ] Missing dedicated: `cortex_file_neighbors`
- [ ] Missing dedicated: `cortex_symbol_brief`
- [ ] Current fallback before these tools exist: use `cortex_code_search` + `cortex_cypher` for graph search, `cortex_code_tree` for graph slice, `cortex_code_context` for symbol brief, and `cortex_code_impact` for edit risk.

### MCP Graph Tools (Planned)
- [ ] Add `cortex_graph_search(projectId, query, nodeTypes?, limit?)`
- [ ] Add `cortex_graph_slice(projectId, focus, depth?, edgeTypes?, nodeTypes?)`
- [ ] Add `cortex_file_neighbors(projectId, filePath, direction?, depth?)`
- [ ] Add `cortex_symbol_brief(projectId, symbol, includeRaw?)`
- [ ] Make graph tools return compact, bounded context suitable for agent planning before raw file reads
- [ ] Add usage hints so agents call graph tools before broad code reads
- [ ] Add tests for empty results, ambiguous symbols, stale indexes, and cap behavior

### Explorer View UI (Planned)
- [ ] Design `/graph` mode switch: Architecture View vs Explorer View
- [ ] Keep current D3/SVG Architecture View intact
- [ ] Add dependencies after package review: `sigma`, `graphology`, layout helpers
- [ ] Build Explorer canvas with search, counts, layout status, zoom/fit, and clear selection controls
- [ ] Add node type filters: Folder, File, Class, Function, Method, Variable, Interface, Import
- [ ] Add edge type filters: CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, ACCESSES
- [ ] Add focus depth controls: all, 1-hop, 2-hop, 3-hop, 5-hop
- [ ] Add right inspector: file path, line range, callers/callees, context, impact, tree actions
- [ ] Verify performance on large graph and responsive behavior

### Caveman-Inspired Memory + Knowledge Compaction (Planned)
- [ ] Define compact content contract: raw_content, compact_content, facts, embedding_text, compression metadata
- [ ] Add migration or backward-compatible payload shape for compact fields
- [ ] Implement `content-compactor` service in dashboard-api behind a feature flag
- [ ] Add safety validation: preserve code blocks, inline code, URLs, file paths, commands, schemas, versions, and numbers
- [ ] Add `technical_full` and `technical_ultra` modes; keep `wenyan_experimental` opt-in only
- [ ] Integrate compaction into `mem9-proxy` store path behind feature flag
- [ ] Integrate compaction into knowledge store/search where payload size matters
- [ ] Update memory/knowledge search response to prefer compact text for MCP/agent callers and preserve raw access
- [ ] Add dashboard Memories/Knowledge UI compact/full toggle and compression ratio
- [ ] Add tests for compact preservation, raw fallback, and backward compatibility
- [ ] Benchmark token savings and retrieval quality before enabling by default

### Token Evidence + Rollout Gates (Planned)
- [ ] Log raw tokens vs compact tokens for memory/knowledge search results
- [ ] Log graph full-size avoided vs bounded graph slice returned
- [ ] Track files suggested by graph tools vs files actually read/edited where available
- [ ] Add dashboard usage widgets for graph-slice savings and compaction savings
- [ ] Gate default enablement on passing retrieval quality checks and low raw fallback rate
- [ ] Run full verify: `pnpm build`, `pnpm typecheck`, `pnpm lint`
