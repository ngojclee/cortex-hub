# Session Handoff

Project: cortex-hub
Branch: master
Round: graph-runtime-lightweight-r2
Role: QA Integrator Worker
Session ID: 019dea28-eb74-7313-ad82-fd499df460ba
Planner Session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Plan File: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Report File: D:\Python\projects\cortex-hub\.docs\session_reports\graph-runtime-lightweight-r2\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md
Status: READY

## Assignment

Review T1-T4 reports and changed files, run verification, check overlapping edits/conflicts, and produce planner-ready integration report. Include a perf smoke checklist for live deployment.

## Scope In

read-only source review plus .docs/session_reports/graph-runtime-lightweight-r2/*

## Scope Out

source edits unless planner explicitly asks, .references, .omx, commits/pushes

## Dependencies

Wait for T1-T4 reports.

## Read First

- D:\Python\projects\cortex-hub\AGENTS.md
- D:\Python\projects\cortex-hub\STATE.md
- D:\Python\projects\cortex-hub\.cortex\project-profile.json
- D:\Python\projects\cortex-hub\.docs\session_team_plan.md
- D:\Python\projects\cortex-hub\.docs\plan.md
- D:\Python\projects\cortex-hub\.docs\task.md
- D:\Python\projects\cortex-hub\.docs\guides\agent-cortex-workflow.md

## Verification

pnpm build, pnpm typecheck, pnpm lint if feasible; otherwise targeted checks with reason.

## Report Contract

Write the report file with:

- Status: DONE | BLOCKED | NEEDS_PLANNER | NEEDS_TESTER | NEEDS_OWNER_INPUT
- Role, Session ID, Task ID: T5
- Summary
- Files Changed
- Commands Run
- Results
- Blockers
- Follow-Up
- Notes For Planner

## Command

Run /w24-session-worker or $w24-session-worker in this session.
