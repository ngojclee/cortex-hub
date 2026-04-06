import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { db } from '../db/client.js'
import { createLogger } from '@cortex/shared-utils'

const logger = createLogger('auth')

export const authRouter = new Hono()

// ── Env helpers ──
const TELEGRAM_BOT_TOKEN = () => process.env['TELEGRAM_BOT_TOKEN'] || ''
const TELEGRAM_CHAT_ID = () => process.env['TELEGRAM_CHAT_ID'] || ''
const DASHBOARD_URL = () => process.env['DASHBOARD_URL'] || 'http://localhost:4000'
const AUTH_ENABLED = () => (process.env['AUTH_ENABLED'] || 'false').toLowerCase() === 'true'
const AUTH_SESSION_TTL_HOURS = () => Number(process.env['AUTH_SESSION_TTL_HOURS'] || '168') // 7 days default

// ── Check if auth is configured ──
authRouter.get('/config', (c) => {
  return c.json({
    enabled: AUTH_ENABLED(),
    telegramConfigured: !!(TELEGRAM_BOT_TOKEN() && TELEGRAM_CHAT_ID()),
  })
})

// ── Request access (submit email) ──
authRouter.post('/request', async (c) => {
  if (!AUTH_ENABLED()) {
    return c.json({ error: 'Auth is not enabled' }, 400)
  }

  const body = await c.req.json() as { email?: string }
  const email = body.email?.trim().toLowerCase()

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400)
  }

  const botToken = TELEGRAM_BOT_TOKEN()
  const chatId = TELEGRAM_CHAT_ID()
  if (!botToken || !chatId) {
    return c.json({ error: 'Telegram not configured on server' }, 500)
  }

  // Rate limit: max 3 pending requests per email in last 5 minutes
  const recentCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM auth_requests
     WHERE email = ? AND status = 'pending' AND created_at > datetime('now', '-5 minutes')`
  ).get(email) as { cnt: number }

  if (recentCount.cnt >= 3) {
    return c.json({ error: 'Too many requests. Please wait.' }, 429)
  }

  const requestId = `auth-${randomUUID().slice(0, 8)}`
  const token = randomUUID()
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
  const ua = c.req.header('user-agent') || 'unknown'

  db.prepare(
    `INSERT INTO auth_requests (id, email, token, status, ip_address, user_agent) VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(requestId, email, token, ip, ua)

  // Send Telegram message with approve/deny links
  const dashUrl = DASHBOARD_URL()
  const approveUrl = `${dashUrl}/api/auth/approve/${token}`
  const denyUrl = `${dashUrl}/api/auth/deny/${token}`

  const message = [
    `🔐 <b>Dashboard Access Request</b>`,
    ``,
    `📧 <b>Email:</b> ${escapeHtml(email)}`,
    `🌐 <b>IP:</b> <code>${escapeHtml(ip)}</code>`,
    `🕐 <b>Time:</b> ${new Date().toISOString()}`,
    ``,
    `<a href="${approveUrl}">✅ Approve</a>  |  <a href="${denyUrl}">❌ Deny</a>`,
  ].join('\n')

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      logger.error(`Telegram send failed: ${errBody}`)
      return c.json({ error: 'Failed to send Telegram notification' }, 500)
    }
  } catch (err) {
    logger.error(`Telegram request error: ${err}`)
    return c.json({ error: 'Failed to reach Telegram API' }, 500)
  }

  logger.info(`Auth request ${requestId} from ${email} (IP: ${ip})`)

  return c.json({ requestId, message: 'Access request sent. Waiting for approval.' })
})

// ── Poll request status ──
authRouter.get('/status/:id', (c) => {
  const id = c.req.param('id')
  const request = db.prepare('SELECT id, email, status, created_at, resolved_at FROM auth_requests WHERE id = ?')
    .get(id) as { id: string; email: string; status: string; created_at: string; resolved_at: string | null } | undefined

  if (!request) return c.json({ error: 'Request not found' }, 404)

  // Auto-expire after 10 minutes
  const createdAt = new Date(request.created_at + 'Z')
  if (request.status === 'pending' && Date.now() - createdAt.getTime() > 10 * 60 * 1000) {
    db.prepare("UPDATE auth_requests SET status = 'denied', resolved_at = datetime('now') WHERE id = ?").run(id)
    return c.json({ id: request.id, status: 'denied', reason: 'expired' })
  }

  // If approved, return a session token
  if (request.status === 'approved') {
    const sessionToken = db.prepare('SELECT token FROM auth_requests WHERE id = ?').get(id) as { token: string }
    return c.json({ id: request.id, status: 'approved', sessionToken: sessionToken.token })
  }

  return c.json({ id: request.id, status: request.status })
})

// ── Approve (clicked from Telegram) ──
authRouter.get('/approve/:token', (c) => {
  const token = c.req.param('token')
  const request = db.prepare("SELECT id, email, status FROM auth_requests WHERE token = ?").get(token) as
    { id: string; email: string; status: string } | undefined

  if (!request) {
    return c.html(resultPage('Not Found', 'This approval link is invalid or expired.', false))
  }
  if (request.status !== 'pending') {
    return c.html(resultPage('Already Processed', `This request was already ${request.status}.`, request.status === 'approved'))
  }

  db.prepare("UPDATE auth_requests SET status = 'approved', resolved_at = datetime('now') WHERE token = ?").run(token)
  logger.info(`Auth approved for ${request.email} (${request.id})`)

  return c.html(resultPage('Approved', `Access granted to ${request.email}. They can now use the dashboard.`, true))
})

// ── Deny (clicked from Telegram) ──
authRouter.get('/deny/:token', (c) => {
  const token = c.req.param('token')
  const request = db.prepare("SELECT id, email, status FROM auth_requests WHERE token = ?").get(token) as
    { id: string; email: string; status: string } | undefined

  if (!request) {
    return c.html(resultPage('Not Found', 'This denial link is invalid or expired.', false))
  }
  if (request.status !== 'pending') {
    return c.html(resultPage('Already Processed', `This request was already ${request.status}.`, request.status === 'approved'))
  }

  db.prepare("UPDATE auth_requests SET status = 'denied', resolved_at = datetime('now') WHERE token = ?").run(token)
  logger.info(`Auth denied for ${request.email} (${request.id})`)

  return c.html(resultPage('Denied', `Access denied for ${request.email}.`, false))
})

// ── Validate session token ──
authRouter.get('/validate', (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
    parseCookie(c.req.header('cookie') || '', 'cortex_session')

  if (!token) return c.json({ valid: false }, 401)

  const ttlHours = AUTH_SESSION_TTL_HOURS()
  const session = db.prepare(
    `SELECT id, email, status, created_at FROM auth_requests
     WHERE token = ? AND status = 'approved' AND created_at > datetime('now', '-${ttlHours} hours')`
  ).get(token) as { id: string; email: string; status: string; created_at: string } | undefined

  if (!session) return c.json({ valid: false }, 401)

  return c.json({ valid: true, email: session.email, sessionId: session.id })
})

// ── Logout ──
authRouter.post('/logout', (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ||
    parseCookie(c.req.header('cookie') || '', 'cortex_session')

  if (token) {
    db.prepare("UPDATE auth_requests SET status = 'revoked', resolved_at = datetime('now') WHERE token = ? AND status = 'approved'").run(token)
    logger.info(`Session logged out & revoked for token (truncated): ${token.slice(0, 8)}...`)
  }

  return c.json({ success: true }, 200)
})

// ── List Active Sessions ──
authRouter.get('/sessions', (c) => {
  const ttlHours = AUTH_SESSION_TTL_HOURS()
  const sessions = db.prepare(
    `SELECT id, email, status, ip_address, user_agent, created_at 
     FROM auth_requests 
     WHERE status = 'approved' AND created_at > datetime('now', '-${ttlHours} hours')
     ORDER BY created_at DESC`
  ).all()

  return c.json({ sessions })
})

// ── Revoke Single Session ──
authRouter.delete('/sessions/:id', (c) => {
  const id = c.req.param('id')
  
  const result = db.prepare("UPDATE auth_requests SET status = 'revoked', resolved_at = datetime('now') WHERE id = ? AND status = 'approved'").run(id)
  
  if (result.changes === 0) {
    return c.json({ error: 'Session not found or already revoked/expired' }, 404)
  }

  logger.info(`Session ${id} explicitly revoked by admin action.`)
  return c.json({ success: true, message: 'Session revoked' })
})

// ── Revoke ALL Sessions (Panic Button) ──
authRouter.delete('/sessions', (c) => {
  const ttlHours = AUTH_SESSION_TTL_HOURS()
  const result = db.prepare(
    `UPDATE auth_requests 
     SET status = 'revoked', resolved_at = datetime('now') 
     WHERE status = 'approved' AND created_at > datetime('now', '-${ttlHours} hours')`
  ).run()

  logger.warn(`ALL active sessions revoked! (${result.changes} sessions impacted)`)
  return c.json({ success: true, revokedCount: result.changes })
})

// ── Helpers ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

function resultPage(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444'
  const icon = success ? '✅' : '❌'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Cortex Hub</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #15151f; border: 1px solid #2a2a3a; border-radius: 12px; padding: 2.5rem; text-align: center; max-width: 400px; }
  .icon { font-size: 3rem; margin-bottom: 1rem; }
  h1 { color: ${color}; font-size: 1.5rem; margin: 0 0 0.75rem; }
  p { color: #a0a0b0; line-height: 1.6; margin: 0; }
</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1><p>${message}</p></div></body></html>`
}
