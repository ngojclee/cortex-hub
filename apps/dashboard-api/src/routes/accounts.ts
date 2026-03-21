import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { db } from '../db/client.js'

export const accountsRouter = new Hono()

/** Row shape from provider_accounts table */
interface ProviderAccountRow {
  id: string
  name: string
  type: string
  api_base: string
  api_key: string | null
  status: string
  capabilities: string
  models: string
  created_at: string
  updated_at: string
}

interface RoutingRow {
  purpose: string
  chain: string
  updated_at: string
}

// ── List all provider accounts ──
accountsRouter.get('/', (c) => {
  const search = c.req.query('search')?.toLowerCase()
  const page = Number(c.req.query('page') ?? 1)
  const limit = Number(c.req.query('limit') ?? 20)
  const offset = (page - 1) * limit

  try {
    let rows: ProviderAccountRow[]
    let total: number

    if (search) {
      rows = db
        .prepare(
          `SELECT * FROM provider_accounts 
           WHERE LOWER(name) LIKE ? OR LOWER(type) LIKE ? 
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(`%${search}%`, `%${search}%`, limit, offset) as ProviderAccountRow[]

      total = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM provider_accounts 
             WHERE LOWER(name) LIKE ? OR LOWER(type) LIKE ?`
          )
          .get(`%${search}%`, `%${search}%`) as { count: number }
      ).count
    } else {
      rows = db
        .prepare('SELECT * FROM provider_accounts ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as ProviderAccountRow[]

      total = (db.prepare('SELECT COUNT(*) as count FROM provider_accounts').get() as { count: number }).count
    }

    // Mask API keys in response
    const accounts = rows.map((row) => ({
      ...row,
      api_key: row.api_key ? '***' : null,
      capabilities: JSON.parse(row.capabilities || '["chat"]'),
      models: JSON.parse(row.models || '[]'),
    }))

    return c.json({
      accounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Get a single provider account ──
accountsRouter.get('/:id', (c) => {
  const id = c.req.param('id')
  try {
    const row = db.prepare('SELECT * FROM provider_accounts WHERE id = ?').get(id) as ProviderAccountRow | undefined
    if (!row) return c.json({ error: 'Account not found' }, 404)

    return c.json({
      ...row,
      api_key: row.api_key ? '***' : null,
      capabilities: JSON.parse(row.capabilities || '["chat"]'),
      models: JSON.parse(row.models || '[]'),
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Add a new provider account ──
accountsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { name, type, apiBase, apiKey, capabilities } = body

    if (!name || !type || !apiBase) {
      return c.json({ error: 'name, type, and apiBase are required' }, 400)
    }

    const id = `pa-${randomUUID().slice(0, 8)}`
    const caps = JSON.stringify(capabilities ?? ['chat'])

    db.prepare(
      `INSERT INTO provider_accounts (id, name, type, api_base, api_key, capabilities) 
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, type, apiBase, apiKey || null, caps)

    return c.json({ success: true, id }, 201)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Update a provider account ──
accountsRouter.put('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const existing = db.prepare('SELECT id FROM provider_accounts WHERE id = ?').get(id)
    if (!existing) return c.json({ error: 'Account not found' }, 404)

    const body = await c.req.json()
    const { name, type, apiBase, apiKey, status, capabilities } = body

    const updates: string[] = []
    const params: unknown[] = []

    if (name !== undefined) { updates.push('name = ?'); params.push(name) }
    if (type !== undefined) { updates.push('type = ?'); params.push(type) }
    if (apiBase !== undefined) { updates.push('api_base = ?'); params.push(apiBase) }
    if (apiKey !== undefined) { updates.push('api_key = ?'); params.push(apiKey || null) }
    if (status !== undefined) { updates.push('status = ?'); params.push(status) }
    if (capabilities !== undefined) { updates.push('capabilities = ?'); params.push(JSON.stringify(capabilities)) }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    updates.push("updated_at = datetime('now')")
    params.push(id)

    db.prepare(`UPDATE provider_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Delete a provider account ──
accountsRouter.delete('/:id', (c) => {
  const id = c.req.param('id')
  try {
    const result = db.prepare('DELETE FROM provider_accounts WHERE id = ?').run(id)
    if (result.changes === 0) return c.json({ error: 'Account not found' }, 404)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Test a provider connection ──
accountsRouter.post('/:id/test', async (c) => {
  const id = c.req.param('id')
  try {
    const row = db.prepare('SELECT * FROM provider_accounts WHERE id = ?').get(id) as ProviderAccountRow | undefined
    if (!row) return c.json({ error: 'Account not found' }, 404)

    const startTime = Date.now()

    // Test based on type
    if (row.type === 'gemini') {
      // Gemini: test embedding endpoint
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${row.api_key}`
      const res = await fetch(testUrl, { signal: AbortSignal.timeout(10000) })
      const latency = Date.now() - startTime

      if (!res.ok) {
        const err = await res.text()
        return c.json({ success: false, latency, error: `Gemini API error: ${err.substring(0, 200)}` })
      }

      const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
      const models = (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.some((g) => g.includes('embed') || g.includes('generate')))
        .map((m) => m.name.replace('models/', ''))

      // Cache models
      db.prepare("UPDATE provider_accounts SET models = ?, status = 'enabled', updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(models), id)

      return c.json({ success: true, latency, modelCount: models.length, models: models.slice(0, 20) })
    } else {
      // OpenAI-compatible: test /v1/models
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (row.api_key) headers['Authorization'] = `Bearer ${row.api_key}`

      const res = await fetch(`${row.api_base}/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      })
      const latency = Date.now() - startTime

      if (!res.ok) {
        const err = await res.text()
        return c.json({ success: false, latency, error: `API error (${res.status}): ${err.substring(0, 200)}` })
      }

      const data = (await res.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id)

      // Cache models
      db.prepare("UPDATE provider_accounts SET models = ?, status = 'enabled', updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(models), id)

      return c.json({ success: true, latency, modelCount: models.length, models: models.slice(0, 20) })
    }
  } catch (error) {
    // Mark as error
    db.prepare("UPDATE provider_accounts SET status = 'error', updated_at = datetime('now') WHERE id = ?").run(id)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Get model routing (fallback chains) ──
accountsRouter.get('/routing/chains', (c) => {
  try {
    const rows = db.prepare('SELECT * FROM model_routing').all() as RoutingRow[]
    const routing: Record<string, { chain: unknown[]; updatedAt: string }> = {}

    for (const row of rows) {
      routing[row.purpose] = {
        chain: JSON.parse(row.chain || '[]'),
        updatedAt: row.updated_at,
      }
    }

    return c.json({ routing })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Update model routing ──
accountsRouter.put('/routing/chains', async (c) => {
  try {
    const body = await c.req.json()
    const { purpose, chain } = body

    if (!purpose || !Array.isArray(chain)) {
      return c.json({ error: 'purpose and chain[] are required' }, 400)
    }

    const validPurposes = ['chat', 'embedding', 'code']
    if (!validPurposes.includes(purpose)) {
      return c.json({ error: `Invalid purpose. Must be: ${validPurposes.join(', ')}` }, 400)
    }

    db.prepare(
      `INSERT INTO model_routing (purpose, chain, updated_at) 
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(purpose) DO UPDATE SET chain = ?, updated_at = datetime('now')`
    ).run(purpose, JSON.stringify(chain), JSON.stringify(chain))

    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Active config summary ──
accountsRouter.get('/routing/active', (c) => {
  try {
    const routing = db.prepare('SELECT * FROM model_routing').all() as RoutingRow[]
    const accounts = db.prepare("SELECT id, name, type, status FROM provider_accounts WHERE status = 'enabled'").all() as Pick<ProviderAccountRow, 'id' | 'name' | 'type' | 'status'>[]

    const accountMap = new Map(accounts.map((a) => [a.id, a]))

    const config = routing.map((r) => {
      const chain = JSON.parse(r.chain || '[]') as { accountId: string; model: string }[]
      return {
        purpose: r.purpose,
        chain: chain.map((slot) => ({
          ...slot,
          accountName: accountMap.get(slot.accountId)?.name ?? 'Unknown',
        })),
      }
    })

    return c.json({ config, totalAccounts: accounts.length })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})
