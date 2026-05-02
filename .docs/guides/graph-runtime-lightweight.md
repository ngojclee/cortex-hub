# Graph Runtime Lightweight Runbook

## Purpose

This runbook defines the snapshot-first graph runtime for Cortex Hub. The goal is to keep `/graph` and MCP graph tools useful for agents while preventing default UI or MCP calls from waking GitNexus for broad realtime graph work.

## Runtime Principle

GitNexus is the indexing and refresh engine. Dashboard API is the serving runtime.

Default read path:

```text
UI or MCP graph request
-> resolve Cortex project from SQLite
-> map project to GitNexus repo by registry/cache data
-> read bounded graph snapshot/cache
-> apply server-side filters and caps
-> return slice metadata
```

Realtime GitNexus calls are explicit fallback operations, not the default request path.

## Safe Defaults

- Do not call GitNexus `list_repos` or broad `cypher` on page load.
- Do not fetch an unbounded full graph into the browser or an MCP response.
- Use registry-first project/repo matching before attempting live GitNexus probes.
- Serve snapshots or cached slices for default graph, search, neighbor, and symbol-brief requests.
- Require explicit refresh for stale or missing snapshots.
- Keep graph responses bounded by `limitNodes`, `limitEdges`, and `depth`.
- Default Explorer requests should be small: search first, then click-to-expand.
- Health checks must stay lightweight and must not wait on GitNexus graph queries.

## Snapshot Contract

The bounded graph endpoint remains:

```text
GET /api/intel/resources/project/:projectId/graph
```

Supported query parameters:

- `nodeTypes`: comma-separated node type allowlist.
- `edgeTypes`: comma-separated edge type allowlist.
- `focus`: node id, symbol name, or file path for a neighborhood slice.
- `search`: text match for candidate files/symbols.
- `community`: optional architecture/community filter.
- `depth`: traversal depth, capped server-side.
- `direction`: `upstream`, `downstream`, or `both`.
- `limitNodes`: maximum returned nodes, capped server-side.
- `limitEdges`: maximum returned edges, capped server-side.
- `format`: `json` or `ndjson`.

Response data must include these stable fields:

```json
{
  "uri": "cortex://project/<projectId>/graph",
  "project": {},
  "repo": "cortex-hub",
  "query": {},
  "nodes": [],
  "edges": [],
  "visibleCounts": { "nodes": 0, "edges": 0 },
  "totalCounts": { "nodes": 0, "edges": 0 },
  "truncated": false,
  "capReason": [],
  "snapshot": {
    "source": "snapshot",
    "snapshotHit": true,
    "cacheHit": false,
    "stale": false,
    "generatedAt": "2026-05-03T00:00:00.000Z",
    "expiresAt": "2026-05-03T00:05:00.000Z",
    "refreshAvailable": true
  },
  "hint": null
}
```

`snapshot.source` values:

| Value | Meaning |
| --- | --- |
| `snapshot` | Served from a persisted graph snapshot. Preferred default. |
| `cache` | Served from an in-memory or short-lived cache. Acceptable default. |
| `registry` | Served from registry/project metadata only, usually zero or summary data. |
| `live-fallback` | Served by an explicit GitNexus query because no acceptable snapshot was available. |

When a response is partial, set `truncated=true` and explain every cap in `capReason`. Agents and UI must narrow the request instead of retrying broader calls.

## Snapshot Lifecycle

Snapshots are refreshed by indexing or an explicit operator/agent refresh action.

1. Project indexing completes or an operator requests refresh.
2. Dashboard API resolves the canonical repo from Cortex project metadata and GitNexus registry entries.
3. Dashboard API asks GitNexus for the minimum graph data needed to build a reusable snapshot.
4. Snapshot metadata records project id, repo alias, branch, commit or indexed timestamp when available, node/edge totals, and generated time.
5. Runtime graph requests read the snapshot and apply filters/caps locally.

Staleness policy:

- Fresh enough for UI browsing: current snapshot exists and project/index metadata has not advanced beyond it.
- Stale but usable: return snapshot with `snapshot.stale=true` and a hint to refresh.
- Missing snapshot: return zero/metadata response or require explicit refresh. Do not silently run broad live graph queries.

## Alias Drift Cleanup

Alias drift happens when GitNexus registry contains multiple names for one repository, or stale repo entries remain after projects are renamed or deleted. It causes wrong project matching and can make graph pages probe too many aliases.

Always preview first:

```powershell
$headers = @{ Authorization = "Bearer $env:CORTEX_ADMIN_API_KEY" }
Invoke-RestMethod -Headers $headers http://<host>:4000/api/intel/admin/gitnexus-audit

$body = @{ mode = 'preview'; includeUnmapped = $true } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Uri http://<host>:4000/api/intel/admin/gitnexus-cleanup `
  -Body $body
```

Apply only after reviewing operations:

```powershell
$body = @{
  mode = 'apply'
  includeUnmapped = $true
  deleteStorage = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Uri http://<host>:4000/api/intel/admin/gitnexus-cleanup `
  -Body $body
```

Project metadata cleanup is separate and also preview-first:

```powershell
$body = @{
  mode = 'preview'
  clearRepoUrlForUmbrella = $true
  clearLatestIndexHint = $true
  normalizeBlankRepoUrl = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Uri http://<host>:4000/api/intel/admin/project-cleanup `
  -Body $body
```

Admin access requires a dashboard session or an API key with an admin-capable scope/permission such as `admin`, `owner`, `system`, `write`, `full`, `admin:write`, `project:write`, or `knowledge:write`.

## Deploy And Redeploy Runbook

Before deploy:

```powershell
cd D:\Python\projects\cortex-hub
git status --short --branch
pnpm build
pnpm typecheck
pnpm lint
```

On the Docker host:

```bash
cd ~/cortex-hub
docker compose pull
docker compose up -d
docker compose ps
```

After deploy, verify lightweight health first:

```powershell
Invoke-RestMethod http://<host>:4000/health
Invoke-RestMethod http://<host>:4000/api/intel/resources/projects
```

Then verify graph runtime with a narrow request:

```powershell
Invoke-RestMethod "http://<host>:4000/api/intel/resources/project/<projectId>/graph?search=GraphExplorer&limitNodes=25&limitEdges=50&depth=1"
```

Expected:

- `success=true`.
- `visibleCounts.nodes` is bounded.
- `truncated` and `capReason` explain caps when present.
- Snapshot metadata says `snapshotHit=true` or `source=cache` for normal reads.
- GitNexus container CPU does not spike during normal page load.

If `/graph` still spikes GitNexus CPU:

1. Stop broad UI polling or keep the graph page closed.
2. Confirm alias drift cleanup preview has no surprising duplicate aliases.
3. Confirm the request includes `search`, `focus`, low `depth`, and limits.
4. Confirm runtime uses snapshot/cache path rather than live fallback.
5. Rebuild snapshots by re-indexing the affected project or using the explicit refresh action once available.

## MCP Graph Usage Policy

Agents should use graph tools to choose files/symbols before raw code reads.

Preferred order:

```text
cortex_graph_search(query, limit)
-> cortex_graph_slice(focus, depth=1 or 2, low limits)
-> cortex_file_neighbors(filePath) or cortex_symbol_brief(symbol)
-> cortex_code_read only selected files
-> cortex_code_impact before editing shared code
```

Policy rules:

- Use `cortex_graph_search` for candidates. Keep `limit` small.
- Use `cortex_graph_slice` for bounded neighborhoods. Default to `depth=1` or `depth=2`.
- Use `cortex_file_neighbors` for one known file, not for repo-wide browsing.
- Use `cortex_symbol_brief` with `includeRaw=false` by default.
- Set `includeRaw=true` only when compact graph context is insufficient.
- Respect `snapshotHit`, `stale`, `truncated`, and `capReason`.
- If `truncated=true`, narrow filters instead of increasing limits immediately.
- Do not use direct `cortex_cypher`, `cortex_list_repos`, or broad raw code reads for first-pass discovery unless graph tools are unavailable or an operator explicitly asks for live diagnostics.
- Do not trigger explicit graph refresh from an MCP tool unless the user has asked for fresh index data or stale data would be unsafe.

## Operator Troubleshooting

| Symptom | Likely Cause | Action |
| --- | --- | --- |
| `/graph` slow on first open | UI requested broad graph or live fallback | Use small search/focus request; disable polling; confirm snapshot metadata. |
| Wrong project graph appears | GitNexus alias drift | Run `gitnexus-audit`, preview cleanup, apply reviewed cleanup. |
| Empty graph but project exists | Project not indexed or snapshot missing | Re-index project; confirm GitNexus registry entry; return zero graph without live broad query. |
| Stale graph warning | Snapshot older than current project/index metadata | Use explicit refresh/re-index; keep serving stale snapshot with warning until refreshed. |
| GitNexus health flapping | Runtime requests hitting live Cypher/list paths | Keep health lightweight; move graph page/tools to snapshot/cache reads. |

## Rollout Checklist

- [ ] Backend graph runtime serves default graph reads from snapshot/cache/registry, not broad live GitNexus.
- [ ] Response includes `visibleCounts`, `totalCounts`, `truncated`, `capReason`, and snapshot metadata.
- [ ] MCP graph tools surface snapshot/stale/truncation metadata and keep defaults bounded.
- [ ] Explorer page starts with no heavy polling and uses search/click-to-expand.
- [ ] Alias cleanup preview/apply documented and verified on staging or live host.
- [ ] Deploy verification includes health, resources, narrow graph request, and CPU observation.
