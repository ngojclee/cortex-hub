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
  - Current progress: hub-centered orbit layout, symbol tree, focus mode, edge filters, breadcrumb, minimap
  - Next step: add analysis presets and stronger branch-level dependency drill-down
- Phase C: GitNexus rename + wiki tools (future)

### Database Project Normalization
- Add an operator-safe SQLite maintenance script for project linkage cleanup
- Normalize runtime `project_id` fields in `session_handoffs`, `query_logs`, and `quality_reports`
- Delete only orphan sessions that cannot be mapped to any valid project
- Create a backup automatically before any `UPDATE` / `DELETE`
- Apply the normalization against the live server DB when host access is available
