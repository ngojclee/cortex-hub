# Release Note: 0.4.11

## Scope
Fix the stale-deploy version gap (0.4.6 → 0.4.11) and resolve two remaining operational blockers:
- false-positive `degraded` health status caused by optional-service timeouts
- GitNexus CLI not working inside the cortex-api Docker container

## Included Changes

### Health Check Tiering
- Split services into **core** (qdrant, mem9) and **optional** (cliproxy, gitnexus, mcp)
- Only core services affect the overall `status` field — optional failures no longer cause `degraded`
- Added `notice` field when optional services are down but core is operational
- Increased GitNexus health probe timeout from 3s to 8s (accounts for its slow startup)
- Accept 403 alongside 401 for cliproxy authenticated probes
- Dashboard sidebar now shows "Core degraded" only for genuine core failures

### GitNexus CLI Native Indexing Fix
- Fixed Dockerfile to copy ALL hoisted global node_modules (tree-sitter-*, onnxruntime-node, @ladybugdb/core, etc.), not just the gitnexus package directory
- Previous builds only copied `/usr/local/lib/node_modules/gitnexus` — missing sibling dependencies caused the CLI to fail silently, falling back to pure JS regex extraction
- Native CLI provides Tree-sitter AST analysis vs regex-only extraction, significantly improving symbol quality

## Images To Rebuild
- Required: `cortex-api` (includes both health fix and GitNexus CLI fix)
- Optional: `cortex-mcp` if latest MCP schemas are also desired

## Verification After Deploy
- `/health` should show `version: 0.4.11` and `status: ok` even if gitnexus/mcp are slow to start
- Re-index a project and check logs — should say "GitNexus CLI" instead of "pure JS symbol extraction"
- Compare symbol counts before/after re-indexing

## Remaining Open Work After 0.4.11
- Smoke-test MCP resources from a real client session
- Re-run indexing after GitNexus CLI fix and compare symbol/process/cluster quality
- Keep `cortex_code_rename` deferred until data contracts are stable
