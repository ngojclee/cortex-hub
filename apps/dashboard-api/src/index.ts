import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'

// Read version from version.json (copied at build time)
let appVersion = process.env['APP_VERSION'] || '0.0.0-dev'
try {
  const versionJson = JSON.parse(readFileSync('./version.json', 'utf-8'))
  appVersion = versionJson.version || appVersion
} catch {
  // version.json not found — use fallback
}
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { createLogger, normalizeCortexBaseUrl } from '@cortex/shared-utils'
import { setupRouter } from './routes/setup.js'
import { keysRouter } from './routes/keys.js'
import { llmRouter } from './routes/llm.js'
import { intelRouter } from './routes/intel.js'
import { qualityRouter, sessionsRouter } from './routes/quality.js'
import { orgsRouter, projectsRouter } from './routes/organizations.js'
import { indexingRouter } from './routes/indexing.js'
import { usageRouter } from './routes/usage.js'
import { mem9ProxyRouter } from './routes/mem9-proxy.js'
import { statsRouter as metricsRouter } from './routes/stats.js'
import { systemRouter } from './routes/system.js'
import { accountsRouter } from './routes/accounts.js'
import { webhooksRouter } from './routes/webhooks.js'
import { knowledgeRouter } from './routes/knowledge.js'
import { authRouter } from './routes/auth.js'
import { dashboardAuth } from './middleware/auth.js'

const app = new Hono()
const logger = createLogger('dashboard-api')
const cortexAccessPort = () => process.env['CORTEX_ACCESS_PORT'] ?? process.env['API_PORT'] ?? process.env['PORT'] ?? '4000'
const normalizeDashboardUrl = (value: string | null | undefined) =>
  normalizeCortexBaseUrl(value, { defaultPort: cortexAccessPort(), stripMcpPath: true })

const corsOrigins = (() => {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ])

  for (const key of ['DASHBOARD_URL', 'CORTEX_ACCESS_URL', 'CORTEX_PUBLIC_URL']) {
    const rawUrl = process.env[key]
    if (!rawUrl) continue
    const normalized = normalizeDashboardUrl(rawUrl)
    if (normalized) {
      origins.add(new URL(normalized).origin)
    } else {
      logger.warn(`Invalid ${key} for CORS: ${rawUrl}`)
    }
  }

  return Array.from(origins)
})()

app.use('/api/*', cors({
  origin: corsOrigins,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
// CORS for /mcp — allow any origin (agents use Bearer auth, not cookies)
app.use('/mcp', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}))
app.use('*', honoLogger())

app.get('/live', (c) => {
  return c.json({
    status: 'ok',
    service: 'dashboard-api',
    version: appVersion,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  })
})

app.get('/health', async (c) => {
  const startTime = Date.now()

  async function checkService(
    url: string,
    options?: {
      acceptedStatuses?: number[]
      healthyStatusTexts?: string[]
      timeoutMs?: number
    },
  ): Promise<'ok' | 'error'> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options?.timeoutMs ?? 3000) })
      const acceptedStatuses = new Set(options?.acceptedStatuses ?? [])
      if (res.ok || acceptedStatuses.has(res.status)) {
        if (!options?.healthyStatusTexts || options.healthyStatusTexts.length === 0) {
          return 'ok'
        }

        const contentType = res.headers.get('content-type') ?? ''
        if (!contentType.includes('application/json')) return 'ok'

        const payload = await res.json().catch(() => null) as { status?: unknown } | null
        const statusText = typeof payload?.status === 'string' ? payload.status.toLowerCase() : null
        if (!statusText) return 'ok'
        return options.healthyStatusTexts.includes(statusText) ? 'ok' : 'error'
      }
      return 'error'
    } catch {
      return 'error'
    }
  }

  // Core services: affect overall status
  const [qdrant, mem9] = await Promise.all([
    checkService(`${process.env['QDRANT_URL'] || 'http://qdrant:6333'}/healthz`),
    checkService(`http://localhost:${process.env.PORT || 4000}/api/mem9/health`, {
      healthyStatusTexts: ['healthy', 'ok'],
    }),
  ])

  // Optional services: reported individually but don't affect overall status
  const [cliproxy, gitnexus, mcp] = await Promise.all([
    checkService(`${process.env['LLM_PROXY_URL'] || 'http://llm-proxy:8317'}/v1/models`, {
      acceptedStatuses: [401, 403],
    }),
    checkService(`${process.env['GITNEXUS_URL'] || 'http://gitnexus:4848'}/health`, {
      healthyStatusTexts: ['healthy', 'ok'],
      timeoutMs: 8000,
    }),
    checkService(`${process.env['MCP_HEALTH_URL'] || 'http://cortex-mcp:8317/health'}`),
  ])

  const coreServices = { qdrant, mem9 }
  const optionalServices = { cliproxy, gitnexus, mcp }
  const services = { ...coreServices, ...optionalServices }
  const coreOk = Object.values(coreServices).every(s => s === 'ok')
  const allOk = Object.values(services).every(s => s === 'ok')

  return c.json({
    status: coreOk ? 'ok' : 'degraded',
    service: 'dashboard-api',
    version: appVersion,
    commit: process.env['COMMIT_SHA'] || 'dev',
    buildDate: process.env['BUILD_DATE'] || 'unknown',
    image: `${process.env['IMAGE_REPO'] || 'ghcr.io/ngojclee/cortex-api'}:${(process.env['COMMIT_SHA'] || 'dev').slice(0, 7)}`,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    responseTime: Date.now() - startTime,
    services,
    ...(coreOk && !allOk ? { notice: 'Some optional services are unavailable but core functionality is operational' } : {}),
  })
})

// Auth middleware — guards /api/* when AUTH_ENABLED=true
app.use('*', dashboardAuth())

app.route('/api/auth', authRouter)
app.route('/api/setup', setupRouter)
app.route('/api/keys', keysRouter)
app.route('/api/llm', llmRouter)
app.route('/api/intel', intelRouter)
app.route('/api/quality', qualityRouter)
app.route('/api/sessions', sessionsRouter)
app.route('/api/orgs', orgsRouter)
app.route('/api/projects', projectsRouter)
app.route('/api/projects', indexingRouter)
app.route('/api/usage', usageRouter)
app.route('/api/system', systemRouter)
app.route('/api/metrics', metricsRouter)
app.route('/api/accounts', accountsRouter)
app.route('/api/indexing', indexingRouter)
app.route('/api/mem9', mem9ProxyRouter)
// Backward-compatible alias for older dashboard builds and clients.
app.route('/api/mem9-proxy', mem9ProxyRouter)
app.route('/api/knowledge', knowledgeRouter)
app.route('/api/webhooks', webhooksRouter)

// ─── MCP Reverse Proxy ────────────────────────────────────────────
// Forward /mcp requests to the internal cortex-mcp container.
// This allows agents to reach MCP through the same domain/port as
// the dashboard, which is critical for Cloudflare Tunnel setups
// where MCP must be reachable without a separate port or VPN.
const MCP_UPSTREAM = process.env['MCP_INTERNAL_URL'] || 'http://cortex-mcp:8317'

function getForwardedHeaders(req: Request): {
  host: string
  proto: string
} {
  const url = new URL(req.url)
  return {
    host: req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host,
    proto: req.headers.get('x-forwarded-proto') || url.protocol.replace(':', ''),
  }
}

app.all('/mcp', async (c) => {
  const upstream = `${MCP_UPSTREAM}/mcp`

  try {
    const headers = new Headers(c.req.raw.headers)
    const forwarded = getForwardedHeaders(c.req.raw)
    // Remove hop-by-hop headers that shouldn't be forwarded
    headers.delete('host')
    headers.delete('connection')
    headers.set('x-forwarded-host', forwarded.host)
    headers.set('x-forwarded-proto', forwarded.proto)

    const upstreamRes = await fetch(upstream, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
      // @ts-ignore — duplex required for streaming request bodies in Node 18+
      duplex: 'half',
      signal: AbortSignal.timeout(120_000),
    })

    // Stream the response back to the client
    const responseHeaders = new Headers(upstreamRes.headers)
    responseHeaders.delete('transfer-encoding') // let Hono handle this

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    })
  } catch (err: any) {
    logger.error(`[MCP Proxy] Failed to reach upstream: ${err.message}`)
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: `MCP proxy error: ${err.message}` },
      id: null,
    }, 502)
  }
})

// Forward MCP OAuth discovery endpoints too (mcp-remote probes these)
for (const oauthPath of [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
]) {
  app.all(oauthPath, async (c) => {
    try {
      const upstream = `${MCP_UPSTREAM}${oauthPath}`
      const forwarded = getForwardedHeaders(c.req.raw)
      const headers = new Headers({
        'Content-Type': 'application/json',
        'x-forwarded-host': forwarded.host,
        'x-forwarded-proto': forwarded.proto,
      })
      const res = await fetch(upstream, {
        method: c.req.method,
        headers,
        signal: AbortSignal.timeout(5_000),
      })
      const data = await res.json() as Record<string, unknown>
      return c.json(data, res.status as 200)
    } catch {
      return c.json({ error: 'MCP upstream unreachable' }, 502)
    }
  })
}

// Serve Dashboard Web static files (Next.js static export)
// Clean URLs: /keys → /keys.html, / → /index.html
app.use('/*', serveStatic({ 
  root: './public',
  rewriteRequestPath: (path) => {
    if (path === '/') return '/index.html'
    if (!path.includes('.') && !path.startsWith('/api/') && !path.startsWith('/_next/')) {
      return `${path}.html`
    }
    return path
  }
}))

// SPA fallback: serve index.html for unmatched client-side routes
app.get('*', serveStatic({
  root: './public',
  rewriteRequestPath: () => '/index.html'
}))

const port = Number(process.env.PORT) || 4000

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Dashboard API listening on http://localhost:${port}`)
})
