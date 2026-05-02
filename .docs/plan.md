# Plan: Cortex Hub Project Sync & Memories UI Integration

## 1. Context & Motivation
Currently, when Cortex MCP tools (`cortex_knowledge_store`, `cortex_memory_store`) are invoked, they take a `projectId` as an argument to tag the vector embeddings. However, this action does not automatically create a Project record inside the Dashboard's local SQLite database. Due to this discrepancy:
1. Projects appear as "0 Total Projects" in the Organizations UI despite data existing in Qdrant.
2. Semantic Memories (stored via `mem9`) lack a dedicated UI in the Dashboard to browse, view, and manage them.

## 2. Objectives
- Automatically link/create Project entities in SQLite whenever a new `projectId` is used via MCP tools.
- Implement a dedicated page in the Dashboard UI for humans to browse and manage the Semantic Memories stored in Qdrant.

## Phase 1: Database Setup & Auto-Registration Logic
**Goal:** Intercept `store` actions in Knowledge and Mem9 to ensure project existence.
- **Organization Check**: Verify the default "Personal" organization exists. If not, create it lazily.
- **Project Ensurer Helper**: Create a utility (e.g., `ensureProjectExists(projectId)`) in the Dashboard API.
  - Generates a UUID `proj-...` if the ID isn't already a UUID.
  - Adds the record to the `projects` table under the "Personal" org.
- **Implement Triggers**: 
  - Update `apps/dashboard-api/src/routes/knowledge.ts` (POST `/`)
  - Update `apps/dashboard-api/src/routes/mem9-proxy.ts` (POST `/store`)
  - Both should call `ensureProjectExists(projectId)` before sending the data to the downstream store.

## Phase 2: Backend API for Memories (Mem9 Proxy)
**Goal:** Expose endpoints for the UI to interact with Qdrant memories.
- **`GET /list`**: Route in `mem9-proxy.ts`. Initialize a `VectorStore` instance and call `.list({ must: [{ key: "project_id", match: { value: projectId } }] })` (scroll endpoint with filtering based on `projectId`).
- **`DELETE /:id`**: Route to delete a specific memory point from Qdrant by its UUID.
- **Sync existing logic**: Check if `shared-mem9`'s `VectorStore` fully exposes `delete` (yes, it does).

## Phase 3: Frontend UI (`/memories`)
**Goal:** Create a visual browser to read what agents have memorized.
- Add "Memories" to the main Navigation Sidebar (alongside Knowledge).
- Create `apps/dashboard-web/src/app/memories/page.tsx`.
- Design layout:
  - Top header: "Agent Memories" with a Project dropdown filter.
  - Content Body: Grid or list of memory cards showing memory content, date, agentId, and projectId.
  - Actions: Delete memory button for manual cleanup.
- Add `lib/api.ts` methods for `getMemories(projectId?)` and `deleteMemory(id)`.

## Phase 4: Build & Deployment (Testing Phase)
**Goal:** Build the Docker image, run the deployment update, and verify.
- Re-build the `cortex-hub` main mono-repo image.
- Push to GHCR (or just rely on Watchtower if GH Actions is setup; but since this is local testing, we'll run `docker build` or push via Git).
- Test opening the Dashboard:
  - Go to `/memories` -> verify list appears.
  - Use `cortex_memory_store` with a brand new `projectId` -> verify a new Project appears under `/orgs` instantly.

---

## Follow-On Phases

### GitNexus Context Fabric Phase 1 (Completed)
See [gitnexus-context-phase1/plan.md](gitnexus-context-phase1/plan.md)

### Multi-Project Organization & Agent Intelligence (Active)
See [multi-project-agent-intel/plan.md](multi-project-agent-intel/plan.md)
- Phase A: Register projects, clean knowledge (current)
- Phase B: AI-first graph explorer workspace
  - Destination: turn `/graph` into an analysis surface where humans and AI can isolate one branch, filter relationship semantics, keep navigation context, and read architecture slices without dropping into raw Cypher by default.
  - Current progress: hub-centered orbit layout, symbol tree, focus mode, edge filters, breadcrumb, minimap, analysis presets, branch drill-down, symbol-level canvas tracing, and richer SVG trace chains with click-to-trace recursion on canvas
  - Nearest destination: pin richer symbol branch tracing directly onto the main canvas so branch chains feel native to the graph, then tighten trace navigation polish before deploy/review
- Phase C: GitNexus rename + wiki tools (future)

### Database Project Normalization
- Add an operator-safe SQLite maintenance script for project linkage cleanup
- Normalize runtime `project_id` fields in `session_handoffs`, `query_logs`, and `quality_reports`
- Delete only orphan sessions that cannot be mapped to any valid project
- Create a backup automatically before any `UPDATE` / `DELETE`
- Apply the normalization against the live server DB when host access is available

---

## AI-First Graph Explorer + Caveman-Inspired Compaction

### Decision

Approved as one AI-context upgrade, not two disconnected features:

- Graph Explorer answers: which files, symbols, and edges should an agent inspect?
- Caveman-inspired compaction answers: how little context can Cortex send while preserving correctness?
- Humans see the same graph slice and raw/compact memory view agents use, so agent reasoning stays inspectable.

### Reference Sources

Local read-only references are cloned under `.references/` for implementation research:

- `.references/GitNexus` from `https://github.com/abhigyanpatwari/GitNexus`
- `.references/caveman` from `https://github.com/JuliusBrussee/caveman`

Use these as reference material only. Do not vendor or copy licensed code into Cortex without explicit review. GitNexus is PolyForm Noncommercial; caveman is MIT.

### Goals

1. Add AI-usable graph context primitives for MCP agents: search, bounded slices, file neighbors, and symbol briefs.
2. Add a GitNexus-style Explorer View beside the existing Architecture View for dense code graph inspection.
3. Reduce memory/search payload cost by returning compact agent-facing snippets while preserving full raw content for humans and audit.
4. Track token savings and retrieval quality so compaction can be enabled safely.

### Non-Goals

- Do not replace the current hub-centered Architecture View; it remains the high-level map.
- Do not build a purely visual graph that agents cannot call through MCP/tools.
- Do not replace raw memory/knowledge records with compact-only content.
- Do not use Classical Chinese / Wenyan compression as default until benchmarked for retrieval, debugging, and embedding quality.
- Do not fetch unbounded full graph data into the browser or MCP response by default.
- Do not copy GitNexus source code into Cortex because of license constraints.

### Track A: Graph Data API (AI First)

Add a bounded graph snapshot/slice endpoint:

`GET /api/intel/resources/project/:projectId/graph`

Query params:

- `nodeTypes`
- `edgeTypes`
- `focus`
- `depth`
- `community`
- `search`
- `limitNodes`
- `limitEdges`
- `format=json|ndjson`

Server responsibilities:

- Filter and cap before responding.
- Return `visibleCounts`, `totalCounts`, `truncated`, and `capReason` so UI and agents know when context is partial.
- Prefer GitNexus/Cypher-backed queries where needed; avoid browser-side full graph filtering as the default.
- Default AI slice: File, Class, Function, Method, Interface nodes; CALLS, IMPORTS, EXTENDS, IMPLEMENTS edges; depth 2; capped around 1,200 nodes and 5,000 edges.

### Track B: MCP Graph Tools

Expose the graph layer to agents through MCP tools/resources before or alongside the UI:

### Current MCP Readiness

Live MCP already covers most of the proposed agent ladder:

- Available now: `cortex_session_start`, `cortex_memory_search`, `cortex_knowledge_search`, `cortex_code_search`, `cortex_code_context`, `cortex_code_read`, `cortex_code_tree`, `cortex_code_impact`, `cortex_detect_changes`, `cortex_quality_report`, `cortex_memory_store`, `cortex_knowledge_store`, `cortex_session_end`.
- Still planned: `cortex_graph_search`, `cortex_graph_slice`, `cortex_file_neighbors`, `cortex_symbol_brief`.

Until the new graph tools exist, agents should use this fallback mapping:

| Desired step | Current tool fallback |
|--------------|-----------------------|
| `graph_search` | `cortex_code_search`, then `cortex_cypher` for direct graph queries |
| `graph_slice` | `cortex_code_tree` or focused `cortex_cypher` |
| `symbol_brief` | `cortex_code_context` plus `cortex_code_impact` when edit risk matters |
| `file_neighbors` | `cortex_code_tree`, `cortex_code_context`, or `cortex_cypher` by file path |

- `cortex_graph_search(projectId, query, nodeTypes?, limit?)` - find candidate symbols/files without reading code.
- `cortex_graph_slice(projectId, focus, depth?, edgeTypes?, nodeTypes?)` - return a bounded neighborhood for planning/editing.
- `cortex_file_neighbors(projectId, filePath, direction?, depth?)` - show imports/calls/related symbols around a file.
- `cortex_symbol_brief(projectId, symbol, includeRaw?)` - compact symbol context: file, line, callers, callees, impact, processes, related knowledge.

Agent workflow target:

```text
task -> graph_search -> graph_slice -> compact symbol/file brief -> read only necessary raw files -> edit -> impact/detect_changes
```

### Track C: Explorer View UI

Add a second graph mode under `/graph`:

- `Architecture View`: current cluster/process/knowledge map.
- `Explorer View`: dense raw code graph for symbol/file navigation.

Explorer UI patterns to implement:

- Top bar: project select, Ctrl/Cmd+K symbol search, visible/total node and edge counts, index status, layout status.
- Left filter rail: node types, edge types, focus depth, communities/status toggles.
- Canvas/WebGL renderer: `sigma.js` + `graphology` preferred candidate.
- Right inspector: selected node details, file path, line range, callers/callees, impact, context, and actions.
- Controls: zoom, fit, rerun/stop layout, clear selection, depth 1/2/3/5 hops.
- Visual semantics: color by node type or community, edge color by relationship, node size by degree/importance.

### Track D: Compact Memory Contract

Add a dual-content memory/knowledge contract:

- `raw_content`: original full text for humans, audit, evidence, and debugging.
- `compact_content`: English technical compact form for agent context.
- `facts`: short extracted facts/decisions where available.
- `embedding_text`: text chosen for embedding, initially compact content or facts.
- `compression`: metadata `{ mode, ratio, version, model, createdAt, preservedTokens }`.

Default compression mode should be `technical_full` or `technical_ultra`: terse English, preserve code identifiers, file paths, URLs, commands, stack traces, schemas, and numeric values. Add `wenyan_experimental` only as an opt-in research mode.

### Track E: Compaction Pipeline

Integrate compaction as a service boundary:

1. Add `apps/dashboard-api/src/services/content-compactor.ts` behind a feature flag.
2. Add preservation validation inspired by caveman-compress: code fences, inline code, URLs, file paths, commands, headings, versions, schemas, and numbers must survive.
3. Update mem9/knowledge store paths to save raw + compact metadata while remaining backward compatible.
4. Update memory/knowledge search so MCP/agent callers receive compact text by default, with explicit raw opt-in.
5. Update Memories/Knowledge UI to show full text by default with an `Agent compact` toggle and compression ratio.

### Track F: Token Evidence

Add telemetry for whether the AI-first flow actually helps:

- Raw tokens vs compact tokens.
- Full graph avoided vs graph slice returned.
- Files suggested by graph vs files actually read/edited.
- Search result quality and raw fallback frequency.

Surface this in the usage dashboard before enabling compaction broadly.

### Track G: Agent Workflow Guide

Create `.docs/guides/agent-cortex-workflow.md` as the canonical operator guide for agents and humans. It should document the standard ladder:

```text
session_start
-> memory_search + knowledge_search
-> project context resources
-> graph_search / graph_slice
-> symbol_brief / code_context
-> code_read only selected files
-> code_impact before edit
-> detect_changes + verify
-> quality_report
-> memory_store / knowledge_store
-> session_end
```

The guide must include:

- What each Cortex data layer is for: session, memory, knowledge, code graph, quality, `STATE.md`.
- How to avoid memory loss: what to store, when, and with which metadata.
- How to save tokens: resources first, graph slice second, compact memory/knowledge third, raw code last.
- Memory vs knowledge rules.
- What not to store: secrets, huge logs, raw large files, obvious source facts, temporary chatter.
- Required metadata: `projectId`, `branch`, `agentId`, `filesTouched`, `symbolsTouched`, `processesAffected`, `clustersTouched`, `resourceUris`, `tags`.
- Current MCP fallback mapping until graph tools are implemented.

After the guide is stable, sync the short version into `AGENTS.md` and the onboarding/rules generator instead of editing generated `.cortex/agent-rules.md` directly.
### Optional: MCP Catalog Shrink

Evaluate a caveman-shrink-like transform for MCP tool/resource/prompt descriptions. Keep tool call inputs/outputs untouched. This is optional and disabled by default until measured, because the higher-value savings are memory/search payloads and graph slices.

### Acceptance Criteria

- MCP exposes graph search/slice/file-neighbor/symbol-brief tools or resources.
- Agents can plan from a bounded graph slice before reading raw files.
- Graph page exposes Architecture and Explorer modes.
- Explorer can search a symbol, render a bounded neighborhood, filter node/edge types, adjust depth, and show an inspector.
- Agent memory/knowledge search can return compact snippets without losing raw text.
- Dashboard Memories/Knowledge UI can toggle compact/full content.
- Compaction preserves code/path/URL/schema tokens and records compression metadata.
- Token telemetry shows raw vs compact and graph-slice savings.
- Full verify passes: `pnpm build`, `pnpm typecheck`, `pnpm lint`.

### Risks

- Over-compression may reduce retrieval quality or hide context needed for debugging.
- Wenyan-style compression may save tokens but hurt embedding/search consistency.
- Dense graph rendering can become slow if SVG is reused or API caps are missing.
- Graph tools may become UI-only unless MCP endpoints are delivered first.
- GitNexus reference license is not permissive for direct code reuse.

### Recommended Rollout

1. Implement graph slice API and MCP graph tools first, with server caps and tests.
2. Add compact symbol/file brief generation on top of graph slices.
3. Implement compaction metadata and UI toggle behind a feature flag.
4. Add compact retrieval for MCP memory/knowledge search; measure token reduction and raw fallback quality.
5. Add Explorer View using `sigma.js` + `graphology`, backed by the same bounded API.
6. Benchmark large repo behavior and tune defaults before enabling broadly.

---

## Graph Runtime Lightweight Round

Runbook: [.docs/guides/graph-runtime-lightweight.md](guides/graph-runtime-lightweight.md)

### Decision

GitNexus should act as the indexing/refresh engine, not the default realtime dependency for every `/graph` UI or MCP graph request. Dashboard API should serve graph reads from registry-first repo resolution, snapshots, and bounded caches. Live GitNexus fallback must be explicit and narrow.

### Runtime Rules

- Default graph reads use snapshot/cache/registry data before any live GitNexus call.
- Health checks and initial page loads must not run broad `list_repos` or `cypher` paths.
- `/api/intel/resources/project/:projectId/graph` remains the shared UI/MCP graph contract.
- Responses should expose `visibleCounts`, `totalCounts`, `truncated`, `capReason`, and snapshot metadata such as `snapshotHit`, `cacheHit`, `stale`, and `source`.
- Explorer UI should start empty/light, then use search-submit and click-to-expand slices.
- MCP graph tools should prefer bounded graph search/slice/briefs before raw code reads and should not force realtime full graph queries by default.

### Operator Scope

Operators should use preview-first cleanup for GitNexus alias drift and project metadata drift:

- `GET /api/intel/admin/gitnexus-audit`
- `POST /api/intel/admin/gitnexus-cleanup` with `mode=preview` before `mode=apply`
- `POST /api/intel/admin/project-cleanup` with `mode=preview` before `mode=apply`

Deployment verification should include health, resources, one narrow graph request, and observation that normal `/graph` browsing does not spike GitNexus CPU.
