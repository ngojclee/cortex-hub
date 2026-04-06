# Database Project Normalization

## Goal

Normalize Cortex Hub's project-scoped runtime tables so session, query, and quality data point to canonical `projects.id` values.

Target tables:
- `organizations`
- `projects`
- `session_handoffs`
- `query_logs`
- `quality_reports`

## Canonical Rules

- `session_handoffs.project_id` should store `projects.id`
- `query_logs.project_id` should store `projects.id`
- `quality_reports.project_id` should store `projects.id`
- `session_handoffs.project` remains the raw repo/reference string
- `shared_metadata.projectId` in runtime tables should be normalized to `projects.id`
- `knowledge_documents` and mem9/Qdrant metadata still use project slugs in current app flow; do not bulk-convert those with this script

## Script

Run from repo root:

```bash
pnpm --filter @cortex/dashboard-api run db:project-normalize -- --db /home/Docker/cortex-hub/api-data/cortex.db
```

Apply changes only after reviewing the dry-run:

```bash
pnpm --filter @cortex/dashboard-api run db:project-normalize -- --db /home/Docker/cortex-hub/api-data/cortex.db --apply
```

Optional backup directory:

```bash
pnpm --filter @cortex/dashboard-api run db:project-normalize -- --db /home/Docker/cortex-hub/api-data/cortex.db --apply --backup-dir /home/Docker/cortex-hub/api-data/backups
```

## What The Script Does

1. Reads all SQLite tables and prints schema + foreign key relationships.
2. Flags tables with no inbound/outbound foreign keys.
3. Audits `organizations` and `projects`.
4. Resolves runtime `project_id` values from:
   - existing `project_id`
   - project slug
   - repo URL
   - `shared_metadata.projectId`
   - `session_handoffs.context.projectId`
   - `session_handoffs.project`
   - `quality_reports.session_id`
5. Deletes orphan `session_handoffs` rows only when no valid project can be inferred.
6. Clears broken `quality_reports.session_id` links when the referenced session is removed or missing.
7. Auto-creates missing project rows from strong session repo signals.
8. Creates safe project/query/session indexes if missing.
9. Drops exact duplicate custom indexes if found.
10. Creates a SQLite backup with `VACUUM INTO` before any mutation.

## Recommended Host Checks

If running on the Docker host:

```bash
ls -lah /home/Docker/cortex-hub/api-data
sqlite3 /home/Docker/cortex-hub/api-data/cortex.db ".tables"
```

If inspecting from the container:

```bash
docker exec cortex-api ls -lah /app/data
docker exec cortex-api sh -lc "sqlite3 /app/data/cortex.db '.tables'"
```

## Current Limitation

This runbook and script were prepared from local repo access. The live production DB still needs to be audited and normalized on the server or inside the running container because the current local environment did not have direct authenticated access to the protected host/API.
