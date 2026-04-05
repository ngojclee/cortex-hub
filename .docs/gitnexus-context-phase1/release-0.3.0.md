# Release Note: 0.3.0

## Scope
Minor release for the first GitNexus context-fabric surface inside Cortex Hub, plus the improved `Memories` dashboard rendering and `.docs`-first knowledge ingestion compatibility.

## Included Changes
- `Memories` dashboard now renders actual stored memory text, project metadata, agent metadata, and readable timestamps
- `mem9` project filtering accepts both legacy `project_id` and nested `metadata.project_id`
- Dashboard API now exposes normalized GitNexus-backed resource endpoints:
  - `/api/intel/resources/projects`
  - `/api/intel/resources/project/:projectId/context`
  - `/api/intel/resources/project/:projectId/clusters`
  - `/api/intel/resources/project/:projectId/cluster/:clusterName`
  - `/api/intel/resources/project/:projectId/processes`
  - `/api/intel/resources/project/:projectId/process/:processName`
  - `/api/intel/resources/project/:projectId/schema`
- `hub-mcp` now exposes first-class MCP resources:
  - `cortex://projects`
  - `cortex://project/{projectId}/context`
  - `cortex://project/{projectId}/clusters`
  - `cortex://project/{projectId}/cluster/{clusterName}`
  - `cortex://project/{projectId}/processes`
  - `cortex://project/{projectId}/process/{processName}`
  - `cortex://project/{projectId}/schema`
- Knowledge ingestion now prefers root `.docs/` and avoids double-ingesting root `docs/` when both exist

## Version
- Version: `0.3.0`
- Release type: `minor`

## Images To Rebuild
- Required: `cortex-api`
- Required: `cortex-mcp`
- Not required: `cortex-gitnexus`

## GitHub Actions Build
### Preferred
Use the GitHub Actions workflow `Build & Push Docker Images` from `.github/workflows/docker-build.yml`.

This workflow publishes:
- `ghcr.io/<owner>/cortex-api:latest`
- `ghcr.io/<owner>/cortex-api:<sha>`
- `ghcr.io/<owner>/cortex-mcp:latest`
- `ghcr.io/<owner>/cortex-mcp:<sha>`
- `ghcr.io/<owner>/cortex-gitnexus:latest`
- `ghcr.io/<owner>/cortex-gitnexus:<sha>`

### Trigger Options
1. Push the release commit to `master`
2. Or manually trigger `workflow_dispatch` for `docker-build.yml`

### CLI Trigger
```bash
gh workflow run docker-build.yml --repo ngojclee/cortex-hub
```

### Watch
```bash
gh run list --workflow docker-build.yml --repo ngojclee/cortex-hub --limit 5
gh run watch --repo ngojclee/cortex-hub
```

## Verification
- Open `/memories` and confirm cards show readable memory text instead of near-empty payloads
- Confirm project filtering still works on legacy and nested project metadata
- Confirm MCP root metadata includes the new `resources` list
- Confirm a client can read:
  - `cortex://projects`
  - `cortex://project/{projectId}/context`
  - `cortex://project/{projectId}/processes`
- Confirm `/health` reports version `0.3.0`

## Known Follow-Up
- Prompt wrappers are still pending:
  - `cortex_detect_impact`
  - `cortex_generate_map`
- Session enrichment is still pending:
  - top clusters
  - top processes
  - suggested files/resources/tools
- Shared metadata for files/symbols/processes/clusters is still pending
