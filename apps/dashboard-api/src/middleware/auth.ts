import type { Context, Next } from 'hono'
import { db } from '../db/client.js'

const AUTH_SESSION_TTL_HOURS = () => Number(process.env['AUTH_SESSION_TTL_HOURS'] || '168')

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

/**
 * Dashboard auth middleware.
 * When AUTH_ENABLED=true, requires a valid session token via cookie or Authorization header.
 * Skips auth for: /api/auth/*, /api/setup/*, /health, /mcp, static files.
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
      path.startsWith('/mcp') ||
      path.startsWith('/.well-known/') ||
      path.startsWith('/_next/') ||
      // Static assets
      path.match(/\.(js|css|png|jpg|svg|ico|woff2?|ttf|map)$/)
    ) {
      return next()
    }

    // Check session token
    const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
      parseCookie(c.req.header('cookie') || '', 'cortex_session')

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
    c.set('authEmail', session.email)
    c.set('authSessionId', session.id)

    return next()
  }
}
