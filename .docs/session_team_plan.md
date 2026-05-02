# Session Team Plan

Project: cortex-hub
Branch: master
Round: graph-runtime-lightweight-r2
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Updated: 2026-05-03 00:27:14 +02:00

## Goal

Make Cortex graph intelligence lightweight and production-safe without removing the useful AI/MCP graph capabilities.

Primary direction:

- GitNexus becomes the indexing/refresh engine, not a realtime render dependency for every UI/MCP graph request.
- Dashboard API serves graph UI/MCP through registry-first lookup, bounded cache/snapshot reads, and explicit GitNexus fallback only when needed.
- Explorer UI remains useful but default-light: no unbounded graph load, no heavy polling, click-to-expand by small slices.
- MCP graph tools keep enough context for agents to choose files/symbols before raw code reads.

## Current Repo Truth

- Branch master, tracking origin/master.
- Latest pushed commits:
  - c427fa fix: reduce default graph explorer load
  - 51e7496 fix: lazy load graph architecture resources
  - 156e53d fix: simplify graph explorer header
  - 9cd79a1 feat: add ai-first graph explorer and compaction
- Live issue: opening /graph can still pressure GitNexus through realtime Cypher/list_repos paths, causing CPU spikes and container health flapping.
- Compaction is not the CPU source; CONTENT_COMPACTION_ENABLED remains disabled by default.
- Local dirty/untracked noise exists: pps/hub-mcp/src/node.d.ts, .omx/, .references/. Workers must not revert or commit these unless assigned by planner.
- Planner will review, integrate, verify, commit, and push. Workers must not commit or push.

## Session Roster

| Role | Session ID | Command | Responsibility | Status |
| --- | --- | --- | --- | --- |
| Planner | 019dd96b-52ca-7902-9a0d-efcf13a892a5 | /w25-session-review-dispatch or $w25-session-review-dispatch | Coordinate, review reports, integrate, verify, commit, push. | ACTIVE |
| Docs Runtime Runbook Worker | 019dea25-3465-78b1-bb33-8befffc41957 | /w24-session-worker or $w24-session-worker | Document graph runtime design, rollout, alias cleanup, and operator guidance. | READY |
| Backend Graph Runtime Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | /w24-session-worker or $w24-session-worker | Implement dashboard-api graph runtime optimizations: registry-first lookup, snapshot/cache, health split. | READY |
| MCP Graph Tools Worker | 019dea26-c9f7-75a0-a653-c315229901ce | /w24-session-worker or $w24-session-worker | Adapt MCP graph tools to snapshot-first bounded contracts and safe fallback semantics. | READY |
| Frontend Lightweight Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | /w24-session-worker or $w24-session-worker | Make /graph Explorer/Architecture UI consume lightweight slices without polling/heavy loads. | READY |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | /w24-session-worker or $w24-session-worker | Review worker reports, run verification, identify conflicts/perf regressions. | WAITING |

## Round Workboard

| Task ID | Owner Role | Status | Depends On | Write Scope | Acceptance |
| --- | --- | --- | --- | --- | --- |
| T1 | Docs Runtime Runbook Worker | READY | None | .docs/guides/graph-runtime-lightweight.md, .docs/plan.md, .docs/task.md | Plan/runbook explains snapshot-first graph runtime, operator deploy steps, alias drift cleanup, and MCP usage policy. |
| T2 | Backend Graph Runtime Worker | READY | None | pps/dashboard-api/src/routes/intel.ts, pps/dashboard-api/src/services/graph-*, pps/dashboard-api/src/services/indexer.ts, pps/dashboard-api/src/index.ts, tests if local pattern exists | Default graph/resource requests avoid realtime GitNexus list/cypher when snapshot/registry exists; /live or equivalent lightweight health added; caps and cache metadata exposed. |
| T3 | MCP Graph Tools Worker | READY | T2 API contract/report | pps/hub-mcp/src/tools/graph.ts, pps/hub-mcp/src/index.ts, related MCP schemas/tests | MCP graph tools use bounded snapshot-first API, expose snapshotHit/stale/truncated/capReason, and avoid broad raw context by default. |
| T4 | Frontend Lightweight Explorer Worker | READY | T2 API contract for final fields | pps/dashboard-web/src/app/graph/*, pps/dashboard-web/src/components/intel/GraphExplorer*, pps/dashboard-web/src/lib/api.ts | /graph no longer auto-polls heavy resources; Explorer defaults to small slices, click-to-expand, clear loading/stale/snapshot indicators. |
| T5 | QA Integrator Worker | WAITING | T1,T2,T3,T4 reports | Read-only source review plus .docs/session_reports/graph-runtime-lightweight-r2/* | Full report with verification, conflict list, perf smoke plan, and recommendation for planner merge/push. |

## Dependency Rules

- T1 and T2 can start immediately.
- T3 waits for T2's API contract summary before final wiring.
- T4 can start UI cleanup immediately, but final response-field wiring waits for T2.
- T5 starts only after T1-T4 report files exist.
- Workers must not commit or push.
- Workers must not edit .references/, .omx/, or unrelated dirty files.
- Workers must not revert user/planner changes.
- If write scopes conflict, stop and report NEEDS_PLANNER rather than forcing a merge.

## Shared Read-First Files

- D:\Python\projects\cortex-hub\AGENTS.md
- D:\Python\projects\cortex-hub\STATE.md
- D:\Python\projects\cortex-hub\.cortex\project-profile.json
- D:\Python\projects\cortex-hub\.docs\plan.md
- D:\Python\projects\cortex-hub\.docs\task.md
- D:\Python\projects\cortex-hub\.docs\guides\agent-cortex-workflow.md
- D:\Python\projects\cortex-hub\apps\dashboard-api\src\routes\intel.ts
- D:\Python\projects\cortex-hub\apps\dashboard-web\src\components\intel\GraphExplorer.tsx
- D:\Python\projects\cortex-hub\apps\hub-mcp\src\tools\graph.ts

## Handoff Files

Base folder: .docs/session_handoffs/graph-runtime-lightweight-r2/

| Role | Session ID | Handoff File | Report File |
| --- | --- | --- | --- |
| Docs Runtime Runbook Worker | 019dea25-3465-78b1-bb33-8befffc41957 | D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea25-3465-78b1-bb33-8befffc41957-docs-runtime-runbook.md | D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea25-3465-78b1-bb33-8befffc41957-docs-runtime-runbook-report.md |
| Backend Graph Runtime Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-runtime.md | D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-runtime-report.md |
| MCP Graph Tools Worker | 019dea26-c9f7-75a0-a653-c315229901ce | D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea26-c9f7-75a0-a653-c315229901ce-mcp-graph-tools.md | D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea26-c9f7-75a0-a653-c315229901ce-mcp-graph-tools-report.md |
| Frontend Lightweight Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea28-3812-7653-9cae-f02ac268d279-frontend-lightweight-explorer.md | D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea28-3812-7653-9cae-f02ac268d279-frontend-lightweight-explorer-report.md |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator.md | D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md |

## Dispatch Prompts

### Docs Runtime Runbook Worker
Paste this into session 19dea25-3465-78b1-bb33-8befffc41957:

`	ext
You are Docs Runtime Runbook Worker for cortex-hub.
Session id: 019dea25-3465-78b1-bb33-8befffc41957
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round/task: graph-runtime-lightweight-r2 / T1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea25-3465-78b1-bb33-8befffc41957-docs-runtime-runbook.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea25-3465-78b1-bb33-8befffc41957-docs-runtime-runbook-report.md

Run /w24-session-worker or -session-worker with this role and session id.

Assignment: document the snapshot-first graph runtime design and operator runbook. Include alias drift cleanup, deploy/redeploy, safe defaults, and how agents should use graph tools without forcing realtime full graph queries.
Scope in: .docs/guides/graph-runtime-lightweight.md, .docs/plan.md, .docs/task.md.
Scope out: runtime code, UI code, .references, .omx, commits/pushes.
Verification: markdown review; no build required unless you touch generated docs tooling.
Report contract: write the report file with status, files changed, decisions, verification, blockers, next steps. Final status: DONE, BLOCKED, NEEDS_PLANNER, or NEEDS_OWNER_INPUT.
`

### Backend Graph Runtime Worker
Paste this into session 19dea26-0377-7930-a5fa-0bd19bf8b3b9:

`	ext
You are Backend Graph Runtime Worker for cortex-hub.
Session id: 019dea26-0377-7930-a5fa-0bd19bf8b3b9
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round/task: graph-runtime-lightweight-r2 / T2
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-runtime.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-runtime-report.md

Run /w24-session-worker or -session-worker with this role and session id.

Assignment: make dashboard-api graph runtime lightweight. Implement registry-first GitNexus repo summary reads, graph snapshot/cache service, snapshot-first /api/intel/resources/project/:projectId/graph, explicit refresh fallback only, and lightweight /live health that does not wait on GitNexus.
Scope in: apps/dashboard-api/src/routes/intel.ts, apps/dashboard-api/src/services/graph-*, apps/dashboard-api/src/services/indexer.ts, apps/dashboard-api/src/index.ts, relevant backend tests.
Scope out: MCP tool wiring, frontend UI, compaction, .references, .omx, commits/pushes.
Acceptance: default graph/resource calls avoid realtime GitNexus when registry/snapshot exists; response includes snapshot/cache metadata; server caps remain enforced; typecheck/build for dashboard-api pass.
Report contract: include API contract changes, files changed, commands run, risks, follow-up. Final status: DONE, BLOCKED, NEEDS_PLANNER, or NEEDS_OWNER_INPUT.
`

### MCP Graph Tools Worker
Paste this into session 19dea26-c9f7-75a0-a653-c315229901ce:

`	ext
You are MCP Graph Tools Worker for cortex-hub.
Session id: 019dea26-c9f7-75a0-a653-c315229901ce
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round/task: graph-runtime-lightweight-r2 / T3
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea26-c9f7-75a0-a653-c315229901ce-mcp-graph-tools.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea26-c9f7-75a0-a653-c315229901ce-mcp-graph-tools-report.md

Run /w24-session-worker or -session-worker with this role and session id.

Assignment: adapt MCP graph tools to the snapshot-first bounded API from T2. Preserve agent usefulness while preventing broad realtime graph loads. Include snapshotHit/stale/truncated/capReason in returned context where available.
Scope in: apps/hub-mcp/src/tools/graph.ts, apps/hub-mcp/src/index.ts, related schemas/tests.
Scope out: dashboard-api implementation, frontend UI, compaction, .references, .omx, commits/pushes.
Dependency: wait for Backend Graph Runtime Worker T2 report or inspect its API contract before final wiring.
Verification: pnpm --filter @cortex/hub-mcp typecheck and any targeted tests available.
Report contract: include tool schemas, API assumptions, commands run, blockers. Final status: DONE, BLOCKED, NEEDS_PLANNER, or NEEDS_OWNER_INPUT.
`

### Frontend Lightweight Explorer Worker
Paste this into session 19dea28-3812-7653-9cae-f02ac268d279:

`	ext
You are Frontend Lightweight Explorer Worker for cortex-hub.
Session id: 019dea28-3812-7653-9cae-f02ac268d279
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round/task: graph-runtime-lightweight-r2 / T4
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea28-3812-7653-9cae-f02ac268d279-frontend-lightweight-explorer.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea28-3812-7653-9cae-f02ac268d279-frontend-lightweight-explorer-report.md

Run /w24-session-worker or -session-worker with this role and session id.

Assignment: make /graph UI lightweight and explicit. Remove heavy polling, keep Architecture resources on demand only, keep Explorer default small, add click-to-expand/search-submit behavior, and show snapshot/stale/loading/capped states without visual clutter.
Scope in: apps/dashboard-web/src/app/graph/*, apps/dashboard-web/src/components/intel/GraphExplorer*, apps/dashboard-web/src/lib/api.ts.
Scope out: dashboard-api implementation, MCP tools, compaction, .references, .omx, commits/pushes.
Dependency: final response-field wiring depends on T2 API contract; start UI interaction cleanup immediately if needed.
Verification: pnpm --filter @cortex/dashboard-web typecheck, lint, build if feasible.
Report contract: include changed files, UI behavior, commands run, remaining UX risks. Final status: DONE, BLOCKED, NEEDS_PLANNER, or NEEDS_OWNER_INPUT.
`

### QA Integrator Worker
Paste this into session 19dea28-eb74-7313-ad82-fd499df460ba after T1-T4 reports exist:

`	ext
You are QA Integrator Worker for cortex-hub.
Session id: 019dea28-eb74-7313-ad82-fd499df460ba
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round/task: graph-runtime-lightweight-r2 / T5
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\graph-runtime-lightweight-r2\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md

Run /w24-session-worker or -session-worker with this role and session id.

Assignment: review T1-T4 reports and changed files, run verification, check for overlapping edits/conflicts, and produce planner-ready integration report. Include a perf smoke checklist for live deployment.
Scope in: read-only source review plus .docs/session_reports/graph-runtime-lightweight-r2/*.
Scope out: source edits unless planner explicitly asks, .references, .omx, commits/pushes.
Dependency: wait for T1-T4 reports.
Verification: pnpm build, pnpm typecheck, pnpm lint if feasible; otherwise targeted package checks and reason.
Report contract: include findings, verification, blockers, recommended planner actions. Final status: DONE, BLOCKED, NEEDS_PLANNER, or NEEDS_OWNER_INPUT.
`

## Completion Report Contract

Each worker report must include:

`markdown
# Session Report
Status: DONE | BLOCKED | NEEDS_PLANNER | NEEDS_TESTER | NEEDS_OWNER_INPUT
Role:
Session ID:
Task ID:

## Summary
## Files Changed
## Commands Run
## Results
## Blockers
## Follow-Up
## Notes For Planner
`

## Planner Review Command

Run /w25-session-review-dispatch or $w25-session-review-dispatch in planner session 19dd96b-52ca-7902-9a0d-efcf13a892a5 after worker report files are present.

## Planner Round Review - graph-runtime-lightweight-r2

Reviewed: 2026-05-03 01:05 +02:00
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Workflow: $w25-session-review-dispatch

| Role | Session ID | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- |
| Docs Runtime Runbook Worker | 019dea25-3465-78b1-bb33-8befffc41957 | ACCEPTED | Runbook, plan, and task docs updated for snapshot-first graph runtime and operator rollout. | Closed. |
| Backend Graph Runtime Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | ACCEPTED | Registry-first repo reads, snapshot-first graph route, explicit refresh, graph snapshot service/test, and /live route implemented. | Closed. |
| MCP Graph Tools Worker | 019dea26-c9f7-75a0-a653-c315229901ce | ACCEPTED | Graph tools default refresh=false, expose refresh opt-in, bounded caps, and snapshot/runtime metadata in responses. | Closed. |
| Frontend Lightweight Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | ACCEPTED_AFTER_PLANNER_FIX | Explorer-first UI, no heavy polling, on-demand Architecture, small slices; planner added Refresh Snapshot and nested snapshot normalization. | Closed. |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | ACCEPTED_AFTER_PLANNER_FIX | QA found P1/P2 frontend contract gaps; planner fixed both and reran verification. | Closed. |

Planner fixes applied after QA:
- `apps/dashboard-web/src/lib/api.ts`: `refresh?: boolean` support plus nested `data.snapshot` normalization.
- `apps/dashboard-web/src/components/intel/GraphExplorer.tsx`: explicit `Refresh Snapshot` action using `refresh=true`; normal reads remain snapshot-first.
- `infra/Dockerfile.dashboard-api`: container healthcheck uses `/live` instead of dependency-heavy `/health`.

Verification:
- `pnpm --filter @cortex/hub-mcp typecheck`: PASS.
- `pnpm --filter @cortex/dashboard-api test -- graph-snapshot`: PASS, 2 tests.
- `pnpm build`: PASS, 6/6 tasks.
- `pnpm typecheck`: PASS, 9/9 tasks.
- `pnpm lint`: PASS, 4/4 tasks; existing Next lint deprecation/plugin notice only.
- `pnpm test`: PASS, 6/6 tasks; dashboard-api 4 tests.

Residual risks:
- Live smoke still needed after deploy: /live fast under GitNexus degradation; /graph default does not call GitNexus; explicit Refresh Snapshot creates bounded snapshot; reload serves snapshotHit=true.
- Cortex MCP lifecycle tools were unavailable in this Codex session, so compliance reporting/memory storage could not be called here.

Round result: CLOSED_READY_TO_COMMIT_AND_PUSH.
