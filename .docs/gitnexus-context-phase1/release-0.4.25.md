# Release Note: 0.4.25

## Scope
Settings/runtime-branding and graph-drilldown release for Cortex Hub.

This batch cleans up operator-facing product metadata in Settings and pushes the graph page beyond a static overview by adding process-step detail and a lightweight Cypher playground.

## Included Changes

### Settings / About Normalization
- `Settings > About` now reads the runtime version from live health data instead of falling back to the stale `v0.1.0` placeholder
- The About card tagline is aligned with the current README positioning:
  - `Self-hosted AI Agent Intelligence Platform`
  - `Unified MCP gateway · Persistent memory · Code intelligence · Quality enforcement`
- Added runtime metadata chips for:
  - host
  - short commit
  - build time
- Updated links so `Documentation` points to the repo docs instead of the non-existent `/docs` route
- Added an explicit `MCP` link alongside GitHub / Documentation / Dashboard
- `/api/setup/settings` now reads `version.json`, so the Environment card and About section stay in sync

### Graph: Process Detail
- Clicking a process node now opens a process detail sidebar
- The sidebar shows:
  - process type
  - total steps
  - ordered process steps
  - file path and node type for each step when available

### Graph: Cypher Playground
- Added a read-only Cypher playground to `/graph`
- Includes starter presets for:
  - top processes
  - cluster nodes
  - step flow inspection
- Query output is rendered directly in the dashboard for operator debugging

### Runtime Verification Notes
- Public MCP discovery is now live:
  - `/.well-known/oauth-protected-resource/mcp` returns `https://cortexhub.lengoc.me/mcp`
- Public `/api/sessions/all` still redirects through Cloudflare Access, so session visibility from the public internet remains an operator policy/config question rather than a transport bug

## Images To Rebuild
- Required: `cortex-api`
- Not required: `cortex-mcp`
- Not required: `cortex-gitnexus`

## Verification After Deploy
- `Settings > Environment` and `Settings > About` both show `v0.4.25`
- `Settings > About` shows the live short commit and build timestamp
- `Documentation` opens the GitHub-hosted docs instead of a broken `/docs` route
- In `/graph`, clicking a process node shows ordered step details
- In `/graph`, the Cypher playground can run a preset query and render output without leaving the dashboard

## Notes
- This release does not change Cloudflare Access rules; `/api/*` routing policy still needs to be decided separately if you want public curl diagnostics for session endpoints
