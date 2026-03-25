/**
 * mem9 proxy routes — REST API for hub-mcp memory tools
 *
 * Translates REST calls → in-process Mem9 operations.
 * Endpoints:
 *   POST /store   → Mem9.add()
 *   POST /search  → Mem9.search()
 *   POST /embed   → Embedder.embed() (for knowledge search)
 *   GET  /health  → Mem9.isReady()
 */

import { Hono } from 'hono'
import { Mem9, Embedder } from '@cortex/shared-mem9'
import type { Mem9Config, ModelSlot } from '@cortex/shared-mem9'
import { db } from '../db/client.js'
import { resolveEmbeddingConfig } from '../services/embedding-config.js'

export const mem9ProxyRouter = new Hono()

/** Lazily initialize Mem9 instance (singleton) */
let mem9Instance: Mem9 | null = null
let embedderInstance: Embedder | null = null
let activeLlmModel = 'gpt-4.1-mini'

const DEFAULT_LLM_BASE = 'http://llm-proxy:8317/v1'
const DEFAULT_LLM_MODEL = 'gpt-4.1-mini'
const DEFAULT_QDRANT_URL = 'http://qdrant:6333'

function keyFingerprint(apiKey?: string): string {
  if (!apiKey) return ''
  const tail = apiKey.slice(-4)
  return `${apiKey.length}:${tail}`
}

function normalizeOpenAIBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function resolveLlmChain(): ModelSlot[] {
  try {
    const row = db.prepare(
      "SELECT chain FROM model_routing WHERE purpose = 'chat'"
    ).get() as { chain: string } | undefined
    if (!row?.chain) return []

    const parsedChain = JSON.parse(row.chain) as Array<{ accountId: string; model: string }>
    const slots: ModelSlot[] = []

    for (const slot of parsedChain) {
      const account = db.prepare(
        "SELECT id, api_base, api_key, type FROM provider_accounts WHERE id = ? AND status = 'enabled'"
      ).get(slot.accountId) as { id: string; api_base: string; api_key: string | null; type: string } | undefined
      if (!account) continue

      const isGemini =
        account.type === 'gemini' ||
        account.api_base.includes('generativelanguage.googleapis.com')
      if (isGemini) continue

      slots.push({
        accountId: account.id,
        baseUrl: normalizeOpenAIBase(account.api_base),
        apiKey: account.api_key ?? undefined,
        model: slot.model,
      })
    }

    return slots
  } catch {
    return []
  }
}

function resolveLlmBaseFromEnv(): string {
  const raw = process.env['LLM_PROXY_URL'] || DEFAULT_LLM_BASE
  return normalizeOpenAIBase(raw)
}

function getMem9Config(): Mem9Config {
  const llmChain = resolveLlmChain()
  const { config: embedderConfig, chain: embedderChain } = resolveEmbeddingConfig()
  const llmPrimary = llmChain[0]

  activeLlmModel = llmPrimary?.model || DEFAULT_LLM_MODEL

  return {
    llm: {
      baseUrl: llmPrimary?.baseUrl || resolveLlmBaseFromEnv(),
      model: llmPrimary?.model || DEFAULT_LLM_MODEL,
    },
    llmChain: llmChain.length > 0 ? llmChain : undefined,
    embedder: embedderConfig,
    embedderChain: embedderChain.length > 0 ? embedderChain : undefined,
    vectorStore: {
      url: process.env['QDRANT_URL'] || DEFAULT_QDRANT_URL,
      collection: 'cortex_memories',
    },
  }
}

/** Track config signature to recreate clients when provider routing changes */
let lastMem9Signature = ''
let lastEmbedSignature = ''

function getMem9(): Mem9 {
  const config = getMem9Config()
  const signature = JSON.stringify({
    llm: config.llm,
    llmChain: (config.llmChain ?? []).map((s) => ({
      id: s.accountId,
      model: s.model,
      baseUrl: s.baseUrl,
      key: keyFingerprint(s.apiKey),
    })),
    embedder: { ...config.embedder, apiKey: config.embedder.apiKey ? 'set' : '' },
    embedderChain: (config.embedderChain ?? []).map((s) => ({
      id: s.accountId,
      model: s.model,
      baseUrl: s.baseUrl,
      key: keyFingerprint(s.apiKey),
    })),
    vectorStore: config.vectorStore,
  })

  if (!mem9Instance || signature !== lastMem9Signature) {
    lastMem9Signature = signature
    mem9Instance = new Mem9(config)
    embedderInstance = null
    lastEmbedSignature = ''
  }

  return mem9Instance
}

function getEmbedder(): Embedder {
  const { config, chain } = resolveEmbeddingConfig()
  const signature = JSON.stringify({
    provider: config.provider,
    model: config.model,
    hasKey: Boolean(config.apiKey),
    chain: chain.map((s) => ({
      id: s.accountId,
      model: s.model,
      baseUrl: s.baseUrl,
      key: keyFingerprint(s.apiKey),
    })),
  })

  if (!embedderInstance || signature !== lastEmbedSignature) {
    lastEmbedSignature = signature
    embedderInstance = new Embedder(config, chain, { maxRetries: 2, retryDelayMs: 1000 })
  }
  return embedderInstance
}

/**
 * POST /store — Store a memory
 * Body: { messages, userId, agentId?, metadata? }
 */
mem9ProxyRouter.post('/store', async (c) => {
  try {
    const body = await c.req.json()
    const { messages, userId, agentId, metadata } = body

    if (!messages || !userId) {
      return c.json({ error: 'messages and userId are required' }, 400)
    }

    const mem9 = getMem9()
    const result = await mem9.add({ messages, userId, agentId, metadata })

    c.header('X-Cortex-Compute-Tokens', String(result.tokensUsed || 0))
    c.header('X-Cortex-Compute-Model', activeLlmModel)

    return c.json({
      success: true,
      events: result.events,
      tokensUsed: result.tokensUsed,
    })
  } catch (error) {
    console.error('[mem9-proxy] store error:', error)
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * POST /search — Search memories by semantic similarity
 * Body: { query, userId, agentId?, limit? }
 */
mem9ProxyRouter.post('/search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, userId, agentId, limit } = body

    if (!query || !userId) {
      return c.json({ error: 'query and userId are required' }, 400)
    }

    const mem9 = getMem9()
    const result = await mem9.search({ query, userId, agentId, limit })

    c.header('X-Cortex-Compute-Tokens', String(result.tokensUsed || 0))
    c.header('X-Cortex-Compute-Model', activeLlmModel)

    return c.json({
      memories: result.memories,
      tokensUsed: result.tokensUsed,
    })
  } catch (error) {
    console.error('[mem9-proxy] search error:', error)
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * POST /embed — Embed text to vector (for knowledge search)
 * Body: { text }
 */
mem9ProxyRouter.post('/embed', async (c) => {
  try {
    const body = await c.req.json()
    const { text } = body

    if (!text) {
      return c.json({ error: 'text is required' }, 400)
    }

    const embedder = getEmbedder()
    const vector = await embedder.embed(text)

    return c.json({ vector, dimensions: vector.length })
  } catch (error) {
    console.error('[mem9-proxy] embed error:', error)
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * GET /health — Check if mem9 dependencies are reachable
 */
mem9ProxyRouter.get('/health', async (c) => {
  try {
    const mem9 = getMem9()
    const status = await mem9.isReady()

    return c.json({
      status: status.llm && status.vectorStore ? 'healthy' : 'degraded',
      llm: status.llm ? 'ok' : 'error',
      vectorStore: status.vectorStore ? 'ok' : 'error',
    })
  } catch (error) {
    return c.json({
      status: 'error',
      error: String(error),
    }, 500)
  }
})
