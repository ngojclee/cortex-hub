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
- [ ] **Phase B: Graph Explorer Enhancement** (future)
- [ ] **Phase C: GitNexus Tool Expansion** (future)

### Database Project Normalization (Pending Live Run)
- [x] Added SQLite audit/normalization script: `apps/dashboard-api/src/db/project-normalization.ts`
- [x] Added package command: `pnpm --filter @cortex/dashboard-api run db:project-normalize`
- [x] Added runbook: [.docs/database/project-normalization.md](database/project-normalization.md)
- [ ] Run dry-run on live `cortex.db` and review findings
- [ ] Run `--apply` on live `cortex.db` after backup review
