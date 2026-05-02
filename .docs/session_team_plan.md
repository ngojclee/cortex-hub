# Session Team Plan

Project: cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Updated: 2026-05-02 22:31:54 +02:00

## Goal

Execute the next Cortex AI-context upgrade through separate sessions:

1. Sync the Agent Cortex Workflow Guide into agent rules.
2. Add bounded graph API and MCP graph tools.
3. Add Caveman-inspired compaction behind feature flags.
4. Add Explorer UI shell and graph visualization.
5. Verify integration before planner merge/review.

## Current Repo Truth

- Phase 6, Gate 5 passed.
- Branch: `master`, tracking `origin/master`.
- Current dirty/untracked files include planning docs, `AGENTS.md`, `.references/`, `.omx/`, guide/research notes. Do not revert unrelated state.
- Live MCP available now: `cortex_session_start`, `cortex_memory_search`, `cortex_knowledge_search`, `cortex_code_search`, `cortex_code_context`, `cortex_code_read`, `cortex_code_tree`, `cortex_cypher`, `cortex_code_impact`, `cortex_detect_changes`, `cortex_quality_report`, `cortex_memory_store`, `cortex_knowledge_store`, `cortex_session_end`.
- Missing planned dedicated tools: `cortex_graph_search`, `cortex_graph_slice`, `cortex_file_neighbors`, `cortex_symbol_brief`.

## Session Roster

| Role | Session ID | Command | Responsibility | Status |
| --- | --- | --- | --- | --- |
| Planner | 019dd96b-52ca-7902-9a0d-efcf13a892a5 | /w25-session-review-dispatch or $w25-session-review-dispatch | Coordinate, integrate reports, resolve dependencies. | REVIEWED |
| Docs Rules Worker | 019dea25-3465-78b1-bb33-8befffc41957 | /w24-session-worker or $w24-session-worker | Sync guide into AGENTS.md and onboarding/rules generator. | ACCEPTED |
| Backend Graph Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | /w24-session-worker or $w24-session-worker | Implement bounded graph API and MCP graph tools. | ACCEPTED |
| Backend Compaction Worker | 019dea26-c9f7-75a0-a653-c315229901ce | /w24-session-worker or $w24-session-worker | Implement compactor service and compact memory/knowledge contract. | ACCEPTED |
| Frontend Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | /w24-session-worker or $w24-session-worker | Add /graph Architecture|Explorer shell and Sigma/graphology Explorer UI. | ACCEPTED |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | /w24-session-worker or $w24-session-worker | Review outputs, run verification, prepare integration report. | ACCEPTED_AFTER_FIX |

## Round Workboard

| Task ID | Owner Role | Status | Depends On | Write Scope | Acceptance |
| --- | --- | --- | --- | --- | --- |
| T1 | Docs Rules Worker | DONE_ACCEPTED | None | `AGENTS.md`, onboarding/rules generator/templates, docs links | Guide synced into AGENTS.md, `.cortex/agent-rules.md`, and onboarding scripts. |
| T2 | Backend Graph Worker | DONE_ACCEPTED | None | `apps/dashboard-api/src/routes/intel.ts`, `apps/hub-mcp/src/tools/graph.ts`, `apps/hub-mcp/src/index.ts`, related tests/types | Bounded graph endpoint + MCP graph tools implemented; full repo verify passes after integration. |
| T3 | Backend Compaction Worker | DONE_ACCEPTED | None | `apps/dashboard-api/src/services/content-compactor.ts`, `routes/mem9-proxy.ts`, `routes/knowledge.ts`, MCP memory/knowledge tools | Raw+compact contract behind feature flag; preservation validation covered by tests. |
| T4 | Frontend Explorer Worker | DONE_ACCEPTED | T2 API contract | `apps/dashboard-web/src/app/graph/*`, `components/intel/*Explorer*`, `lib/api.ts`, dashboard-web package deps | Explorer shell/search/filter/inspector wired to bounded API; API response normalization added. |
| T5 | QA Integrator Worker | DONE_ACCEPTED | T1,T2,T3,T4 reports | Read-only except `.docs/session_reports/ai-context-upgrade-r1/*` | QA findings resolved: frontend graph contract normalized and report filenames aligned. |

## Dependency Rules

- T1, T2, T3 can start immediately.
- T4 can start with UI shell, but final API wiring depends on T2 contract.
- T5 starts after T1-T4 report files exist.
- No worker commits or pushes.
- Workers must not edit `.references/` or `.omx/`.
- Workers must not revert planner/user changes.

## Shared Read-First Files

- `D:\Python\projects\cortex-hub\AGENTS.md`
- `D:\Python\projects\cortex-hub\STATE.md`
- `D:\Python\projects\cortex-hub\.cortex\project-profile.json`
- `D:\Python\projects\cortex-hub\.docs\plan.md`
- `D:\Python\projects\cortex-hub\.docs\task.md`
- `D:\Python\projects\cortex-hub\.docs\guides\agent-cortex-workflow.md`
- `D:\Python\projects\cortex-hub\.docs\research_notes.md`
- `D:\Python\projects\cortex-hub\.docs\session_team_plan.md`

## Handoff Files

Base folder: `.docs/session_handoffs/ai-context-upgrade-r1/`

| Role | Session ID | Handoff File | Report File |
| --- | --- | --- | --- |
| Docs Rules Worker | 019dea25-3465-78b1-bb33-8befffc41957 | `D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea25-3465-78b1-bb33-8befffc41957-docs-rules.md` | `D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea25-3465-78b1-bb33-8befffc41957-docs-rules-report.md` |
| Backend Graph Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | `D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph.md` | `D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-report.md` |
| Backend Compaction Worker | 019dea26-c9f7-75a0-a653-c315229901ce | `D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea26-c9f7-75a0-a653-c315229901ce-backend-compaction.md` | `D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea26-c9f7-75a0-a653-c315229901ce-backend-compaction-report.md` |
| Frontend Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | `D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea28-3812-7653-9cae-f02ac268d279-frontend-explorer.md` | `D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea28-3812-7653-9cae-f02ac268d279-frontend-explorer-report.md` |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | `D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator.md` | `D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md` |

## Dispatch Prompts

### Docs Rules Worker
Paste this into the new docs/rules session:

```text
You are Docs Rules Worker for cortex-hub.
Session id: 019dea25-3465-78b1-bb33-8befffc41957
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea25-3465-78b1-bb33-8befffc41957-docs-rules.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea25-3465-78b1-bb33-8befffc41957-docs-rules-report.md

Run /w24-session-worker or $w24-session-worker with this role and session id.

Assignment: Sync `.docs/guides/agent-cortex-workflow.md` into AGENTS.md and the onboarding/rules generator so future `.cortex/agent-rules.md` gets the short guide automatically.

Scope in: AGENTS.md, scripts/onboard*, generator/templates that produce agent rules, docs links.
Scope out: backend/frontend runtime code, .references, .omx, commits/pushes.
Report contract: write the report file with status, summary, files changed, commands run, blockers, follow-up.
```

### Backend Graph Worker
Paste this into the new backend graph session:

```text
You are Backend Graph Worker for cortex-hub.
Session id: 019dea26-0377-7930-a5fa-0bd19bf8b3b9
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea26-0377-7930-a5fa-0bd19bf8b3b9-backend-graph-report.md

Run /w24-session-worker or $w24-session-worker with this role and session id.

Assignment: Implement bounded graph endpoint and MCP graph tools: `cortex_graph_search`, `cortex_graph_slice`, `cortex_file_neighbors`, `cortex_symbol_brief`.

Scope in: apps/dashboard-api/src/routes/intel.ts, apps/hub-mcp/src/tools/graph.ts, apps/hub-mcp/src/index.ts, related tests/types.
Scope out: frontend graph UI, compaction service, .references, .omx, commits/pushes.
Report contract: include API/tool schemas, files changed, commands run, blockers, follow-up.
```

### Backend Compaction Worker
Paste this into the new backend compaction session:

```text
You are Backend Compaction Worker for cortex-hub.
Session id: 019dea26-c9f7-75a0-a653-c315229901ce
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea26-c9f7-75a0-a653-c315229901ce-backend-compaction.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea26-c9f7-75a0-a653-c315229901ce-backend-compaction-report.md

Run /w24-session-worker or $w24-session-worker with this role and session id.

Assignment: Add `content-compactor` service and raw+compact memory/knowledge contract behind feature flag. Preserve raw fallback and code/path/url/number tokens.

Scope in: apps/dashboard-api/src/services/content-compactor.ts, apps/dashboard-api/src/routes/mem9-proxy.ts, apps/dashboard-api/src/routes/knowledge.ts, apps/hub-mcp/src/tools/memory.ts, apps/hub-mcp/src/tools/knowledge.ts.
Scope out: graph API/tools, Explorer UI, .references, .omx, commits/pushes.
Report contract: include contract shape, feature flag, preservation rules, tests/commands, blockers.
```

### Frontend Explorer Worker
Paste this into the new frontend session:

```text
You are Frontend Explorer Worker for cortex-hub.
Session id: 019dea28-3812-7653-9cae-f02ac268d279
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea28-3812-7653-9cae-f02ac268d279-frontend-explorer.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea28-3812-7653-9cae-f02ac268d279-frontend-explorer-report.md

Run /w24-session-worker or $w24-session-worker with this role and session id.

Assignment: Add `/graph` mode switch `Architecture | Explorer`; build Explorer shell with search/filter/depth/inspector. Use `sigma.js + graphology` if package review passes.

Scope in: apps/dashboard-web/src/app/graph/*, apps/dashboard-web/src/components/intel/*Explorer*, apps/dashboard-web/src/lib/api.ts, apps/dashboard-web/package.json, lockfile if deps added.
Scope out: backend API implementation, compaction service, .references, .omx, commits/pushes.
Dependency: final API wiring depends on Backend Graph Worker contract/report.
Report contract: include UI state, dependencies, files changed, screenshots/test notes if any, blockers.
```

### QA Integrator Worker
Paste this into the new QA session after T1-T4 reports exist:

```text
You are QA Integrator Worker for cortex-hub.
Session id: 019dea28-eb74-7313-ad82-fd499df460ba
Planner session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Project root: D:\Python\projects\cortex-hub
Branch: master
Round: ai-context-upgrade-r1
Plan file: D:\Python\projects\cortex-hub\.docs\session_team_plan.md
Handoff file: D:\Python\projects\cortex-hub\.docs\session_handoffs\ai-context-upgrade-r1\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator.md
Report file: D:\Python\projects\cortex-hub\.docs\session_reports\ai-context-upgrade-r1\019dea28-eb74-7313-ad82-fd499df460ba-qa-integrator-report.md

Run /w24-session-worker or $w24-session-worker with this role and session id.

Assignment: Review T1-T4 reports and changed files, run verification, check overlap/conflicts, produce final integration report for planner.

Scope in: read-only review plus `.docs/session_reports/ai-context-upgrade-r1/*`.
Scope out: source edits unless planner explicitly requests, .references, .omx, commits/pushes.
Dependency: wait for T1-T4 reports.
Report contract: include verification commands/results, conflicts, missing acceptance, recommended planner actions.
```

## Completion Report Contract

Each worker report must include:

```markdown
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
```

## Planner Review Command

Run `/w25-session-review-dispatch` or `$w25-session-review-dispatch` in planner session `019dd96b-52ca-7902-9a0d-efcf13a892a5` after worker report files are present.

## Planner Round Review

Reviewed: 2026-05-02 22:31:54 +02:00
Reviewer session: 019dd96b-52ca-7902-9a0d-efcf13a892a5
Status: CLOSED_ACCEPTED

| Role | Session ID | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- |
| Docs Rules Worker | 019dea25-3465-78b1-bb33-8befffc41957 | ACCEPTED | Guide/rules generator synced; parser checks passed. | No round-2 task. |
| Backend Graph Worker | 019dea26-0377-7930-a5fa-0bd19bf8b3b9 | ACCEPTED | Graph API and four MCP graph tools implemented; full verify passes after integration. | Live smoke after deploy. |
| Backend Compaction Worker | 019dea26-c9f7-75a0-a653-c315229901ce | ACCEPTED | Feature-flagged compactor and raw+compact contracts implemented; compactor tests pass. | Keep compaction disabled by default until retrieval benchmark. |
| Frontend Explorer Worker | 019dea28-3812-7653-9cae-f02ac268d279 | ACCEPTED | /graph Architecture/Explorer mode, Sigma/graphology canvas, filters, search, inspector implemented. | Live UI smoke after deploy. |
| QA Integrator Worker | 019dea28-eb74-7313-ad82-fd499df460ba | ACCEPTED_AFTER_PLANNER_FIX | P1 API/UI contract fixed in pps/dashboard-web/src/lib/api.ts; P2 report filenames aligned. | No extra worker dispatch needed. |

Verification evidence:

- pnpm build PASS
- pnpm typecheck PASS
- pnpm lint PASS after removing local generated build artifacts
- pnpm test PASS

Residual risks:

- Live /graph smoke should be run after Docker image deploy because local verify does not exercise the deployed GitNexus data path.
- CONTENT_COMPACTION_ENABLED remains disabled by default; enable only after sampling retrieval quality.
- .references/ and .omx/ remain local-only and should not be committed.