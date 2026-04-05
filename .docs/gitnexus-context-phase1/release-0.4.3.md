# Release Note: 0.4.3

## Scope
Provider-model observability update for the dashboard, plus a clearer empty state for Quality Gates.

## Included Changes
- Added live routing tests for the active `chat` and `embedding` model chains
- Providers page now shows explicit buttons:
  - `Test Chat Live`
  - `Test Embedding Live`
- Live test results now show:
  - active model
  - provider/account name
  - latency
  - short reply for chat
  - vector dimension count for embeddings
- Dashboard home now explains why `Quality Gates` can show `N/A / 0 / 0`
  - there are no `quality_reports` yet
  - agents must submit `cortex_quality_report`

## Backend Changes
- New endpoint:
  - `POST /api/llm/routing/test/chat`
  - `POST /api/llm/routing/test/embedding`
- These tests use the currently active `model_routing` chain, not just a generic provider ping

## Frontend Changes
- `Providers` page exposes live routing tests inside the Active Config panel
- Dashboard `Quality Gates` card shows an empty-state hint instead of looking broken

## Verification
- `pnpm --filter @cortex/dashboard-api typecheck`
- `pnpm --filter @cortex/dashboard-web typecheck`

## Deploy Checklist
1. Push `master`
2. Wait for GitHub Actions Docker build to finish
3. Pull the latest image on the Docker host
4. Verify:
   - `GET /health`
   - open `Providers`
   - click `Test Chat Live`
   - click `Test Embedding Live`
   - confirm the Quality card shows the new hint when there are no reports

## Expected Result After Deploy
- You can tell immediately whether the active chat model is responding
- You can tell immediately whether the active embedding model is returning vectors
- You no longer have to guess whether `Quality Gates` is broken or simply has no data
