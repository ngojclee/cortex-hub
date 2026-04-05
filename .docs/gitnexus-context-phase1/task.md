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
- [ ] Design `cortex_code_rename` as preview-first, apply-second workflow
- [ ] Decide whether a visual graph explorer is still needed after resources and prompts are live
- [ ] If needed, scope a lightweight graph page around clusters and process traces instead of a full generic graph canvas

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
