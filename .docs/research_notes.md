# Research Notes

## 2026-04-29 - Public MCP endpoint and Cloudflare bypass surface

Question: Which real endpoints are used by clients to connect to Cortex Hub MCP, and which paths need to remain public/bypassed?

Evidence:
- Local Codex config uses `REMOTE_MCP_URL = "https://cortexhub.lengoc.me/mcp"` with a Bearer Authorization header through `D:\Python\projects\scripts\remote-mcp-stdio-proxy.mjs`.
- Live authenticated `tools/list` against `https://cortexhub.lengoc.me/mcp` returned HTTP 200 with 29 tools.
- Unauthenticated `POST https://cortexhub.lengoc.me/mcp` returned HTTP 401, confirming Cloudflare/path access may be public but MCP itself still requires Bearer auth.
- Dashboard API exposes `/health` and reverse-proxies `/mcp` to `MCP_INTERNAL_URL` (`http://cortex-mcp:8317`).
- Dashboard API forwards only these well-known MCP discovery paths: `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, and `/.well-known/openid-configuration`.

Findings:
- Canonical public MCP endpoint is `POST https://cortexhub.lengoc.me/mcp`.
- Public health endpoint is `GET https://cortexhub.lengoc.me/health` on dashboard-api, which includes optional `mcp` service status.
- MCP upstream inside Docker is `http://cortex-mcp:8317/mcp`; clients outside Docker should not use it.
- MCP service-to-dashboard internal API is `http://cortex-api:4000` via `DASHBOARD_API_URL`.
- `/api/auth/*`, `/mcp`, and `/.well-known/*` are bypassed by dashboard session auth middleware, but `/mcp` is still protected by MCP Bearer auth.

Recommendation:
- Keep Cloudflare Access bypass/public hostname rules for `/mcp`, `/health`, the specific `/.well-known/...` discovery paths, and `/api/auth/*` if dashboard login approval remains enabled.
- Treat `cortexhub.lengoc.me/.well-known/*` as a Cloudflare convenience wildcard; the app currently implements only the four discovery paths listed above.

## 2026-04-29 - Cloudflare Access bypass minimization

Question: Which public endpoints should be bypassed to keep MCP working without overexposing dashboard/admin APIs?

Evidence:
- Live probe showed `GET /api/auth/sessions` returned dashboard auth session records when `/api/auth/*` was bypassed.
- Live probe showed `DELETE /api/auth/sessions` returned `200` and revoked an active dashboard session when `/api/auth/*` was bypassed.
- Dashboard auth middleware bypasses any path starting with `/api/auth/`, while `authRouter` includes session list/revoke routes under that prefix.
- MCP itself only needs `/mcp`, OAuth discovery metadata, and Bearer-protected internal calls from `cortex-mcp` to `cortex-api` inside Docker.

Findings:
- Do not bypass `/api/auth/*` at Cloudflare Access level in the current codebase.
- Bypass only the specific dashboard auth endpoints needed for public login flow, if Cloudflare Access is not protecting the dashboard login itself.

Recommendation:
- Minimal safe bypass: `/mcp`, `/health`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, and `/.well-known/openid-configuration`.
- Optional login-flow bypass only if needed: `/api/auth/config`, `/api/auth/request`, `/api/auth/status/*`, `/api/auth/approve/*`, `/api/auth/deny/*`, `/api/auth/validate`, and `/api/auth/logout`.
- Keep these blocked behind Cloudflare Access until app-level auth is tightened: `/api/auth/sessions`, `/api/auth/sessions/*`, `/api/keys/*`, `/api/setup/*`, and dashboard UI/admin pages.

## 2026-04-29 - Cloudflare Access bypass minimization

Question: Which public/bypass endpoints are needed for MCP to work while keeping dashboard/API routes secure?

Evidence:
- Live MCP endpoint works with Bearer auth on `POST https://cortexhub.lengoc.me/mcp`.
- MCP discovery works through `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource`; unsupported OAuth/OpenID endpoints intentionally return 404.
- `GET /api/auth/config` is public and returns dashboard auth configuration.
- Bypassing all `/api/auth/*` exposes `GET /api/auth/sessions` and session revocation endpoints. A live probe showed `DELETE /api/auth/sessions` can revoke approved dashboard sessions without additional app-level auth if Cloudflare bypasses this path.

Findings:
- Do not use a blanket Cloudflare Access bypass for `/api/auth/*`.
- MCP itself only needs `/mcp` and the MCP OAuth discovery metadata paths to be reachable without Cloudflare Access; MCP Bearer auth still protects tool calls.
- `/health` is useful for monitoring but not required for MCP protocol operation.

Recommendation:
- Replace `/api/auth/*` bypass with exact-path bypasses only if dashboard app-level Telegram auth is intended to work without Cloudflare Access: `/api/auth/config`, `/api/auth/request`, `/api/auth/status/*`, `/api/auth/approve/*`, `/api/auth/deny/*`, `/api/auth/validate`, and `/api/auth/logout`.
- Keep `/api/auth/sessions` and `/api/auth/sessions/*` behind Cloudflare Access until those routes enforce admin/session auth in application code.

## 2026-05-02 - GitNexus Explorer UI research

Question: Should Cortex adopt GitNexus-style graph UI patterns, and do they help AI or only humans?

Evidence:
- GitNexus web uses `sigma`, `graphology`, ForceAtlas2 worker layout, noverlap, and curved edge rendering in `.references/GitNexus/gitnexus-web/src/hooks/useSigma.ts`.
- GitNexus converts its `KnowledgeGraph` into graphology nodes/edges with type colors, sizes, community colors, hierarchy-based initial positions, and edge styling in `.references/GitNexus/gitnexus-web/src/lib/graph-adapter.ts`.
- GitNexus exposes node search, node type filters, edge type filters, and focus depth controls in `.references/GitNexus/gitnexus-web/src/components/Header.tsx` and `.references/GitNexus/gitnexus-web/src/components/FileTreePanel.tsx`.
- GitNexus streams large graph payloads as NDJSON from `/api/graph?stream=true` and parses nodes/relationships incrementally in `.references/GitNexus/gitnexus/src/server/api.ts` and `.references/GitNexus/gitnexus-web/src/services/backend-client.ts`.
- Cortex currently has a D3/SVG `ForceGraph` optimized for high-level architecture clusters/processes/knowledge, not dense raw graph exploration.
- GitNexus repo license is PolyForm Noncommercial, so Cortex should copy patterns/architecture only, not source code.

Findings:
- Sigma/graphology is useful for Cortex Explorer View because it can render dense graphs better than D3/SVG.
- The bigger AI value is not the visual canvas itself; it is the bounded graph slice/search/filter API behind it.
- AI-facing graph tools should let agents find relevant files/symbols and blast radius before reading raw code.
- Explorer UI remains valuable for humans because it shows the same graph slice agents used, making AI reasoning inspectable.

Recommendation:
- Add Explorer as a second `/graph` mode beside the existing Architecture View.
- Implement graph API/MCP tools first: graph search, graph slice, file neighbors, symbol brief.
- Use `sigma.js + graphology` for the browser Explorer, backed by server-side caps and filters.
- Pair graph slices with Caveman-inspired compaction so agents receive compact symbol/file briefs and raw fallback remains available.

## 2026-05-02 - Cortex agent ladder MCP readiness

Question: Does live Cortex MCP already support the proposed standard agent ladder?

Evidence:
- Live MCP `tools/list` returned: `cortex_session_start`, `cortex_memory_search`, `cortex_knowledge_search`, `cortex_code_search`, `cortex_code_context`, `cortex_code_read`, `cortex_code_tree`, `cortex_cypher`, `cortex_code_impact`, `cortex_detect_changes`, `cortex_quality_report`, `cortex_memory_store`, `cortex_knowledge_store`, and `cortex_session_end`.
- Live MCP does not yet expose dedicated tools named `cortex_graph_search`, `cortex_graph_slice`, `cortex_file_neighbors`, or `cortex_symbol_brief`.

Findings:
- The proposed ladder is usable today with fallbacks.
- Dedicated graph tools are still worth adding because they encode bounded AI-first graph slices instead of forcing agents to assemble them from lower-level code/cypher tools.

Recommendation:
- Document the current ladder and fallback mapping in `.docs/guides/agent-cortex-workflow.md`.
- Update plan/task to make graph tools explicit planned gaps, not assumed current capabilities.
