import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { registerCodeTools } from './tools/code.js'
import { registerCodeResources } from './resources/code.js'
import { registerCodePrompts } from './prompts/code.js'
import { registerHealthTools } from './tools/health.js'
import { registerIndexingTools } from './tools/indexing.js'
import { registerGraphTools } from './tools/graph.js'
import { registerKnowledgeTools } from './tools/knowledge.js'
import { registerMemoryTools } from './tools/memory.js'
import { registerQualityTools } from './tools/quality.js'
import { registerSessionTools } from './tools/session.js'
import { registerChangeTools } from './tools/changes.js'
import { registerAnalyticsTools } from './tools/analytics.js'
import { registerAdminTools } from './tools/admin.js'
import { validateApiKey } from './middleware/auth.js'
import { apiCall, telemetryStorage } from './api-call.js'
import type { Env } from './types.js'

const app = new Hono<{ Bindings: Env }>()
const authRequired = (process.env['MCP_AUTH_REQUIRED'] ?? 'true').toLowerCase() !== 'false'

function getHeaderValue(headers: Headers, key: string): string | undefined {
  const value = headers.get(key)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value
    ?.split(',')
    .map((entry) => entry.trim())
    .find(Boolean)
}

function inferClientApp(headers: Headers, agentId?: string): string | undefined {
  const explicit = getHeaderValue(headers, 'x-cortex-client-app')
  if (explicit) return explicit

  const haystack = [agentId ?? '', getHeaderValue(headers, 'user-agent') ?? '']
    .join(' ')
    .toLowerCase()

  const inferred = [
    ['antigravity', 'antigravity'],
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['cursor', 'cursor'],
    ['windsurf', 'windsurf'],
    ['gemini', 'gemini'],
  ] as Array<[string, string]>
  const match = inferred.find(([needle]) => haystack.includes(needle))

  return match?.[1] ?? agentId
}

function getRequestOrigin(req: Request): string {
  const headers = req.headers
  const forwardedProto = getHeaderValue(headers, 'x-forwarded-proto')
  const forwardedHost = getHeaderValue(headers, 'x-forwarded-host')

  if (forwardedHost) {
    const proto = forwardedProto ?? 'https'
    return `${proto}://${forwardedHost}`
  }

  // Fallback: use PUBLIC_URL env var when deployed behind a reverse proxy
  // (e.g., Cloudflare Tunnel → dashboard-api → cortex-mcp) where
  // x-forwarded-* headers may not reach this container.
  const publicUrl = process.env['PUBLIC_URL']
  if (publicUrl) {
    try {
      return new URL(publicUrl).origin
    } catch {
      /* invalid URL, ignore */
    }
  }

  return new URL(req.url).origin
}

// Bridge process.env → c.env for Node.js runtime
// (In Cloudflare Workers, c.env is auto-populated from wrangler bindings.
//  In Node.js, c.env is empty — this middleware fills it from process.env.)
app.use('*', async (c, next) => {
  const envKeys: (keyof Env)[] = [
    'QDRANT_URL',
    'CLIPROXY_URL',
    'DASHBOARD_API_URL',
    'MCP_SERVER_NAME',
    'MCP_SERVER_VERSION',
    'CLIENT_TRANSPORT',
    'CLIENT_APP',
    'CLIENT_HOST',
    'CLIENT_IP',
    'CLIENT_USER_AGENT',
  ]
  for (const key of envKeys) {
    if (!c.env[key] && process.env[key]) {
      ;(c.env as unknown as Record<string, string>)[key] = process.env[key]!
    }
  }
  await next()
})

app.use('*', cors())
app.use('*', logger())

// Global error handler — return JSON instead of text/plain
app.onError((err, c) => {
  console.error('[MCP Global Error]', err.message, err.stack)
  return c.json(
    {
      jsonrpc: '2.0',
      error: { code: -32603, message: err.message },
      id: null,
    },
    500,
  )
})

// Health endpoint (no auth required)
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'hub-mcp',
    version: c.env.MCP_SERVER_VERSION ?? '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

// ─── OAuth Discovery Stubs ────────────────────────────────────────
// mcp-remote probes these endpoints before using Bearer auth.
// Without proper responses, it hangs. Return RFC 9728 Protected
// Resource Metadata telling the client to use Bearer tokens.

// RFC 9728: Protected Resource Metadata (path-aware for /mcp)
app.get('/.well-known/oauth-protected-resource/mcp', (c) => {
  const origin = getRequestOrigin(c.req.raw)
  return c.json({
    resource: `${origin}/mcp`,
    bearer_methods_supported: ['header'],
    resource_documentation: origin,
  })
})

// Fallback: root-level Protected Resource Metadata
app.get('/.well-known/oauth-protected-resource', (c) => {
  const origin = getRequestOrigin(c.req.raw)
  return c.json({
    resource: `${origin}/`,
    bearer_methods_supported: ['header'],
    resource_documentation: origin,
  })
})

// Return 404 for OAuth endpoints we don't support (authorization server, OpenID)
// This is intentional — we use static Bearer tokens, not OAuth flows.
app.get('/.well-known/oauth-authorization-server', (c) =>
  c.json({ error: 'OAuth not supported. Use Bearer token.' }, 404),
)
app.get('/.well-known/openid-configuration', (c) =>
  c.json({ error: 'OAuth not supported. Use Bearer token.' }, 404),
)
app.post('/register', (c) => c.json({ error: 'Dynamic client registration not supported.' }, 404))

// Root endpoint — server info
app.get('/', (c) => {
  return c.json({
    name: 'Cortex Hub MCP Server',
    version: c.env.MCP_SERVER_VERSION ?? '0.1.0',
    mcp: '/mcp',
    health: '/health',
    tools: [
      'cortex_health',
      'cortex_memory_store',
      'cortex_memory_search',
      'cortex_knowledge_store',
      'cortex_knowledge_search',
      'cortex_code_search',
      'cortex_code_impact',
      'cortex_code_context',
      'cortex_code_reindex',
      'cortex_list_repos',
      'cortex_cypher',
      'cortex_detect_changes',
      'cortex_code_read',
      'cortex_graph_search',
      'cortex_graph_slice',
      'cortex_file_neighbors',
      'cortex_symbol_brief',
      'cortex_quality_report',
      'cortex_session_start',
      'cortex_session_end',
      'cortex_changes',
      'cortex_plan_quality',
      'cortex_tool_stats',
      'cortex_list_knowledge_docs',
      'cortex_update_knowledge_doc',
      'cortex_list_projects_admin',
      'cortex_update_project_admin',
      'cortex_gitnexus_registry_audit',
      'cortex_gitnexus_registry_cleanup',
      'cortex_project_cleanup',
    ],
    resources: [
      'cortex://projects',
      'cortex://project/{projectId}/context',
      'cortex://project/{projectId}/clusters',
      'cortex://project/{projectId}/cluster/{clusterName}',
      'cortex://project/{projectId}/processes',
      'cortex://project/{projectId}/process/{processName}',
      'cortex://project/{projectId}/schema',
    ],
    prompts: ['cortex_detect_impact', 'cortex_generate_map'],
  })
})

// Helper: create MCP server with tools registered
function createMcpServer(env: Env) {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME ?? 'cortex-hub',
    version: env.MCP_SERVER_VERSION ?? '0.1.0',
  })
  registerCodeResources(server, env)
  registerCodePrompts(server, env)
  registerHealthTools(server, env)
  registerMemoryTools(server, env)
  registerKnowledgeTools(server, env)
  registerCodeTools(server, env)
  registerGraphTools(server, env)
  registerIndexingTools(server, env)
  registerQualityTools(server, env)
  registerSessionTools(server, env)
  registerChangeTools(server, env)
  registerAnalyticsTools(server, env)
  registerAdminTools(server, env)
  return server
}

// ─── MCP Streamable HTTP handler ───────────────────────────────────
// Supports both GET (SSE stream) and POST (JSON-RPC) as required by
// the MCP Streamable HTTP transport spec. This is what mcp-remote expects.
//
// Stateless mode: each request gets a fresh transport + server.
// enableJsonResponse: true allows simple request/response without SSE.
app.all('/mcp', async (c) => {
  // ─── Auth: resolve API key owner (strict by default) ───────────
  const envWithOwner = { ...c.env } as Env & { API_KEY_OWNER?: string; API_KEY_TOKEN?: string }

  let authResult: {
    valid: boolean
    error?: string
    agentId?: string
    scope?: string
    token?: string
  } = { valid: false, error: 'Unauthorized' }
  try {
    authResult = await validateApiKey(c.req.raw, c.env)
  } catch (error) {
    authResult = {
      valid: false,
      error: `Authentication check failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (authRequired && !authResult.valid) {
    c.header('WWW-Authenticate', 'Bearer realm="cortex-hub"')
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: authResult.error ?? 'Unauthorized' },
        id: null,
      },
      401,
    )
  }

  if (authResult.valid && authResult.agentId) {
    envWithOwner.API_KEY_OWNER = authResult.agentId
  }
  if (authResult.valid && authResult.token) {
    envWithOwner.API_KEY_TOKEN = authResult.token
  }
  envWithOwner.CLIENT_TRANSPORT = 'mcp'
  envWithOwner.CLIENT_APP =
    inferClientApp(c.req.raw.headers, authResult.agentId) ?? envWithOwner.CLIENT_APP
  envWithOwner.CLIENT_HOST =
    getHeaderValue(c.req.raw.headers, 'x-cortex-client-host') ?? envWithOwner.CLIENT_HOST
  envWithOwner.CLIENT_IP =
    getHeaderValue(c.req.raw.headers, 'x-cortex-client-ip') ??
    firstForwardedValue(getHeaderValue(c.req.raw.headers, 'cf-connecting-ip')) ??
    firstForwardedValue(getHeaderValue(c.req.raw.headers, 'x-forwarded-for')) ??
    getHeaderValue(c.req.raw.headers, 'x-real-ip') ??
    envWithOwner.CLIENT_IP
  envWithOwner.CLIENT_USER_AGENT =
    getHeaderValue(c.req.raw.headers, 'user-agent') ?? envWithOwner.CLIENT_USER_AGENT

  const mcpServer = createMcpServer(envWithOwner)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  })

  await mcpServer.connect(transport)

  const startTime = Date.now()
  let bodyText = ''
  try {
    bodyText = await c.req.text()
  } catch (e) {}

  const newReq = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: bodyText,
  })

  let toolName = 'unknown'
  let projectId = null
  let argsObj = null
  try {
    const p = JSON.parse(bodyText)
    if (p.method === 'tools/call') {
      toolName = p.params?.name
      argsObj = p.params?.arguments
      projectId = argsObj?.projectId || argsObj?.project_id || null
      if (toolName === 'cortex_session_start' && argsObj?.repo) {
        projectId = argsObj.repo.split('/').pop()?.replace('.git', '') || null
      }
    }
  } catch (e) {}

  try {
    const response = await telemetryStorage.run(
      { computeTokens: 0, computeModel: null },
      async () => {
        const res = await transport.handleRequest(newReq)
        const latencyMs = Date.now() - startTime
        const inputSize = bodyText.length

        let outputSize = 0
        let respBody = ''
        try {
          const cloned = res.clone()
          respBody = await cloned.text()
          outputSize = respBody.length
        } catch {
          /* ignore clone failures */
        }

        const store = telemetryStorage.getStore()
        const computeTokens = store?.computeTokens || 0
        const computeModel = store?.computeModel || null

        const agentId = envWithOwner.API_KEY_OWNER || 'unknown'

        if (toolName !== 'unknown') {
          apiCall(envWithOwner, '/api/metrics/query-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              tool: toolName,
              params: argsObj,
              status: res.status >= 400 ? 'error' : 'ok',
              latencyMs,
              projectId,
              inputSize,
              outputSize,
              computeTokens,
              computeModel,
            }),
          }).catch((err: any) => console.error('[MCP Telemetry Error]', err))
        }

        if (toolName !== 'unknown' && toolName !== 'cortex_health' && agentId !== 'unknown') {
          try {
            const hintsRes = await apiCall(
              envWithOwner,
              `/api/metrics/hints/${encodeURIComponent(agentId)}?currentTool=${encodeURIComponent(toolName)}`,
              { signal: AbortSignal.timeout(2000) },
            )
            if (hintsRes.ok) {
              const hintsData = (await hintsRes.json()) as { hints: string[] }
              if (hintsData.hints.length > 0 && respBody) {
                try {
                  const parsed = JSON.parse(respBody)
                  if (parsed.result?.content && Array.isArray(parsed.result.content)) {
                    const lastItem = parsed.result.content[parsed.result.content.length - 1]
                    if (lastItem?.type === 'text' && typeof lastItem.text === 'string') {
                      lastItem.text +=
                        '\n\n---\n💡 Cortex hints:\n' +
                        hintsData.hints.map((h: string) => `  ${h}`).join('\n')
                    }
                    const modifiedBody = JSON.stringify(parsed)
                    return new Response(modifiedBody, {
                      status: res.status,
                      headers: res.headers,
                    })
                  }
                } catch {
                  /* JSON parse failed */
                }
              }
            }
          } catch {
            /* hints fetch failed */
          }
        }

        return res
      },
    )

    return response
  } catch (error: any) {
    console.error('[MCP Streamable Error]', error)
    const latencyMs = Date.now() - startTime

    if (toolName !== 'unknown') {
      apiCall(envWithOwner, '/api/metrics/query-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: envWithOwner.API_KEY_OWNER || 'unknown',
          tool: toolName,
          params: argsObj,
          status: 'error',
          error: error.message,
          latencyMs,
          projectId,
          inputSize: bodyText.length,
          outputSize: 0,
        }),
      }).catch((err: any) => console.error('[MCP Telemetry Error]', err))
    }

    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: error.message || 'Internal error' },
        id: null,
      },
      500,
    )
  }
})

export default app
