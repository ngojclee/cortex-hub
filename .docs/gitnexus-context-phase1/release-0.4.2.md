# Release Note: 0.4.2

## Scope
Phase 4 release for the shared cross-app metadata contract, plus post-deploy verification.

## Included Changes
- Canonical `shared_metadata` contract added for:
  - sessions
  - quality reports
  - query logs
  - change events
  - mem9 metadata
- `cortex_session_start` now persists a session snapshot with shared project vocabulary when project context is available
- Dashboard and MCP payloads now expose the same metadata shape:
  - `projectId`
  - `branch`
  - `filesTouched`
  - `symbolsTouched`
  - `processesAffected`
  - `clustersTouched`
  - `resourceUris`
- Task tracking updated after live deploy verification

## Live Verification
- Health endpoint:
  - `GET /health`
  - Expected on 2026-04-05: version `0.4.2`, commit `5c0a92d`
- GitNexus repo visibility:
  - `GET /api/intel/repos`
  - Current result: `cortex-hub` is indexed in GitNexus
- Cortex resource visibility:
  - `GET /api/intel/resources/projects`
  - Current result: still empty until a Cortex project row is created and linked

## Important Operational Note
This release is healthy, but graph/resources will still look empty on a fresh instance until at least one project is created in Cortex and linked to a repository URL.

## Next Operator Actions
1. Create or confirm a project in the default org:
   - org id: `org-default`
2. Link the project to the repo URL:
   - `https://github.com/ngojclee/cortex-hub.git`
3. Re-run indexing for that project if needed
4. Verify:
   - `/api/projects`
   - `/api/intel/resources/projects`
   - `/api/intel/resources/project/{projectId}/context`
   - `/api/intel/resources/project/{projectId}/clusters`
   - `/api/intel/resources/project/{projectId}/processes`
5. Smoke-test `shared_metadata` persistence through session start/end

## Current Recommendation
Do not build a visual graph explorer yet.
Stabilize:
- project linking
- resource smoke tests
- shared metadata flow

Then decide whether a graph page is still needed.
