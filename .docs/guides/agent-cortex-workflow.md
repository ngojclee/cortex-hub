# Agent Cortex Workflow Guide

## Purpose

This guide defines the standard way agents should use Cortex Hub without losing project memory or wasting tokens.

## Standard Ladder

```text
session_start
-> memory_search + knowledge_search
-> project context resources
-> graph_search / graph_slice
-> symbol_brief / code_context
-> code_read only selected files
-> code_impact before edit
-> detect_changes + verify
-> quality_report
-> memory_store / knowledge_store
-> session_end
```

## Current MCP Coverage

Available now:

- `cortex_session_start`
- `cortex_memory_search`
- `cortex_knowledge_search`
- project context resources returned by Context Fabric
- `cortex_code_search`
- `cortex_code_context`
- `cortex_code_read`
- `cortex_code_tree`
- `cortex_cypher`
- `cortex_code_impact`
- `cortex_detect_changes`
- `cortex_quality_report`
- `cortex_memory_store`
- `cortex_knowledge_store`
- `cortex_session_end`

Planned dedicated graph tools:

- `cortex_graph_search`
- `cortex_graph_slice`
- `cortex_file_neighbors`
- `cortex_symbol_brief`

Until those exist, use this fallback mapping:

| Desired step | Current fallback |
|--------------|------------------|
| `graph_search` | `cortex_code_search`, then `cortex_cypher` for direct graph queries |
| `graph_slice` | `cortex_code_tree` or focused `cortex_cypher` |
| `symbol_brief` | `cortex_code_context`, plus `cortex_code_impact` when edit risk matters |
| `file_neighbors` | `cortex_code_tree`, `cortex_code_context`, or `cortex_cypher` by file path |

## Start Of Session

1. Call `cortex_session_start` with `repo`, `mode`, and `agentId`.
2. Read `STATE.md`.
3. Read `.cortex/project-profile.json`.
4. Use returned Context Fabric resources to identify projectId, branch, clusters, processes, suggested files, and resource URIs.

Use `mode=development` for normal repo work, `mode=review` for review-only work, and `mode=production` only for live production operations.

## Discovery Order

Use Cortex before local grep/find when the task touches project behavior:

1. `cortex_memory_search` for past agent/session findings.
2. `cortex_knowledge_search` for shared decisions, known bugs, and runbooks.
3. Project context resources for current architecture slices.
4. `cortex_code_search` or future `cortex_graph_search` for candidate symbols/files.
5. `cortex_code_context`, `cortex_code_tree`, `cortex_cypher`, or future graph slice tools for focused neighborhoods.
6. `cortex_code_read` or local file read only after the relevant files are known.

## Token Saving Rules

- Prefer resource summaries before raw code.
- Prefer bounded graph slices before broad code search.
- Prefer compact memory/knowledge snippets when available.
- Keep `limit` small unless the task proves it needs more.
- Read raw code only for files that are likely to be edited or verified.
- Use `includeRaw` only when compact context is insufficient.
- Store concise reusable facts instead of long logs.

## Memory Vs Knowledge

Use `cortex_memory_store` for session-specific or agent-specific context:

- branch-local discoveries
- non-obvious local workarounds
- current task handoff details
- project-specific debugging notes

Use `cortex_knowledge_store` for reusable shared knowledge:

- architecture decisions
- API/schema/endpoint contracts
- resolved bugs and fixes
- deployment or auth gotchas
- data cleanup rules
- dependency or license constraints
- workflows that future agents should reuse

## What To Store

Store only information with future value:

- decision made and why
- bug symptom, root cause, and fix
- endpoint or schema contract
- config/deployment gotcha
- files/symbols/processes affected
- verification result that changes future behavior
- repo alias/project mapping

Recommended format:

```text
Title:
Context:
Decision/Fix:
Evidence:
Impact:
Files:
Next:
Tags:
```

Recommended metadata:

- `projectId`
- `branch`
- `agentId`
- `filesTouched`
- `symbolsTouched`
- `processesAffected`
- `clustersTouched`
- `resourceUris`
- `tags`

## What Not To Store

Do not store:

- secrets, tokens, passwords, cookies, or private keys
- huge raw logs
- large raw source files
- obvious facts that can be read directly from source
- temporary chat noise
- duplicate memories with no new information
- unverified guesses without marking uncertainty

## Before Editing

1. Identify the target symbol/file.
2. Run `cortex_code_context` or future `cortex_symbol_brief`.
3. Run `cortex_code_impact` for core code, shared APIs, auth, routing, DB, or infra.
4. Read only the selected raw files.
5. Edit.

## Bugs And Errors

For compile errors, runtime errors, failed tests, and production issues:

1. Search `cortex_knowledge_search` and `cortex_memory_search` using the exact error.
2. Fix the issue.
3. Store the solution with `cortex_knowledge_store` if the fix was non-obvious or reusable.
4. Store session-specific notes with `cortex_memory_store` when useful.

## End Of Session

1. Run verify commands from `.cortex/project-profile.json`.
2. Run `cortex_detect_changes`.
3. Call `cortex_quality_report`.
4. Store useful memory/knowledge.
5. Update `STATE.md` if project state changed.
6. Call `cortex_session_end`.

## Compact Context Policy

When compaction is available:

- Keep raw content for humans and audit.
- Return compact content to agents by default.
- Preserve code identifiers, paths, URLs, commands, versions, schemas, and numbers.
- Use raw fallback when compact output hides debugging context.
- Track raw tokens vs compact tokens.
