# Cortex Hub — Claude Code Instructions

## Auto MCP (MANDATORY — every conversation)

At the START of every conversation, before doing anything else:

1. Call `cortex_session_start` with:
   ```
   repo: "https://github.com/lktiep/cortex-hub"
   mode: "development"
   agentId: "claude-code"
   ```
   This returns project context AND unseen code changes from other agents.

2. If `recentChanges.count > 0` in the response, warn the user and run `git pull` before editing any affected files.

3. Read `STATE.md` for current task progress.

## Before editing shared files

Call `cortex_changes` to check if another agent modified the same files:
```
agentId: "claude-code"
projectId: "<from session_start response>"
```

## After pushing code

Call `cortex_code_reindex` to update code intelligence:
```
repo: "https://github.com/lktiep/cortex-hub"
branch: "<current branch>"
```

## Ending a session

When the conversation is finishing, call `cortex_session_end` to close the session:
```
sessionId: "<sessionId from session_start response>"
summary: "<brief summary of work done>"
```
This prevents stale sessions from accumulating.

## Quality gates

Every session must end with:
- `pnpm build && pnpm typecheck && pnpm lint`
- Call `cortex_quality_report` with results
- Call `cortex_session_end` to close the session

## Tech stack

Monorepo: pnpm + Turborepo. TypeScript strict. Hono API. Next.js 15 frontend. SQLite + Qdrant. Docker Compose.

## Code conventions

camelCase vars/functions, PascalCase types. `@cortex/*` path aliases. No `any` without comment.

## Project identity notes

- Runtime SQLite tables should normalize `session_handoffs.project_id`, `query_logs.project_id`, and `quality_reports.project_id` to canonical `projects.id` values.
- `session_handoffs.project` stays as the raw repo/reference string for session provenance.
- Knowledge documents and mem9 vector metadata still use project slugs in the current ingestion flow; do not bulk-convert those when cleaning runtime tables.
- DB maintenance script: `pnpm --filter @cortex/dashboard-api run db:project-normalize -- --db /path/to/cortex.db [--apply]`

<!-- cortex-hub:auto-mcp -->
## Cortex Hub — Auto MCP (MANDATORY — every conversation)

At the START of every conversation, before doing anything else:

1. Call `cortex_session_start` with:
   ```
   repo: "https://github.com/lktiep/cortex-hub.git"
   mode: "development"
   agentId: "claude-code"
   ```
   This returns project context AND unseen code changes from other agents.

2. If `recentChanges.count > 0` in the response, warn the user and run `git pull` before editing any affected files.

3. Read `STATE.md` for current task progress (if it exists).

### Before editing shared files

Call `cortex_changes` to check if another agent modified the same files:
```
agentId: "claude-code"
projectId: "<from session_start response>"
```

### When encountering an error or bug (MANDATORY)

1. First search `cortex_knowledge_search` or `cortex_memory_search` for the error message.
2. Fix the error.
3. If the fix was non-obvious, **YOU MUST** use `cortex_knowledge_store` to record the problem and solution so you (and others) don't have to debug it again.

### After pushing code

Call `cortex_code_reindex` to update code intelligence:
```
repo: "https://github.com/lktiep/cortex-hub.git"
branch: "<current branch>"
```

### Quality gates

Every session must end with verification commands from `.cortex/project-profile.json`.
Call `cortex_quality_report` with results.
Call `cortex_session_end` to close the session.

### Complete Tool Reference (16 tools)

| # | Tool | When to Use | Required Args |
|---|------|-------------|---------------|
| 1 | `cortex_session_start` | Start of EVERY conversation | `repo`, `agentId`, `mode` |
| 2 | `cortex_session_end` | End of EVERY session | `sessionId` |
| 3 | `cortex_changes` | Before editing shared files | `agentId`, `projectId` |
| 4 | `cortex_code_search` | **BEFORE** grep/find — use FIRST | `query`, optional `projectId` |
| 5 | `cortex_code_context` | Understand a symbol (callers, callees, flows) | `name`, optional `file` |
| 6 | `cortex_code_impact` | Before editing core code | `target` (function/class/file) |
| 7 | `cortex_detect_changes` | Before committing — pre-commit risk analysis | optional `scope`, `projectId` |
| 8 | `cortex_cypher` | Advanced graph queries (find callers, trace deps) | `query` (Cypher syntax) |
| 9 | `cortex_code_reindex` | After EVERY push | `repo`, `branch` |
| 10 | `cortex_memory_search` | Recall past decisions/findings | `query` |
| 11 | `cortex_memory_store` | Store session findings | `content` |
| 12 | `cortex_knowledge_search` | Search **FIRST** when encountering errors | `query` |
| 13 | `cortex_knowledge_store` | **MANDATORY**: Contribute bug fixes & patterns | `title`, `content` |
| 14 | `cortex_quality_report` | After running verify commands | `gate_name`, `results`, `agent_id` |
| 15 | `cortex_plan_quality` | Assess plan before execution | `plan`, `request` |
| 16 | `cortex_tool_stats` | View tool usage analytics & effectiveness | optional `days`, `agentId` |

### Compliance Enforcement (Automated)

Your tool usage is **automatically tracked and scored**:

1. **Session Compliance Score** — `cortex_session_end` returns a grade (A/B/C/D) based on 5-category tool coverage.
2. **MCP Response Hints** — Every tool response includes adaptive hints about what to use next.

> 💡 These are infrastructure-level — they work on ANY MCP client, not just Claude hooks.
<!-- cortex-hub:auto-mcp -->
