# Release Note: 0.4.5

## Scope
Patch release for GitNexus/Cortex code-intel trustworthiness after `0.4.4`.

This release focuses on two gaps observed on the live host:
- intel resource freshness could still report stale status from the older `gitnexus.indexedAt`
- project indexing could fall back to pure JS symbol extraction because native `gitnexus` CLI was not available inside `cortex-api`

## Included Changes
- Intel resource freshness now prefers the freshest valid timestamp from:
  - `gitnexus.indexedAt`
  - `projects.indexed_at`
  - latest `index_jobs.completed_at`
- project resource summaries now expose the preferred `indexedAt` instead of blindly preferring the GitNexus timestamp
- cluster and process resource responses now include a `hint` when labels collapse to `unknown`
- `cortex-api` image now bundles the `gitnexus` CLI for native indexing against the shared `/root/.gitnexus` registry
- index jobs now:
  - run `gitnexus analyze` locally inside `cortex-api`
  - apply a bounded heap via `GITNEXUS_HEAP_MB`
  - parse modern GitNexus output using `nodes` as the symbol count source
  - fall back to pure JS extraction only if native indexing is truly unavailable

## Git Checkpoint
- Target version: `0.4.5`
- Commit: `e2896a4`
- Branch: `master`

## Images To Rebuild Now
- Required: `cortex-api`
- Not required for this patch: `cortex-mcp`
- Not required for this patch: `cortex-gitnexus`

## Why This Release Matters
- `cortex://projects` and related intel resources should stop looking stale immediately after a fresh Cortex index job
- re-indexing from the dashboard should use native GitNexus analysis in `cortex-api` instead of the lower-quality regex fallback
- cluster/process resources should explain low-quality labeling more clearly when the graph still needs richer enrichment

## Suggested Deploy Flow
From the build/deploy host:

```bash
cd ~/cortex-hub
git pull origin master
docker compose build cortex-api
docker compose up -d cortex-api
```

If using GitHub Actions + Watchtower instead of local compose builds, trigger the normal image build flow and wait for the new `cortex-api` image to roll out before verification.

## Required Post-Deploy Action
Re-run indexing for the linked Cortex project after the new image is live.

```powershell
$body = @{
  branch = 'master'
  triggeredBy = 'manual'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://10.21.1.108:4000/api/projects/proj-44576c69/index" `
  -ContentType 'application/json' `
  -Body $body
```

## Verification Checklist
1. Health and version:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/health
```

Expected:
- `status = ok`
- `version = 0.4.5`
- `commit = e2896a4` or the auto-bumped commit built from it

2. Confirm the linked project no longer reports stale freshness from the old GitNexus timestamp:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/projects
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/proj-44576c69/context
```

Expected:
- `project.indexedAt` reflects the fresh Cortex indexing run
- `project.staleness.basedOn` prefers `cortex.indexed_at` or `cortex.index_jobs` when those are newer

3. Confirm native indexing path was used:

```powershell
Invoke-RestMethod "http://10.21.1.108:4000/api/projects/proj-44576c69/index/status"
```

Expected:
- log no longer says `Using pure JS symbol extraction (gitnexus CLI not available)`
- symbol/file counts are still populated

4. Re-check resource quality:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/proj-44576c69/clusters
Invoke-RestMethod http://10.21.1.108:4000/api/intel/resources/project/proj-44576c69/processes
```

Expected:
- responses may still include `hint` if graph naming is weak
- but freshness metadata should now be correct

## If Verification Fails
- If health is new but indexing still logs pure JS fallback:
  - inspect the `cortex-api` container image contents for `/usr/local/bin/gitnexus`
  - verify the container can write to the shared `/root/.gitnexus` volume
- If freshness still prefers the old GitNexus timestamp:
  - confirm the running image really contains commit `e2896a4`
  - confirm the re-index job completed after the new image was deployed

## Next Follow-Up After This Patch
- improve cluster/process naming quality beyond `unknown`
- start writing real `cortex_quality_report` records so the Quality dashboard stops showing empty-state metrics
