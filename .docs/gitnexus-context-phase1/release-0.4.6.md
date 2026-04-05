# Release Note: 0.4.6

## Scope
UX and session-context release for the next Cortex dashboard checkpoint.

This release bundles two operator-facing improvements that are already implemented locally and typechecked:
- reused sessions now refresh their `mode` and stored session context correctly instead of staying stuck on older `development` data
- the dashboard gets a lightweight `/graph` explorer so operators can inspect project context, clusters, and processes without dropping into raw resource JSON

## Included Changes
- `POST /api/sessions/start` now normalizes and persists the latest requested session mode on both new and reused sessions
- reused sessions now refresh:
  - `task_summary`
  - `context`
  - `project_id`
  - `shared_metadata`
- `GET /api/sessions/all` now exposes a parsed `mode` field for dashboard/UI consumers
- `cortex_session_start` tool guidance now explicitly includes `production` mode
- Sessions UI now shows a mode badge in both the card view and detail panel
- Dashboard now includes a new `/graph` page with:
  - linked-project picker
  - freshness/index stats
  - lightweight context graph canvas
  - top clusters list
  - top processes list
  - current index-quality hints when labels are still weak
- Sidebar now links to the new Graph page

## Git Checkpoint
- Target version: `0.4.6`
- Commit: `TBD after checkpoint commit is created`
- Branch: `master`

## Images To Rebuild Now
- Required: `cortex-api`
- Required: `cortex-mcp`
- Not required for this release: `cortex-gitnexus`

## Why This Release Matters
- Operators can finally trust that a restarted or reused session reflects the latest intended mode such as `production`
- The graph feature is shipped in a low-risk form that is useful now, without waiting for a full visual graph system
- This keeps the next release focused on data quality instead of mixing UI and indexing/runtime work together

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
1. Health and version:

```powershell
Invoke-RestMethod http://10.21.1.108:4000/health
```

Expected:
- `status = ok`
- `version = 0.4.6` or the next auto-bumped patch
- `commit` matches the checkpoint commit or the auto-bump commit built from it

2. Verify the session-mode fix:

```powershell
$body = @{
  repo = 'https://github.com/ngojclee/cortex-hub.git'
  mode = 'production'
  agentId = 'release-check'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://10.21.1.108:4000/api/sessions/start' `
  -ContentType 'application/json' `
  -Body $body

Invoke-RestMethod http://10.21.1.108:4000/api/sessions/all
```

Expected:
- the session response reports `mode = production`
- the same session listed in `/api/sessions/all` also shows `mode = production`
- `task_summary` is refreshed to `Session started: mode=production`

3. Verify the new graph page:

Open:
- `/graph`

Expected:
- the page loads without a frontend error
- the linked project selector is visible
- stat cards render with freshness/index numbers
- the SVG graph canvas renders
- cluster/process lists render even if some labels are still generic

4. Verify sidebar navigation:

Expected:
- sidebar includes `Graph`
- `Graph` route highlights correctly when active

## Known Limitation In This Release
- This release improves graph visibility, not graph quality
- if process or cluster names still show as `unknown`, the next follow-up release should target native GitNexus enrichment and labeling quality instead of more graph UI

## Recommended Next Release After 0.4.6
- improve process/cluster naming quality beyond `unknown`
- finish health-check parity tightening
- make `cortex_quality_report` part of the normal workflow so the Quality dashboard starts showing real scores
