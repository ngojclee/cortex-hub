import { describe, expect, it } from 'vitest'

import { buildContentContract, selectContentForCaller } from './content-compactor.js'

describe('content compactor', () => {
  it('preserves code, path, url, command, and numeric tokens', () => {
    const raw = [
      'Decision: update apps/dashboard-api/src/routes/knowledge.ts for v0.5.0.0.',
      'Run `pnpm build` after changing https://cortexhub.lengoc.me/mcp.',
      'Stack uses C:\\data\\cortex.db and project_id=proj-main.',
      '```ts\nconst apiPath = \'/api/knowledge/search\'\n```',
    ].join('\n')

    const contract = buildContentContract(raw, {
      enabled: true,
      mode: 'technical_ultra',
      createdAt: '2026-05-02T00:00:00.000Z',
    })

    expect(contract.raw_content).toBe(raw)
    expect(contract.compact_content).toContain('apps/dashboard-api/src/routes/knowledge.ts')
    expect(contract.compact_content).toContain('https://cortexhub.lengoc.me/mcp')
    expect(contract.compact_content).toContain('pnpm build')
    expect(contract.compact_content).toContain('0.5.0.0')
    expect(contract.compression.mode).toBe('technical_ultra')
    expect(contract.compression.valid).toBe(true)
  })

  it('keeps raw fallback selectable for callers', () => {
    const contract = buildContentContract('Raw source fact for /api/mem9/search.', {
      enabled: true,
      mode: 'technical_full',
    })

    const compact = selectContentForCaller(contract, { fallbackKey: 'content' })
    const raw = selectContentForCaller(contract, { includeRaw: true, fallbackKey: 'content' })

    expect(compact.contentMode).toBe('compact')
    expect(raw.contentMode).toBe('raw')
    expect(raw.raw_content).toBe(contract.raw_content)
  })
})
