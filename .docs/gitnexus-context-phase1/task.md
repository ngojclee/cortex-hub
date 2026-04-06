# Task List: GitNexus Context Fabric Phase 1

### Phase 0: Hotfix Release & Backup
- [x] Pull the latest `origin/master` change into local `master`
- [x] Confirm the commit scope excludes unrelated docs migration work
- [x] Bump `version.json` for the `/memories` patch release
- [x] Commit the `/memories` hotfix plus the new planning docs
- [x] Push the checkpoint to GitHub
- [x] Build and push the refreshed `cortex-api` image
- [x] Redeploy or wait for Watchtower, then verify `/memories`

### Phase 1: Dashboard API Resource Layer
- [x] Audit which GitNexus resource endpoints are available from the installed GitNexus build
- [x] Add normalized Dashboard API endpoints for project context, clusters, processes, process detail, and schema
- [x] Reuse `projectId` to repo-candidate resolution for all new read-only routes
- [x] Enrich responses with Cortex project metadata and index freshness data

### Phase 2: MCP Resource Surface
- [x] Confirm the current MCP SDK/runtime supports first-class resources on the current transport
- [x] Register `cortex://projects`
- [x] Register `cortex://project/{projectId}/context`
- [x] Register `cortex://project/{projectId}/clusters`
- [x] Register `cortex://project/{projectId}/cluster/{clusterName}`
- [x] Register `cortex://project/{projectId}/processes`
- [x] Register `cortex://project/{projectId}/process/{processName}`
- [x] Register `cortex://project/{projectId}/schema`
- [x] Add read-only tool shims only if MCP resource support is blocked (`not needed`; native resources compiled successfully)

### Release Gate Before Phase 3
- [x] Commit and push the local `Memories` UI/data-shape fix so the dashboard renders stored memory content clearly
- [x] Rebuild and redeploy `cortex-api` so the new `Memories` page and `mem9` filter compatibility are live
- [x] Commit and push the local GitNexus resource-layer changes in `dashboard-api` and `hub-mcp`
- [x] Rebuild and redeploy `cortex-mcp` so the new `cortex://project/...` resources are available to clients
- [ ] Smoke-test MCP resources from a real client session before starting prompt/session enrichment work
- [x] Keep the in-progress `docs/ -> .docs/` migration out of the release commit unless it is intentionally finalized in the same checkpoint

### Phase 3: Prompt & Session Enrichment
- [x] Add a `cortex_detect_impact` prompt wrapper
- [x] Add a `cortex_generate_map` prompt wrapper
- [x] Extend `cortex_session_start` to return top clusters, top processes, and suggested next steps
- [x] Document the recommended agent workflow for discovery -> overview -> deep dive -> action

### Phase 4: Shared Cross-App Metadata
- [x] Define the canonical metadata keys for files, symbols, processes, and clusters
- [x] Extend session/change/quality payloads with the shared metadata fields
- [x] Reuse the same metadata shape in memory and dashboard views where it fits

### Phase 5: Deferred Follow-Ups
- [x] Design `cortex_code_rename` as preview-first, apply-second workflow
- [x] Decide whether a visual graph explorer is still needed after resources and prompts are live
- [x] If needed, scope a lightweight graph page around clusters and process traces instead of a full generic graph canvas

### Phase 5A: Runtime Health & Release Verification
- [x] Re-check whether the earlier `/health` degraded mismatch still reproduces on the refreshed `0.4.4` host
- [x] Fix or narrow the health checks for `qdrant`, `cliproxy`, and `gitnexus` so operator status matches real behavior
- [x] Verify the deployed favicon asset resolves as an actual icon response instead of an HTML fallback
- [x] Extend release verification notes so frontend deploy status is checked alongside `dashboard-api`

### Phase 5B: GitNexus Registration & Native Indexing Quality
- [x] Restore the GitNexus CLI/native runtime so indexing no longer falls back to pure JS extraction
- [x] Re-register the linked `cortex-hub` project with GitNexus so `gitnexus.registered` returns `true` again
- [x] Improve cluster and process extraction so resource names stop collapsing to `unknown`
- [ ] Re-run indexing after the registration/runtime fix and compare symbol/process/cluster quality before vs after

### Phase 5C: Quality Gate Adoption
- [x] Make `cortex_quality_report` part of the normal phase-completion workflow
- [x] Add a dashboard-level quick report composer so operators can seed the first real quality report without waiting on MCP automation
- [x] Submit at least one real quality report for the linked `cortex-hub` project
- [x] Verify the dashboard overview card and `/quality` page stop showing the empty-state path once reports exist
- [x] Ensure the shared metadata contract is preserved in quality reports and related analytics

### Phase 5D: UX Follow-Ups After Data Quality Stabilizes
- [x] Re-evaluate the need for a visual graph explorer after process and cluster quality improves
- [x] If still needed, scope a lightweight graph/process explorer instead of a generic graph canvas
- [x] Refresh reused sessions so `mode` and session context update when `cortex_session_start` is called again
- [x] Add discovery surfacing for unlinked repos and knowledge-only project spaces so operators can promote them into real Cortex projects
- [x] Make the lightweight graph layout survive more branches than the original 4-node-per-side mockup
- [ ] Keep `cortex_code_rename` deferred until the resource and process contracts are stable

### Phase 5E: Auth & Session Observability
- [x] Confirm the live auth/login issue is runtime wiring (`/api/auth/config -> enabled=false`), not missing auth routes
- [x] Wire `AUTH_ENABLED`, `AUTH_SESSION_TTL_HOURS`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID` into `infra/docker-compose.yml`
- [x] Document the same auth envs in `infra/.env.example`
- [x] Add a visible dashboard logout control for approved auth sessions
- [x] Split the `Sessions` page so it shows both dashboard login sessions and agent/API/MCP work sessions
- [x] Standardize connection-source metadata for new sessions (`transport`, `clientApp`, `clientHost`, `clientUserAgent`, `clientIp`)
- [x] Forward connection-source headers from `hub-mcp` into `dashboard-api`
- [ ] Redeploy and verify live `/api/auth/config` flips to `enabled=true` when the host env is set correctly
- [ ] Redeploy and verify `/sessions` now shows the active agent/API/MCP connection(s) that were previously hidden behind the user-login empty state

## Verification Notes
- [x] 2026-04-05: `http://10.21.1.108:4000/health` reports version `0.2.39`, commit `7fae1cf`, all core services `ok`
- [x] 2026-04-05: `http://10.21.1.108:4000/api/mem9/list?limit=1` returns JSON successfully
- [x] 2026-04-05: `pnpm --filter @cortex/dashboard-api typecheck`
- [x] 2026-04-05: `pnpm --filter @cortex/hub-mcp typecheck`
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-web typecheck` after `Memories` UI/data-shape fix
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after `mem9` project-filter compatibility update
- [x] 2026-04-05: local `pnpm --filter @cortex/hub-mcp typecheck` after prompt wrappers and session context-fabric enrichment
- [x] 2026-04-05: local `pnpm --filter @cortex/shared-types build`
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after shared cross-app metadata contract
- [x] 2026-04-05: local `pnpm --filter @cortex/hub-mcp typecheck` after shared cross-app metadata contract
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-web typecheck` after shared metadata API type updates
- [x] 2026-04-05: `http://10.21.1.108:4000/health` reports version `0.4.1`, commit `fabbf01`, and all core services `ok`
- [x] 2026-04-05: deployed `http://10.21.1.108:4000/api/intel/resources/projects` returns `success=true` with `total=0` on the current clean instance
- [x] 2026-04-05: `http://10.21.1.108:4000/health` reports version `0.4.2`, commit `5c0a92d`, and all core services `ok` after the shared metadata release
- [x] 2026-04-05: deployed `http://10.21.1.108:4000/api/intel/repos` shows GitNexus has indexed `cortex-hub`, while `cortex://projects` remains empty because no Cortex project has been linked yet
- [x] 2026-04-05: deployed `POST /api/sessions/start` returns `project=null` and `sharedMetadata=null` for `https://github.com/ngojclee/cortex-hub.git` until the repo is linked to a Cortex project
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` and `pnpm --filter @cortex/dashboard-web typecheck` after adding live chat/embed routing tests in Providers and a Quality Gates empty-state hint
- [x] 2026-04-05: deployed `POST /api/llm/routing/test/chat` succeeds with `gemini-3.1-flash-lite-preview` and returns `OK`
- [x] 2026-04-05: deployed `POST /api/llm/routing/test/embedding` succeeds with `gemini-embedding-001` and returns a `3072`-dimension vector
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-web typecheck` after adding the Cortex Hub favicon asset
- [x] 2026-04-05: live project `proj-44576c69` created for `https://github.com/ngojclee/cortex-hub.git` under `org-default`
- [x] 2026-04-05: `GET /api/intel/resources/projects` now returns one linked Cortex project with GitNexus registration
- [x] 2026-04-05: `POST /api/projects/proj-44576c69/index` completed successfully with `141 files` and `2826 symbols`
- [x] 2026-04-05: `GET /api/intel/resources/project/proj-44576c69/context` now reports `branch=master`, `indexedAt=2026-04-05 14:24:40`, and `symbols=2826`
- [x] 2026-04-05: live `POST /api/llm/routing/test/chat` still succeeds while `/health` reports `degraded`, confirming a health/runtime parity gap
- [x] 2026-04-05: live `GET /api/intel/resources/projects` shows the linked project is fresh from Cortex indexing but `gitnexus.registered=false`
- [x] 2026-04-05: live index log for `proj-44576c69` reports `Using pure JS symbol extraction (gitnexus CLI not available)`
- [x] 2026-04-05: live dashboard HTML references `/icon.svg`, but direct `GET /icon.svg` currently returns HTML instead of a dedicated icon response
- [x] 2026-04-05: refreshed host now reports `/health=ok`, `version=0.4.4`, `commit=b99e2af`, and all core services `ok`
- [x] 2026-04-05: refreshed host serves `GET /icon.svg` as `image/svg+xml`, confirming the favicon release is live
- [x] 2026-04-05: refreshed host `GET /api/intel/resources/projects` shows `projectId=proj-44576c69`, `gitnexus.registered=true`, and `indexed=1`
- [x] 2026-04-05: refreshed host still shows stale intel-resource freshness based on the older `gitnexus.indexedAt`, so metadata reconciliation remains the next code fix
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after preparing the intel staleness reconciliation patch and native GitNexus CLI indexing path
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after refreshing reused session `mode/context`
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-web typecheck` after adding the lightweight `/graph` explorer and Sessions mode badges
- [x] 2026-04-05: local `pnpm --filter @cortex/hub-mcp typecheck` after widening `cortex_session_start` session-mode guidance to include `production`
- [x] 2026-04-05: live `POST /api/sessions/start` now refreshes the reused session to `mode=production` and updates `task_summary/context`
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after teaching intel Cypher parsing to read GitNexus markdown-table responses
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck` after adding project discovery resources and project-link promotion for orphan repos/knowledge spaces
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-web typecheck` after upgrading `/graph` with discovery cards, knowledge-aware stats, and orbit layout
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck`, `pnpm --filter @cortex/dashboard-web typecheck`, and `pnpm --filter @cortex/hub-mcp typecheck` after adding manual quality-report submission from the dashboard and dimension-score support in the API/MCP tool
- [x] 2026-04-05: live `POST /api/quality/report` wrote report `qr_1775412535381_97w20` for `proj-44576c69` with grade `A`, score `96`, and canonical `sharedMetadata`
- [x] 2026-04-05: live `GET /api/quality/summary` and `GET /api/metrics/overview-v2` now show non-empty quality stats (`lastGrade=A`, `lastScore=96`, `reportsToday=1`)
- [x] 2026-04-05: live `GET /api/quality/logs?limit=3` preserves the same shared metadata contract inside analytics/query logs
- [x] 2026-04-05: live `GET /api/intel/resources/project/proj-44576c69/processes` now returns named processes instead of collapsing to `unknown`, and `GET /api/intel/resources/project/proj-44576c69/clusters` now mostly returns named clusters
- [x] 2026-04-05: local `pnpm --filter @cortex/dashboard-api typecheck`, `pnpm --filter @cortex/dashboard-web typecheck`, and `pnpm --filter @cortex/hub-mcp typecheck` after adding generic-cluster label inference, health-check narrowing, and the rename workflow design doc
- [x] 2026-04-06: local `pnpm --filter @cortex/shared-types build` after extending the shared metadata contract with optional connection-source fields
- [x] 2026-04-06: local `pnpm --filter @cortex/dashboard-api typecheck`, `pnpm --filter @cortex/dashboard-web typecheck`, and `pnpm --filter @cortex/hub-mcp typecheck` after wiring auth envs, adding dashboard logout, splitting the Sessions page, and forwarding MCP connection-source metadata
