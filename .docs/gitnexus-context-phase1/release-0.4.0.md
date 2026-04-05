# Release Note: 0.4.0

## Scope
Minor release for GitNexus context-fabric Phase 3 inside Cortex Hub.

## Included Changes
- `hub-mcp` now exposes first-class MCP prompts:
  - `cortex_detect_impact`
  - `cortex_generate_map`
- `cortex_session_start` now enriches new sessions with a shared context fabric:
  - top clusters
  - top processes
  - suggested files
  - suggested resources
  - suggested next tools/workflow
- Prompt and session enrichment now reuse a single context-fabric helper so resources, prompts, and sessions stay aligned
- Agent workflow documentation added for discovery -> overview -> deep dive -> action

## Version
- Version: `0.4.0`
- Release type: `minor`

## Images To Rebuild
- Required: `cortex-mcp`
- Not required: `cortex-api`
- Not required: `cortex-gitnexus`

## GitHub Actions Build
### Preferred
Push the release commit to `master`. The repository workflows will build and publish the updated image set automatically.

### Manual Trigger
```bash
gh workflow run docker-build.yml --repo ngojclee/cortex-hub
```

## Verification
- Confirm the MCP root metadata lists the new prompts:
  - `cortex_detect_impact`
  - `cortex_generate_map`
- Confirm `cortex_session_start` now returns:
  - `contextFabric`
  - `sessionSnapshot`
  - `suggestedNext`
- Confirm a client can fetch prompt templates for:
  - `cortex_detect_impact`
  - `cortex_generate_map`
- Confirm `cortex://project/{projectId}/context` and the prompt/session output stay aligned on clusters, processes, and suggested resources

## Known Follow-Up
- Shared cross-app metadata is still pending:
  - `filesTouched`
  - `symbolsTouched`
  - `processesAffected`
  - `clustersTouched`
- `cortex_code_rename` is still deferred
- Visual graph explorer is still deferred
