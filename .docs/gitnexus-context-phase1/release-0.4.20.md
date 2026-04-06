# Release Note: 0.4.20

## Scope
Operational auth and session observability release for Cortex Hub.

This batch fixes the mismatch between what the host is actually doing and what the dashboard tells the operator:
- auth envs existed in code but were not wired through Docker runtime
- `/sessions` only showed dashboard login sessions, not agent/API/MCP work sessions
- session history did not clearly tell which app, transport, machine, or user agent created a connection

## Included Changes

### Auth Runtime Wiring
- Added runtime env passthrough for:
  - `AUTH_ENABLED`
  - `AUTH_SESSION_TTL_HOURS`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- Documented the same vars in [`.env.example`](/d:/Python/projects/cortex-hub/infra/.env.example)

### Dashboard Logout UX
- Added a visible `Log out` control in the sidebar when auth is enabled and the current session is approved
- Sidebar now shows the signed-in email so the operator can tell whether dashboard auth is actually active

### Sessions Page Split
- Reworked `/sessions` to show two distinct surfaces:
  - `User Login Sessions`
  - `Agent / API / MCP Connections`
- This resolves the misleading `No Active Sessions` empty state when auth sessions are empty but work sessions still exist

### Connection Source Metadata
- Extended the shared metadata contract with optional:
  - `connection.transport`
  - `connection.clientApp`
  - `connection.clientHost`
  - `connection.clientUserAgent`
  - `connection.clientIp`
- `hub-mcp` now forwards client/source headers into `dashboard-api`
- new and refreshed sessions persist connection metadata so session history can answer:
  - which app connected
  - over which transport
  - from which host/IP when available

## Images To Rebuild
- Required: `cortex-api`
- Required: `cortex-mcp`
- Not required: `cortex-gitnexus`

## Verification After Deploy
- `GET /api/auth/config` should return `enabled=true` if the host `.env` really sets `AUTH_ENABLED=true`
- Sidebar should show signed-in email + `Log out` button when auth is enabled and approved
- `/sessions` should show:
  - dashboard login sessions under `User Login Sessions`
  - agent/API/MCP work sessions under `Agent / API / MCP Connections`
- active MCP sessions should display transport/app/source fields when available

## Notes
- This release does not auto-enable auth by itself; the host still needs the correct `.env` values before rebuild/redeploy
- Existing old sessions may not have rich connection metadata yet; new or refreshed sessions will fill it in
