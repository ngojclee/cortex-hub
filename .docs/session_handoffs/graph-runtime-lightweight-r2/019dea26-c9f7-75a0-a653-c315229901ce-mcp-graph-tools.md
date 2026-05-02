# Session Handoff

Project: cortex-hub
Branch: master
Round: graph-runtime-lightweight-r2
Role: MCP Graph Tools Worker
Session ID: 019dea26-c9f7-75a0-a653-c315229901ce
Planner Session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Plan File: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Report File: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea26-c9f7-75a0-a653-c315229901ce-mcp-graph-tools-report.md
Status: READY

## Assignment

Adapt MCP graph tools to the snapshot-first bounded API from T2. Preserve agent usefulness while preventing broad realtime graph loads. Include snapshotHit/stale/truncated/capReason in returned context where available.

## Scope In

apps/hub-mcp/src/tools/graph.ts, apps/hub-mcp/src/index.ts, related schemas/tests

## Scope Out

dashboard-api implementation, frontend UI, compaction, .references, .omx, commits/pushes

## Dependencies

Wait for Backend Graph Runtime Worker T2 report or inspect its API contract before final wiring.

## Read First

- D:\Python\projects\cortex-hub\AGENTS.md
- D:\Python\projects\cortex-hub\STATE.md
- D:\Python\projects\cortex-hub\.cortex\project-profile.json
- D:\Python\projects\cortex-hub\.docs\session_team_plan.md
- D:\Python\projects\cortex-hub\.docs\plan.md
- D:\Python\projects\cortex-hub\.docs\task.md
- D:\Python\projects\cortex-hub\.docs\guides\agent-cortex-workflow.md

## Verification

pnpm --filter @cortex/hub-mcp typecheck and targeted tests if available.

## Report Contract

Write the report file with:

- Status: DONE | BLOCKED | NEEDS_PLANNER | NEEDS_TESTER | NEEDS_OWNER_INPUT
- Role, Session ID, Task ID: T3
- Summary
- Files Changed
- Commands Run
- Results
- Blockers
- Follow-Up
- Notes For Planner

## Command

Run /w24-session-worker or $w24-session-worker in this session.
