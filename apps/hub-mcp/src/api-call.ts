import type { Env } from './types.js'
import { AsyncLocalStorage } from 'node:async_hooks'

export const telemetryStorage = new AsyncLocalStorage<{
  computeTokens: number
  computeModel: string | null
}>()

/**
 * Make an API call to dashboard-api.
 *
 * hub-mcp runs as a separate service, so this always uses
 * HTTP fetch to reach dashboard-api via DASHBOARD_API_URL.
 *
 * When env.API_KEY_TOKEN is set (captured during MCP auth), it is
 * forwarded as Authorization so downstream machine routes can
 * authenticate consistently. X-API-Key-Owner remains as a
 * convenience identity header for internal attribution.
 */
export async function apiCall(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = env.DASHBOARD_API_URL || 'http://localhost:4000'

  // Merge X-API-Key-Owner header when identity is resolved
  const headers = new Headers(init?.headers)
  if (env.API_KEY_TOKEN && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${env.API_KEY_TOKEN}`)
  }
  if (env.API_KEY_OWNER && !headers.has('X-API-Key-Owner')) {
    headers.set('X-API-Key-Owner', env.API_KEY_OWNER)
  }
  if (env.CLIENT_TRANSPORT && !headers.has('X-Cortex-Transport')) {
    headers.set('X-Cortex-Transport', env.CLIENT_TRANSPORT)
  }
  if (env.CLIENT_APP && !headers.has('X-Cortex-Client-App')) {
    headers.set('X-Cortex-Client-App', env.CLIENT_APP)
  }
  if (env.CLIENT_HOST && !headers.has('X-Cortex-Client-Host')) {
    headers.set('X-Cortex-Client-Host', env.CLIENT_HOST)
  }
  if (env.CLIENT_IP && !headers.has('X-Cortex-Client-IP')) {
    headers.set('X-Cortex-Client-IP', env.CLIENT_IP)
  }
  if (env.CLIENT_USER_AGENT && !headers.has('X-Cortex-Client-User-Agent')) {
    headers.set('X-Cortex-Client-User-Agent', env.CLIENT_USER_AGENT)
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(30000),
  })

  // Extract compute telemetry headers if present
  const computeTokens = parseInt(response.headers.get('X-Cortex-Compute-Tokens') || '0', 10)
  const computeModel = response.headers.get('X-Cortex-Compute-Model')

  const store = telemetryStorage.getStore()
  if (store && computeTokens > 0) {
    store.computeTokens += computeTokens
    if (computeModel) store.computeModel = computeModel
  }

  return response
}
