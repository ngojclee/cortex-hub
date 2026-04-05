# Release Note: 0.4.8

## Scope
Graph and project-discovery release for Cortex Hub after `0.4.6`.

This batch closes three related gaps together:
- GitNexus Cypher responses with Markdown tables were not being parsed correctly by Cortex, causing clusters and processes to collapse into `unknown`
- orphan repos or knowledge-only project spaces were not visible as first-class candidates, so operators had no direct path to promote them into Cortex projects
- the first graph UI was too rigid and degraded quickly when branch counts grew beyond a tiny demo set

## Included Changes
- `dashboard-api` now parses GitNexus Cypher Markdown-table responses correctly
- intel resources now expose project discovery candidates for:
  - unlinked GitNexus repos
  - local repo folders under the repos directory
  - knowledge-only project identifiers not yet represented in the `projects` table
- Cortex now provides a promotion endpoint so discovered candidates can be turned into first-class projects from the graph workflow
- project resource summaries now include knowledge counts
- `/graph` now ships with:
  - discovery cards for orphan repos / knowledge spaces
  - one-click project linking
  - knowledge-aware stats
  - orbit-style graph layout that handles more branches more gracefully than the original fixed two-column mockup

## Expected User-Facing Result
- repos such as `camera-connect` should become visible as discovery candidates instead of silently staying outside the project model
- operators can promote those candidates into real Cortex projects without digging through raw API calls
- graph cards and process/cluster side lists should become more meaningful once the Cypher parser fix is live
- the graph layout should read better when more clusters/processes are present

## Git Checkpoint
- Target version: `0.4.8`
- Commit: `c34e0f8`
- Branch: `master`

## Images To Rebuild Now
- Required: `cortex-api`
- Required: `cortex-mcp`
- Not required for this release: `cortex-gitnexus`

## Suggested Deploy Flow
From the build/deploy host:

```bash
cd ~/cortex-hub
git pull origin master
docker compose build cortex-api cortex-mcp
docker compose up -d cortex-api cortex-mcp
```

If using GitHub Actions + Watchtower instead of local compose builds, push the checkpoint and wait for the normal image rollout before verification.

## Verification Checklist
1. Confirm health:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/health
```

Expected:
- `status = ok`
- `version = 0.4.8` or the next auto-bumped patch

2. Verify discovery candidates:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/discovery
```

Expected:
- unlinked repos and/or knowledge-only project spaces appear in `candidates`
- each candidate shows one or more `sourceKinds`

3. Verify linking flow:

```powershell
$body = @{
  slug = 'camera-connect'
  name = 'Camera Connect'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://10.21.1.108:4000/api/intel/resources/discovery/link' `
  -ContentType 'application/json' `
  -Body $body
```

Expected:
- a new Cortex project is created or an existing one is returned
- `/api/intel/resources/projects` includes the linked project afterward

4. Verify graph data quality:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/proj-44576c69/clusters
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/proj-44576c69/processes
```

Expected:
- clusters/processes should stop collapsing to generic `unknown` when GitNexus already has real names

5. Verify UI:

Open:
- `/graph`

Expected:
- discovery cards are visible when unlinked candidates exist
- linked project stats include knowledge counts
- graph layout feels stable with larger branch counts

## Next Follow-Up After 0.4.8
- tighten health-check parity for operator trust
- make `cortex_quality_report` part of the normal workflow
- keep improving true graph enrichment only if raw GitNexus data remains weak after this parser/discovery release
