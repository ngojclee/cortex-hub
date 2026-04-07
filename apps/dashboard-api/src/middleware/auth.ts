import type { Context, Next } from 'hono'
import { db } from '../db/client.js'
import { createHash } from 'crypto'

const AUTH_SESSION_TTL_HOURS = () => Number(process.env['AUTH_SESSION_TTL_HOURS'] || '168')

type ApiKeyRecord = {
  id: string
  name: string
  scope: string
  permissions: string | null
  project_id: string | null
  expires_at: string | null
}

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

function parseBearerToken(c: Context): string | undefined {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return undefined
  const token = authHeader.slice('Bearer '.length).trim()
  return token.length > 0 ? token : undefined
}

function isMachineApiRoute(path: string): boolean {
  return (
    path.startsWith('/api/projects') ||
    path.startsWith('/api/knowledge') ||
    path.startsWith('/api/intel') ||
    path.startsWith('/api/mem9') ||
    path.startsWith('/api/mem9-proxy') ||
    path.startsWith('/api/indexing') ||
    path.startsWith('/api/quality') ||
    path.startsWith('/api/usage')
  )
}

function verifyApiKey(token: string): ApiKeyRecord | undefined {
  const hash = createHash('sha256').update(token).digest('hex')
  const record = db.prepare(
    `SELECT id, name, scope, permissions, project_id, expires_at
     FROM api_keys
     WHERE key_hash = ?
       AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).get(hash) as ApiKeyRecord | undefined

  if (record) {
    db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(record.id)
  }

  return record
}

/**
 * Detect internal Docker network requests (service-to-service).
 * These come from localhost, 127.0.0.1, or Docker internal IPs (172.*, 10.*, 192.168.*).
 */
function isInternalRequest(c: Context): boolean {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '' ||
    ip.startsWith('172.') || ip.startsWith('10.') || ip.startsWith('192.168.')
}

/**
 * Dashboard auth middleware.
 * - Browser/dashboard traffic uses session auth.
 * - Machine-facing API routes may use Bearer API keys.
 * - Public/internal routes are bypassed as before.
 */
export function dashboardAuth() {
  return async (c: Context, next: Next) => {
    const enabled = (process.env['AUTH_ENABLED'] || 'false').toLowerCase() === 'true'
    if (!enabled) return next()

    const path = c.req.path

    // Skip auth for public routes
    if (
      path === '/health' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/api/setup/') ||
      path === '/api/keys/verify' ||
      path.startsWith('/mcp') ||
      path.startsWith('/.well-known/') ||
      path.startsWith('/_next/') ||
      // Static assets
      path.match(/\.(js|css|png|jpg|svg|ico|woff2?|ttf|map)$/) ||
      // Internal service-to-service calls (embedding, LLM gateway)
      // The embedder calls /api/llm/v1/embeddings without auth headers
      (path.startsWith('/api/llm/') && isInternalRequest(c)) ||
      // Internal health/readiness probes must not require dashboard session auth.
      ((path === '/api/mem9/health' || path === '/api/mem9-proxy/health') && isInternalRequest(c))
    ) {
      return next()
    }

    const bearerToken = parseBearerToken(c)
    const sessionToken = parseCookie(c.req.header('cookie') || '', 'cortex_session')

    if (bearerToken && isMachineApiRoute(path)) {
      const apiKey = verifyApiKey(bearerToken)
      if (apiKey) {
        c.set('authType', 'api_key')
        c.set('authApiKeyId', apiKey.id)
        c.set('authApiKeyName', apiKey.name)
        c.set('authApiKeyScope', apiKey.scope)
        c.set('authApiKeyProjectId', apiKey.project_id)
        return next()
      }

      // Machine clients should not be forced through dashboard session auth.
      if (!sessionToken) {
        return c.json({ error: 'Invalid or expired API key' }, 401)
      }
    }

    const token = sessionToken ?? bearerToken

    if (!token) {
      // For API requests, return 401 JSON
      if (path.startsWith('/api/')) {
        return c.json({ error: 'Authentication required' }, 401)
      }
      // For page requests, let the SPA handle it (AuthGuard will redirect)
      return next()
    }

    const ttlHours = AUTH_SESSION_TTL_HOURS()
    const session = db.prepare(
      `SELECT id, email FROM auth_requests
       WHERE token = ? AND status = 'approved' AND created_at > datetime('now', '-${ttlHours} hours')`
    ).get(token) as { id: string; email: string } | undefined

    if (!session) {
      if (path.startsWith('/api/')) {
        return c.json({ error: 'Session expired or invalid' }, 401)
      }
      return next()
    }

    // Attach user info to context
    c.set('authType', 'session')
    c.set('authEmail', session.email)
    c.set('authSessionId', session.id)

    return next()
  }
}
