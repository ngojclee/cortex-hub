# Release Note: 0.4.9

## Scope
Close the next batch of operational gaps after the first graph/discovery rollout:
- make Quality Gates operational instead of empty
- reduce false-negative `/health` results
- improve generic cluster naming for the graph/resources layer
- document the deferred `cortex_code_rename` workflow

## Included Changes
- Dashboard/API/MCP quality reporting now supports manual 4-dimension scores
- `/quality` includes a `Quick Quality Report` composer for seeding the first real reports
- Health checks now accept service-specific healthy responses such as authenticated `cliproxy` probes
- Generic cluster labels now infer friendlier names from member files/symbols before surfacing in graph/resources
- Added the rename workflow design doc at `.docs/gitnexus-context-phase1/rename-workflow.md`
- Updated workflow docs and task tracking after the first live quality report was recorded

## Live Verification Already Completed
- `POST /api/quality/report` created a real report for `proj-44576c69`
- `GET /api/quality/summary` now returns non-empty scores and grades
- `GET /api/metrics/overview-v2` now shows `lastGrade=A`, `lastScore=96`, `reportsToday=1`
- `GET /api/quality/logs` preserves the shared metadata contract
- `GET /api/intel/resources/project/proj-44576c69/processes` now returns named processes
- `GET /api/intel/resources/project/proj-44576c69/clusters` is mostly named already; this release improves the remaining generic clusters

## Images To Rebuild
- Required: `cortex-api`
- Optional: `cortex-mcp` only if you also want the latest MCP-side quality tool schema in the same deploy
- Not required: `cortex-gitnexus`

## Verification After Deploy
- `/health` should show `version: 0.4.9`
- `/quality` should show at least one report and no longer sit in the empty state
- `/graph` should show friendlier labels for previously generic clusters
- `GET /api/intel/resources/project/proj-44576c69/clusters` should no longer foreground raw `Cluster_*` names where inference is possible

## Remaining Open Work After 0.4.9
- verify native GitNexus CLI indexing on Docker so jobs stop falling back to pure JS extraction
- re-run indexing and compare quality before/after
- smoke-test MCP resources from a real client session
- keep `cortex_code_rename` deferred until data contracts are fully stable
