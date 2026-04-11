import type { Env } from './types.js'
import { AsyncLocalStorage } from 'node:async_hooks'

export const telemetryStorage = new AsyncLocalStorage<{
  computeTokens: number
  computeModel: string | null
}>()

function encodeHeaderValue(value: string): string {
  return /[^\x20-\x7E]/.test(value) ? encodeURIComponent(value) : value
}

function setInternalHeader(headers: Headers, name: string, value: string | undefined): void {
  if (!value || headers.has(name)) return
  headers.set(name, encodeHeaderValue(value))
}

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
  setInternalHeader(headers, 'X-API-Key-Owner', env.API_KEY_OWNER)
  setInternalHeader(headers, 'X-Cortex-Transport', env.CLIENT_TRANSPORT)
  setInternalHeader(headers, 'X-Cortex-Client-App', env.CLIENT_APP)
  setInternalHeader(headers, 'X-Cortex-Client-Host', env.CLIENT_HOST)
  setInternalHeader(headers, 'X-Cortex-Client-IP', env.CLIENT_IP)
  setInternalHeader(headers, 'X-Cortex-Client-User-Agent', env.CLIENT_USER_AGENT)

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
