# Session Handoff

Project: cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Role: QA Integrator Worker
Session ID: 019dea28-eb74-7313-ad82-fd499df460ba
Planner Session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Plan File: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Report File: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md
Status: READY

## Assignment

Review T1-T4 reports and changed files, run verification, check conflicts, produce integration report.

## Scope In

.docs/session_reports/ai-context-upgrade-r1/* only; otherwise read-only.

## Scope Out

source edits unless planner explicitly asks; .references; .omx; commits/pushes

## Dependencies

T1-T4 reports

## Read First

- $root\AGENTS.md
- $root\STATE.md
- $root\.cortex\project-profile.json
- $root\.docs\plan.md
- $root\.docs\task.md
- $root\.docs\guides\agent-cortex-workflow.md
- $root\.docs\research_notes.md
- $root\.docs\session_team_plan.md

## Verification

System.Collections.Hashtable.Verify

Full final verify remains planner/integrator responsibility: pnpm build, pnpm typecheck, pnpm lint.

## Report Contract

Write report to:

$reportPath

Include status, summary, files changed, commands run, results, blockers, follow-up, and notes for planner.

## Command

Run /w24-session-worker or $w24-session-worker in this session.
