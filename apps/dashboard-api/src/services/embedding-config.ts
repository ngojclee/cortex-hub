import type { EmbedderConfig, ModelSlot } from '@cortex/shared-mem9'
import { db } from '../db/client.js'

interface AccountRow {
  id: string
  api_base: string
  api_key: string | null
  type: string
}

function resolveGeminiApiKey(): string {
  try {
    const row = db.prepare(
      "SELECT api_key FROM provider_accounts WHERE type = 'gemini' AND status = 'enabled' AND api_key IS NOT NULL LIMIT 1"
    ).get() as { api_key: string } | undefined
    if (row?.api_key) return row.api_key
  } catch {
    // DB may not be ready yet
  }

  // Optional legacy fallback for older deployments that still rely on env-based keys.
  if ((process.env['ALLOW_ENV_PROVIDER_FALLBACK'] ?? 'false').toLowerCase() === 'true') {
    const envKey = process.env['GEMINI_API_KEY']
    if (envKey) return envKey
  }

  return ''
}

/**
 * Build embedding config + fallback chain from model_routing/provider_accounts.
 * This keeps all embedding flows aligned with the Providers UI.
 */
export function resolveEmbeddingConfig(): { config: EmbedderConfig; chain: ModelSlot[] } {
  const chainSlots: ModelSlot[] = []

  try {
    const routing = db.prepare(
      "SELECT chain FROM model_routing WHERE purpose = 'embedding'"
    ).get() as { chain: string } | undefined

    if (routing?.chain) {
      const chain = JSON.parse(routing.chain) as Array<{ accountId: string; model: string }>
      for (const slot of chain) {
        const account = db.prepare(
          "SELECT id, api_base, api_key, type FROM provider_accounts WHERE id = ? AND status = 'enabled'"
        ).get(slot.accountId) as AccountRow | undefined

        if (!account) continue

        chainSlots.push({
          accountId: account.id,
          baseUrl: account.api_base,
          apiKey: account.api_key ?? undefined,
          model: slot.model,
        })
      }
    }
  } catch {
    // If routing table/JSON is not ready, fallback config below still works.
  }

  const geminiKey = resolveGeminiApiKey()
  const fallbackModel = process.env['MEM9_EMBEDDING_MODEL'] || 'gemini-embedding-exp-03-07'

  const fallbackConfig: EmbedderConfig = geminiKey
    ? {
        provider: 'gemini',
        apiKey: geminiKey,
        model: fallbackModel,
      }
    : {
        provider: 'openai',
        apiKey: process.env['OPENAI_API_KEY'] ?? '',
        model: process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
      }

  return { config: fallbackConfig, chain: chainSlots }
}
