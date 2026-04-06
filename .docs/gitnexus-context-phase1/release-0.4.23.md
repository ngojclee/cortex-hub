# Release Note: 0.4.23

## Scope
MCP public-discovery and auth-runtime parity release for Cortex Hub.

This batch fixes the main remote-connection regression where external MCP clients could reach `/mcp`, but the RFC 9728 protected-resource discovery endpoints still advertised the internal container origin (`http://cortex-mcp:8317/...`) instead of the public Cortex Hub URL. It also keeps the checked-in Portainer stack aligned with the live auth/session runtime wiring.

## Included Changes

### MCP Discovery Proxy Hardening
- `dashboard-api` now forwards `x-forwarded-host` and `x-forwarded-proto` when proxying:
  - `/mcp`
  - `/.well-known/oauth-protected-resource/mcp`
  - `/.well-known/oauth-protected-resource`
  - the related OAuth/OpenID discovery stubs
- `hub-mcp` now uses forwarded host/proto headers when generating protected-resource metadata, so remote clients see the public Cortex Hub origin instead of the internal container hostname

### Portainer Runtime Sync
- Synced `deploy/portainer/stack.yml` with the auth/session env wiring already present in `infra/docker-compose.yml`
- Added checked-in passthrough for:
  - `AUTH_ENABLED`
  - `AUTH_SESSION_TTL_HOURS`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`

### Tracking Updates
- Extended the GitNexus context-fabric plan with a dedicated Phase 5F for MCP public discovery and access parity
- Logged the pre-fix discovery failure and new verification expectations in the task tracker

## Images To Rebuild
- Required: `cortex-api`
- Required: `cortex-mcp`
- Not required: `cortex-gitnexus`

## Verification After Deploy
- `GET https://cortexhub.lengoc.me/api/auth/config` returns `{"enabled":true,"telegramConfigured":true}` when the host env is correct
- `GET https://cortexhub.lengoc.me/.well-known/oauth-protected-resource/mcp` returns:
  - `resource: "https://cortexhub.lengoc.me/mcp"`
  - not `http://cortex-mcp:8317/mcp`
- `GET https://cortexhub.lengoc.me/.well-known/oauth-protected-resource` returns the public Cortex Hub origin
- an external MCP client can connect through the public domain again and start surfacing a work session in `/sessions`
- `/health` continues reporting the expected version once the new image is live

## Notes
- This release fixes public MCP discovery metadata; it does not by itself remove Cloudflare Access from `/api/*` routes if that rule is still enabled upstream
- Existing stale sessions will not suddenly gain new connection metadata; new or refreshed work sessions will
