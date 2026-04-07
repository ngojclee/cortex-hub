# Plan: Multi-Project Organization & Agent Intelligence

## Context & Motivation

Cortex Hub currently has only **1 registered project** (cortex-hub) despite the user working across multiple codebases (LN-OMS, meThuy, LuxeClaw extensions). Knowledge base items are all scoped to `cortex-hub`, including a misplaced GitNexus npm README from `temp_scripts/`. The graph view shows real data but lacks interactive drill-down. Key GitNexus tools (rename, wiki) are not yet surfaced.

## Objectives

1. Register active projects so each has scoped code intelligence, knowledge, and memories
2. Clean up misplaced knowledge docs
3. Design interactive graph explorer for future release
4. Design GitNexus tool expansion (rename, wiki, symbol tree) for future release

## Architecture

```
org-default (LuxeClaw)
├── cortex-hub       [proj-44576c69]  ✅ exists — 2826 symbols, 155 files
├── ln-oms           [to create]      ❌ needs registration + indexing
├── methuy           [to create]      ❌ optional — if git repo available
└── (future projects as needed)
```

Each registered project gets:
- SQLite project record (organizations.ts)
- GitNexus code index (clusters, processes, symbols)
- mem9 embeddings (semantic code search)
- Auto-docs knowledge (from .docs/ and README files)
- Scoped memories and sessions

## Phase A: Multi-Project Registration & Knowledge Cleanup (THIS RELEASE)

No code changes required — all actions use existing API endpoints.

### A1: Register LN-OMS
- POST /api/orgs/org-default/projects
- Payload: `{ name: "LN-OMS", description: "Order Management System", gitRepoUrl: "..." }`

### A2: Index LN-OMS code
- POST /api/projects/{projectId}/index?branch=main
- Pipeline: clone → gitnexus analyze → JS fallback → mem9 embed → docs-knowledge-builder

### A3: Clean misplaced knowledge
- DELETE /api/knowledge/kdoc-6e0101e9 (GitNexus npm README from temp_scripts)

### A4: Verify scoping
- cortex_knowledge_search with projectId filters
- cortex_session_start with LN-OMS repo URL
- cortex_list_repos shows 2+ projects

## Phase B: Graph Explorer Enhancement (ACTIVE)

### B1: Backend — cluster members + cross-links APIs
- GET /api/intel/resources/project/:id/cluster/:name/members
- GET /api/intel/resources/project/:id/cross-links
- Both use GitNexus cypher queries

### B2: Frontend — detail sidebar panel
- Click cluster/process → slide-out panel with member files, symbols, callers/callees
- Uses existing cortex_code_context API shape

### B3: Frontend — inter-cluster edges
- SVG curved paths between cluster nodes based on cross_community processes
- Edge weight = number of shared processes

### B4: AI-first analysis workspace
- Keep the app as the visual hub and let architecture branches radiate on stable orbits
- Add branch focus mode so one selected slice can be read without graph noise
- Add edge-semantic filters shared by UI and backend traversal (`CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`, `ACCESSES`)
- Preserve navigation state with breadcrumb + minimap
- Add analysis presets so operators and AI can switch between overview, dependency lens, and type-system lens quickly

### Destination
Transform `/graph` from a pretty architecture overview into a working analysis surface that helps AI and humans answer:
1. Which branch matters right now?
2. Which relationships define that branch?
3. What sits before and after this symbol or process?
4. When do we still need raw Cypher, and when is the graph already enough?

## Phase C: GitNexus Tool Expansion (FUTURE RELEASE)

### C1: cortex_code_rename (preview-first workflow)
- Design doc: .docs/gitnexus-context-phase1/rename-workflow.md
- MCP tool + API endpoint → calls GitNexus rename with dryRun

### C2: cortex_wiki_generate
- Wraps `gitnexus wiki` CLI → stores result in knowledge base

### C3: Symbol dependency tree API
- GET /api/intel/resources/project/:id/symbol/:name/tree
- Recursive expansion of callers/callees via GitNexus context tool

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| LN-OMS is private repo — indexing may fail without token | Skip token for now; add via dashboard Settings if needed |
| Large repo may exhaust GitNexus heap | Heap capped at 768MB; pure JS fallback exists |
| Misplaced knowledge deletion is irreversible | Only deleting 1 doc (temp_scripts GitNexus README) — easily re-indexed |
| Phase B graph canvas adds complexity | Keep orbit layout as base; sidebar is additive only |
| GitNexus rename may not exist in eval-server | Check eval-server.js first; fallback to cypher + text search |

## Release Strategy

- Phase A: standalone release, no version bump needed (API calls only)
- Phase B: version bump, rebuild cortex-api + cortex-web
- Phase C: version bump, rebuild cortex-api + cortex-mcp
