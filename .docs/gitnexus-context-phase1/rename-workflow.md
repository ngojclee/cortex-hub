# Rename Workflow: `cortex_code_rename`

## Goal
Expose GitNexus-powered rename as a safe Cortex workflow without turning the MCP surface into an unsafe bulk-edit tool.

## Proposed Shape
`cortex_code_rename` should be preview-first and apply-second.

### Preview Mode
Input:
- `project_id`
- `old_name`
- `new_name`
- `scope`
  - `symbol`
  - `file_local`
  - `project_wide`
- `preview_only=true`

Output:
- `summary`
  - total edits
  - files affected
  - confidence buckets
- `edits`
  - file path
  - symbol kind
  - line preview
  - confidence
- `sharedMetadata`
  - `projectId`
  - `filesTouched`
  - `symbolsTouched`
  - `processesAffected`
  - `clustersTouched`
- `warnings`
  - dynamic references
  - string-literal hits
  - low-confidence edits

### Apply Mode
Input:
- same payload as preview
- `preview_only=false`
- `approved_preview_id`

Rules:
- Cortex refuses apply mode without a matching preview result
- apply expires after a short window to avoid stale edits
- apply writes only the previewed file set
- low-confidence edits require explicit confirmation from the client/app

## Why This Split Matters
- Agents can inspect blast radius before mutating files
- The dashboard can show a human-readable approval step
- Shared metadata can attach rename operations to sessions, changes, and quality reports
- The workflow stays consistent with `cortex_code_impact`

## Suggested Dashboard UX
1. Search for the symbol first
2. Run rename preview
3. Show affected files grouped by cluster/process
4. Allow approve/apply only after preview review
5. Require a quality gate after apply

## Non-Goals For The First Release
- no blind project-wide search/replace
- no auto-apply from natural-language prompts without a preview object
- no rename support until native GitNexus indexing quality is stable

## Release Gate
Only implement the real tool once:
- native GitNexus indexing is verified on Docker
- cluster/process labels are stable enough to explain blast radius
- quality reporting is part of the standard post-change workflow
