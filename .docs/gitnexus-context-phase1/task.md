# Task List: GitNexus Context Fabric Phase 1

### Phase 0: Hotfix Release & Backup
- [x] Pull the latest `origin/master` change into local `master`
- [x] Confirm the commit scope excludes unrelated docs migration work
- [x] Bump `version.json` for the `/memories` patch release
- [x] Commit the `/memories` hotfix plus the new planning docs
- [x] Push the checkpoint to GitHub
- [ ] Build and push the refreshed `cortex-api` image
- [ ] Redeploy or wait for Watchtower, then verify `/memories`

### Phase 1: Dashboard API Resource Layer
- [ ] Audit which GitNexus resource endpoints are available from the installed GitNexus build
- [ ] Add normalized Dashboard API endpoints for project context, clusters, processes, process detail, and schema
- [ ] Reuse `projectId` to repo-candidate resolution for all new read-only routes
- [ ] Enrich responses with Cortex project metadata and index freshness data

### Phase 2: MCP Resource Surface
- [ ] Confirm the deployed MCP SDK/runtime supports first-class resources on the current transport
- [ ] Register `cortex://projects`
- [ ] Register `cortex://project/{projectId}/context`
- [ ] Register `cortex://project/{projectId}/clusters`
- [ ] Register `cortex://project/{projectId}/cluster/{clusterName}`
- [ ] Register `cortex://project/{projectId}/processes`
- [ ] Register `cortex://project/{projectId}/process/{processName}`
- [ ] Register `cortex://project/{projectId}/schema`
- [ ] Add read-only tool shims only if MCP resource support is blocked

### Phase 3: Prompt & Session Enrichment
- [ ] Add a `cortex_detect_impact` prompt wrapper
- [ ] Add a `cortex_generate_map` prompt wrapper
- [ ] Extend `cortex_session_start` to return top clusters, top processes, and suggested next steps
- [ ] Document the recommended agent workflow for discovery -> overview -> deep dive -> action

### Phase 4: Shared Cross-App Metadata
- [ ] Define the canonical metadata keys for files, symbols, processes, and clusters
- [ ] Extend session/change/quality payloads with the shared metadata fields
- [ ] Reuse the same metadata shape in memory and dashboard views where it fits

### Phase 5: Deferred Follow-Ups
- [ ] Design `cortex_code_rename` as preview-first, apply-second workflow
- [ ] Decide whether a visual graph explorer is still needed after resources and prompts are live
- [ ] If needed, scope a lightweight graph page around clusters and process traces instead of a full generic graph canvas
