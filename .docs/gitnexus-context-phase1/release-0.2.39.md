# Release Note: 0.2.39

## Scope
Patch release for the `/memories` dashboard issue where the frontend requested `/api/mem9-proxy/*` and received HTML instead of JSON.

## Included Changes
- Frontend now uses `/api/mem9/*`
- Dashboard API exposes `/api/mem9-proxy/*` as a backward-compatible alias
- GitNexus context integration Phase 1 plan and task docs added under `.docs/gitnexus-context-phase1/`

## Git Checkpoint
- Version: `0.2.39`
- Commit: `1a112fe`
- Branch: `master`

## Images To Rebuild Now
- Required: `cortex-api`
- Optional: `cortex-mcp` only if you want a fresh matched release set
- Not required for this hotfix: `cortex-gitnexus`

## Suggested Commands
From the Docker build host:

```bash
cd ~/cortex-hub
git pull origin master

COMMIT_SHA=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

docker build \
  -f infra/Dockerfile.dashboard-api \
  --build-arg COMMIT_SHA="$COMMIT_SHA" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t ghcr.io/ngojclee/cortex-api:latest \
  -t ghcr.io/ngojclee/cortex-api:$COMMIT_SHA \
  .

docker push ghcr.io/ngojclee/cortex-api:latest
docker push ghcr.io/ngojclee/cortex-api:$COMMIT_SHA
```

## Verification
- Open `/memories`
- Confirm there is no `Unexpected token '<'` error
- Confirm `GET /api/mem9/list?limit=1` returns JSON
- Confirm `/health` reports version `0.2.39`

## Next Feature Release
After this patch is stable, continue with the GitNexus context fabric work:
- project resources
- process and cluster resources
- prompts
- session metadata enrichment
