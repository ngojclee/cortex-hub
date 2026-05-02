# Session Worker Report

Role: QA Integrator Worker
Session ID: 019dea28-eb74-7313-ad82-fd499df460ba
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project: cortex-hub
Branch: master
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Round: graph-runtime-lightweight-r2
Task IDs: T5 reviewing T1,T2,T3,T4
Status: NEEDS_PLANNER

## Summary

T1-T4 reports are present with the expected roster IDs. Build, typecheck, lint, focused graph-snapshot tests, and full test all pass. The old live graph node shape finding from r1 is resolved by frontend normalization (`name -> label`, `startLine/endLine -> lineStart/lineEnd`).

Integration is not merge-ready yet because two frontend/backend contract gaps remain in the lightweight graph runtime: the Explorer never sends `refresh=true`, so it cannot create the snapshots that the backend now requires for live graph data; and the frontend normalizer does not read the nested `data.snapshot` object that T2/T3 use for runtime metadata, so source/stale/age chips can be wrong.

## Findings

### P1 - Explorer cannot build graph snapshots

- Backend graph route is snapshot-first and returns empty data unless `refresh=true` or a matching snapshot exists: `apps/dashboard-api/src/routes/intel.ts` lines 2826-2892.
- Frontend client `getIntelProjectGraph()` has no `refresh` option and never appends `refresh=true`: `apps/dashboard-web/src/lib/api.ts` lines 777-800.
- Explorer search/expand calls only `mutate()` / updates focus, so those actions still call the snapshot-only URL: `apps/dashboard-web/src/components/intel/GraphExplorer.tsx` lines 475-487 and 656-660.
- Impact: on a fresh deploy or new query, `/graph` can remain empty with “No graph snapshot is cached…” even after user Search/Expand. Operators would need an external API call or MCP refresh to seed snapshots.
- Required fix: add an explicit user action/state that calls `getIntelProjectGraph(..., { refresh: true })`, or add a separate “Refresh Snapshot” button and wire search/expand semantics to planner-approved behavior.

### P2 - Frontend ignores nested snapshot metadata

- Backend returns runtime metadata under `data.snapshot`: `apps/dashboard-api/src/routes/intel.ts` lines 2854-2871 and 2895-2917.
- MCP tool handles both nested `data.snapshot.*` and flat fields, but frontend `normalizeIntelGraphSlice()` only reads flat `snapshotHit`, `snapshotAt`, `snapshotAgeSeconds`, `stale`, and `cache`: `apps/dashboard-web/src/lib/api.ts` lines 744-759.
- Impact: live/snapshot/stale/age UI chips can show “live slice” or omit stale/age even when backend returned a snapshot. This weakens the operator-facing perf/safety signal required by T4 acceptance.
- Required fix: extend `RawIntelGraphSlice` with `snapshot?: { snapshotHit, snapshotCreatedAt, snapshotAgeMs, stale, source, refresh, snapshotKey }` and normalize it into the existing UI fields.

## Files Changed

- `.docs/session_reports/graph-runtime-lightweight-r2/019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md` only.

## Commands Run

- `Get-Content STATE.md`
- `Get-Content .cortex/project-profile.json`
- `Get-Content .docs/session_team_plan.md`
- `Get-Content .docs/session_handoffs/graph-runtime-lightweight-r2/019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator.md`
- `Get-ChildItem .docs/session_reports/graph-runtime-lightweight-r2`
- `Get-Content` for T1-T4 worker reports
- `git status --short --branch`
- `git log --oneline --decorate --max-count=8`
- `git diff --name-status`
- `rg` focused contract/perf searches across graph runtime files
- `Get-Content` focused source reads for dashboard-api graph route, graph-snapshot service, frontend API/client, Explorer, MCP graph tools, `/live`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @cortex/dashboard-api test -- graph-snapshot`
- `pnpm test`

## Evidence

- `pnpm build`: PASS, 6/6 turbo tasks successful.
- `pnpm typecheck`: PASS, 9/9 turbo tasks successful.
- `pnpm lint`: PASS, 4/4 turbo tasks successful; existing Next lint deprecation/plugin warning only.
- `pnpm --filter @cortex/dashboard-api test -- graph-snapshot`: PASS, 2 tests.
- `pnpm test`: PASS, 6/6 turbo tasks successful; dashboard-api 4 tests pass.
- `/live` route exists and is dependency-light: `apps/dashboard-api/src/index.ts` lines 70-78.
- `listGitNexusRepos()` is registry-first unless `allowLiveFallback` is explicitly true: `apps/dashboard-api/src/routes/intel.ts` lines 723-733.
- `/resources/project/:projectId/context` gates live file count behind `refresh=true`: `apps/dashboard-api/src/routes/intel.ts` lines 2776-2813.

## Dependency Notes

- T1 Docs Runtime Runbook Worker: DONE; runbook/plan/task docs updated. No runtime risk found.
- T2 Backend Graph Runtime Worker: DONE; snapshot-first route and `/live` implemented; focused tests pass.
- T3 MCP Graph Tools Worker: DONE; MCP tools are snapshot-first by default and expose `refresh` opt-in.
- T4 Frontend Lightweight Explorer Worker: DONE by focused checks, but needs planner fix for refresh wiring and nested snapshot metadata normalization.

## Blockers

- Cortex MCP lifecycle tools were not exposed in this Codex toolset, so I could not call `cortex_session_start`, `cortex_detect_changes`, `cortex_quality_report`, `cortex_memory_store`, or `cortex_session_end`.
- No commits or pushes performed per handoff.

## Handoff

Planner should fix the two frontend integration gaps, then rerun:

```powershell
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Live perf smoke checklist after planner integration/deploy:

1. Call `/live` while GitNexus is degraded; expected: fast `200` with no dependency wait.
2. Open `/graph`; expected: no Architecture context/clusters/process/cross-link calls until `Load Architecture` is clicked.
3. Open Explorer on an indexed project without a snapshot; expected: default request returns empty/light response, clear “snapshot missing” state, no GitNexus CPU spike.
4. Click explicit refresh/search/expand path; expected: one bounded request with `refresh=true`, snapshot file created, caps enforced at small limits.
5. Reload same query; expected: `snapshotHit=true`, no live GitNexus query, stale/age/source chips reflect backend metadata.
6. Run MCP `cortex_graph_search` without refresh; expected: snapshot-first bounded response. Run with `refresh=true`; expected: one bounded refresh only.

Planner should now run `/w25-session-review-dispatch` after applying the two fixes.
