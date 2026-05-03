# GitNexus Low-Load Runbook

This runbook is for small Cortex deployments where GitNexus must stay responsive while projects are indexed sequentially.

## Recommended 3 vCPU Profile

Use the GitNexus container as the pressure valve, not Qdrant or MCP.

- `GITNEXUS_CPUS=2.0`
- `GITNEXUS_MEM_LIMIT=3g`
- `NODE_OPTIONS=--max-old-space-size=2048`
- `GITNEXUS_STARTUP_INDEXING=true`
- `GITNEXUS_STARTUP_INDEXING_DELAY_SECONDS=15`
- `GITNEXUS_AUTO_DISCOVER=true`
- `GITNEXUS_AUTO_DISCOVER_MAX_REPOS=0`
- `GITNEXUS_ANALYZE_COOLDOWN_SECONDS=90`
- `GITNEXUS_ANALYZE_TIMEOUT_SECONDS=900`
- `GITNEXUS_ANALYZE_ARGS=--force`
- `GITNEXUS_ANALYZE_NICE=15`
- `GITNEXUS_ANALYZE_IONICE_CLASS=2`
- `GITNEXUS_ANALYZE_IONICE_LEVEL=7`

`GITNEXUS_AUTO_DISCOVER_MAX_REPOS=0` means unlimited total repos, still sequential. Set it to `1` if every container restart should index at most one missing repo.

## Why These Settings

`NODE_OPTIONS=--max-old-space-size=2048` caps the Node.js V8 heap to 2GB. It does not reserve 2GB up front, but it prevents GitNexus analysis from expanding into all available RAM.

`cpus: 2.0` leaves one vCPU for Cortex API, MCP, Qdrant, Docker, and the OS on a 3 vCPU LXC/VM. If the host is still tight, use `GITNEXUS_CPUS=1.5`.

Startup indexing now runs in the background after a short delay, so GitNexus can answer `/health` while analysis continues at lower CPU and I/O priority.

GitNexus startup analysis must not use `--embeddings`. Cortex/mem9 owns embeddings, and the local TEI provider currently returns 1024-dimensional `BAAI/bge-m3` vectors.

## Deploy

After building/publishing the updated GitNexus image, redeploy the stack. For Docker Compose:

```bash
docker compose -f infra/docker-compose.yml pull gitnexus
docker compose -f infra/docker-compose.yml up -d gitnexus cortex-api cortex-mcp
```

For Portainer, update the stack with `deploy/portainer/stack.yml`, then recreate `cortex-gitnexus` first. Watch logs:

```bash
docker logs -f cortex-gitnexus
```

Expected log pattern:

```text
GitNexus: Background startup indexing PID ...
GitNexus: Starting eval-server on port 4848...
GitNexus: Startup indexing enabled; waiting 15s before bounded background analysis.
GitNexus: Scanning /app/data/repos for unregistered repos (max unlimited this start, sequential only)...
```

## Clean Old Graph Snapshots

After switching embedding dimensions or changing graph extraction contracts, remove old graph snapshots so MCP graph tools rebuild fresh bounded snapshots.

```bash
mkdir -p /home/Docker/cortex-hub/api-data/graph-snapshots-backup
cp -a /home/Docker/cortex-hub/api-data/graph-snapshots/. /home/Docker/cortex-hub/api-data/graph-snapshots-backup/ 2>/dev/null || true
rm -f /home/Docker/cortex-hub/api-data/graph-snapshots/*.json
```

Use MCP graph tools with small caps after GitNexus is healthy. Prefer snapshot-only first; use `refresh=true` only for missing or stale graphs.

## Reset Qdrant Collections After 3072 to 1024 Switch

Only run this when the selected embedding provider is intentionally changed to 1024 dimensions, such as `BAAI/bge-m3`, and old 3072-dimensional collections should be rebuilt.

```bash
docker exec -i cortex-api node - <<'NODE'
const base = 'http://qdrant:6333';
async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  return { status: res.status, text };
}
const collectionsRes = await request(`${base}/collections`);
const collections = JSON.parse(collectionsRes.text).result.collections.map((collection) => collection.name);
const targets = collections.filter((name) =>
  name === 'knowledge' ||
  name === 'cortex_memories' ||
  name.startsWith('cortex-project-')
);
console.log('Deleting collections:', targets);
for (const name of targets) {
  const result = await request(`${base}/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
  console.log(name, result.status, result.text.slice(0, 200));
}
NODE
```

After this, rebuild memory, knowledge, and project embeddings through Cortex MCP. Do not call `/api/*` directly from agents.

## Manual One-Project Analyze

Use this if automatic discovery is disabled or a single project needs repair. Replace `PROJECT_ID` with the Cortex project ID whose repo exists under `/app/data/repos`.

```bash
docker exec cortex-gitnexus bash -lc '
PROJECT_ID=proj-10cea6cf
REPO_DIR=/app/data/repos/$PROJECT_ID
LOCK=/tmp/gitnexus-index.lock
(
  flock -n 9 || { echo "Another indexing job is running"; exit 2; }
  cd "$REPO_DIR"
  nice -n 15 ionice -c2 -n7 timeout 900s gitnexus analyze --force
  sleep 90
) 9>"$LOCK"
'
```

Run one project at a time. Do not add `--embeddings` here.

## Cortex Project Processing Order

Use MCP only for Cortex operations. Recommended sequential order from smaller/lower-risk projects to heavier ones:

1. `product-mapper` (`proj-10cea6cf`)
2. `LuxeClaw-Portable` (`proj-ec128ae4`)
3. `proxy-farm-system` (`proj-fb35a870`)
4. `LightroomSync` (`proj-a45bb72d`)
5. `cortex-hub` (`proj-44576c69`)
6. `VeilBrowser` (`proj-9eabb4db`)
7. `LN-OMS` (`proj-f9ebd495`)
8. `Luxeclaw-Extension` (`proj-17a03de3`)
9. `ProxiHub` (`proj-8ef5f4c3`)

For each project:

1. Confirm GitNexus health through MCP health.
2. Check graph snapshot without refresh.
3. If graph is empty or stale, call graph refresh with small caps only.
4. Re-check snapshot-only and confirm `snapshotHit`, `source`, `stale`, and `capReason`.
5. Rebuild mem9/knowledge only if missing or dimension errors appear.

## Disk Growth Watchpoints

The fast-growing paths are usually:

- `/home/Docker/cortex-hub/api-data/repos`
- `/home/Docker/cortex-hub/gitnexus-data`
- `/home/Docker/cortex-hub/api-data/graph-snapshots`
- `/home/Docker/cortex-hub/qdrant-data`
- Docker image/layer cache

Check them with:

```bash
du -h --max-depth=2 /home/Docker/cortex-hub | sort -h
docker system df
```

Use `docker image prune` only when old images are no longer needed. Do not delete registry or database files manually.
