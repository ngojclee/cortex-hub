import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

const SNAPSHOT_DIR = process.env.GRAPH_SNAPSHOT_DIR ?? '/app/data/graph-snapshots'
const SNAPSHOT_MAX_AGE_MS = (() => {
  const raw = Number.parseInt(process.env.GRAPH_SNAPSHOT_MAX_AGE_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000
})()

export type GraphSnapshotMeta = {
  snapshotHit: boolean
  snapshotPath: string
  snapshotKey: string
  snapshotCreatedAt: string | null
  snapshotAgeMs: number | null
  snapshotMaxAgeMs: number
  stale: boolean
  source: 'snapshot' | 'gitnexus' | 'empty'
  refresh: boolean
}

export type GraphSnapshotRecord<T> = {
  schemaVersion: 1
  projectId: string
  queryHash: string
  createdAt: string
  data: T
}

export type GraphSnapshotRead<T> = {
  record: GraphSnapshotRecord<T> | null
  meta: GraphSnapshotMeta
}

function normalizeQueryForKey(query: unknown): string {
  if (Array.isArray(query)) {
    return `[${query.map((item) => normalizeQueryForKey(item)).join(',')}]`
  }
  if (query && typeof query === 'object') {
    const entries = Object.entries(query as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${JSON.stringify(key)}:${normalizeQueryForKey(value)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(query)
}

export function buildGraphSnapshotKey(projectId: string, query: unknown): string {
  const digest = createHash('sha256')
    .update(projectId)
    .update('\n')
    .update(normalizeQueryForKey(query))
    .digest('hex')
    .slice(0, 24)
  return `${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}-${digest}`
}

export function getGraphSnapshotPath(projectId: string, query: unknown): string {
  return join(SNAPSHOT_DIR, `${buildGraphSnapshotKey(projectId, query)}.json`)
}

export function readGraphSnapshot<T>(projectId: string, query: unknown, refresh: boolean): GraphSnapshotRead<T> {
  const snapshotKey = buildGraphSnapshotKey(projectId, query)
  const snapshotPath = join(SNAPSHOT_DIR, `${snapshotKey}.json`)
  const baseMeta: GraphSnapshotMeta = {
    snapshotHit: false,
    snapshotPath,
    snapshotKey,
    snapshotCreatedAt: null,
    snapshotAgeMs: null,
    snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
    stale: false,
    source: 'empty',
    refresh,
  }

  if (!existsSync(snapshotPath)) {
    return { record: null, meta: baseMeta }
  }

  try {
    const record = JSON.parse(readFileSync(snapshotPath, 'utf8')) as GraphSnapshotRecord<T>
    const createdAtMs = Date.parse(record.createdAt)
    const snapshotAgeMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null
    const stale = snapshotAgeMs === null ? true : snapshotAgeMs > SNAPSHOT_MAX_AGE_MS
    return {
      record,
      meta: {
        ...baseMeta,
        snapshotHit: true,
        snapshotCreatedAt: record.createdAt,
        snapshotAgeMs,
        stale,
        source: 'snapshot',
      },
    }
  } catch {
    return { record: null, meta: { ...baseMeta, stale: true } }
  }
}

export function writeGraphSnapshot<T>(projectId: string, query: unknown, data: T): GraphSnapshotRecord<T> {
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const queryHash = buildGraphSnapshotKey(projectId, query)
  const record: GraphSnapshotRecord<T> = {
    schemaVersion: 1,
    projectId,
    queryHash,
    createdAt: new Date().toISOString(),
    data,
  }
  writeFileSync(join(SNAPSHOT_DIR, `${queryHash}.json`), JSON.stringify(record, null, 2), 'utf8')
  return record
}

export function buildGraphSnapshotMeta<T>(
  read: GraphSnapshotRead<T>,
  overrides: Partial<GraphSnapshotMeta>,
): GraphSnapshotMeta {
  return { ...read.meta, ...overrides }
}
