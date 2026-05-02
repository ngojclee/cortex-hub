import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const snapshotDir = join(process.cwd(), 'tmp-test-graph-snapshots')

describe('graph snapshot', () => {
  beforeAll(() => {
    process.env.GRAPH_SNAPSHOT_DIR = snapshotDir
    rmSync(snapshotDir, { recursive: true, force: true })
    mkdirSync(snapshotDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(snapshotDir, { recursive: true, force: true })
    delete process.env.GRAPH_SNAPSHOT_DIR
  })

  it('uses a stable key for equivalent query objects', async () => {
    const { buildGraphSnapshotKey } = await import('./graph-snapshot.js')
    const left = buildGraphSnapshotKey('proj-a', { search: 'Auth', nodeTypes: ['File', 'Class'] })
    const right = buildGraphSnapshotKey('proj-a', { nodeTypes: ['File', 'Class'], search: 'Auth' })

    expect(left).toBe(right)
  })

  it('round trips snapshot metadata without live refresh', async () => {
    const { readGraphSnapshot, writeGraphSnapshot } = await import('./graph-snapshot.js')
    const data = {
      repo: 'cortex-hub',
      nodes: [{ id: 'File:src/index.ts', type: 'File', name: 'index.ts' }],
      edges: [],
      visibleCounts: { nodes: 1, edges: 0 },
      totalCounts: { nodes: 1, edges: 0 },
      truncated: false,
      capReason: [],
    }

    writeGraphSnapshot('proj-a', { focus: 'index.ts' }, data)
    const read = readGraphSnapshot<typeof data>('proj-a', { focus: 'index.ts' }, false)

    expect(read.record?.data.repo).toBe('cortex-hub')
    expect(read.meta.snapshotHit).toBe(true)
    expect(read.meta.source).toBe('snapshot')
    expect(read.meta.refresh).toBe(false)
  })
})
