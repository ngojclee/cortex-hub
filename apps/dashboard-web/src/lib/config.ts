const hasWindow = typeof window !== 'undefined'
const browserHost = hasWindow ? window.location.hostname : ''
const browserProtocol = hasWindow ? window.location.protocol : 'http:'
const browserPort = hasWindow ? window.location.port : ''
const browserOrigin = hasWindow ? window.location.origin : ''
const isLocalHost = browserHost === 'localhost' || browserHost === '127.0.0.1'

const inferPortUrl = (port: number) => `${browserProtocol}//${browserHost || 'localhost'}:${port}`

const localApiBase = hasWindow
  ? (browserPort === '3000' ? inferPortUrl(4000) : browserOrigin || 'http://localhost:4000')
  : 'http://localhost:4000'

const ACCESS_BASE = process.env.NEXT_PUBLIC_CORTEX_ACCESS_URL
const PUBLIC_BASE = process.env.NEXT_PUBLIC_CORTEX_PUBLIC_URL ?? 'https://cortexhub.lengoc.me'
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? (isLocalHost ? localApiBase : browserOrigin || 'http://localhost:4000')
const MCP_BASE = process.env.NEXT_PUBLIC_MCP_URL ?? API_BASE
const MCP_ACCESS_BASE = ACCESS_BASE ?? (isLocalHost ? localApiBase : MCP_BASE)
const CLIPROXY_BASE = process.env.NEXT_PUBLIC_CLIPROXY_URL ?? (hasWindow ? inferPortUrl(8317) : 'http://localhost:8317')
const QDRANT_BASE = process.env.NEXT_PUBLIC_QDRANT_URL ?? (hasWindow ? inferPortUrl(6333) : 'http://localhost:6333')

export const config = {
  api: {
    base: API_BASE,
    health: `${API_BASE}/health`,
    keys: `${API_BASE}/api/keys`,
    setup: `${API_BASE}/api/setup`,
    mcp: {
      endpoint: `${MCP_BASE}/mcp`,
      health: `${MCP_BASE}/health`,
    },
    llmProxy: {
      models: `${CLIPROXY_BASE}/v1/models`,
    }
  },
  mcp: {
    base: MCP_BASE,
    endpoint: `${MCP_BASE}/mcp`,
    accessEndpoint: `${MCP_ACCESS_BASE.replace(/\/$/, '')}/mcp`,
    health: `${MCP_BASE}/health`,
    publicEndpoint: `${PUBLIC_BASE.replace(/\/$/, '')}/mcp`,
  },
  services: {
    cliproxy: CLIPROXY_BASE,
    qdrant: QDRANT_BASE,
  },
}
