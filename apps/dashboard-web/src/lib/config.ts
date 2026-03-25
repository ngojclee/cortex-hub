const browserHost = typeof window !== 'undefined' ? window.location.hostname : ''
const isLocalHost = browserHost === 'localhost' || browserHost === '127.0.0.1'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? (isLocalHost ? 'http://localhost:4000' : 'https://cortex-api.jackle.dev')
const MCP_BASE = process.env.NEXT_PUBLIC_MCP_URL ?? (isLocalHost ? 'http://localhost:8318' : 'https://cortex-mcp.jackle.dev')

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
      models: `${process.env.NEXT_PUBLIC_CLIPROXY_URL || (isLocalHost ? 'http://localhost:8317' : 'https://cortex-llm.jackle.dev')}/v1/models`,
    }
  },
  mcp: {
    base: MCP_BASE,
    endpoint: `${MCP_BASE}/mcp`,
    health: `${MCP_BASE}/health`,
  },
  services: {
    cliproxy: process.env.NEXT_PUBLIC_CLIPROXY_URL ?? (isLocalHost ? 'http://localhost:8317' : 'https://cortex-llm.jackle.dev'),
    qdrant: process.env.NEXT_PUBLIC_QDRANT_URL ?? (isLocalHost ? 'http://localhost:6333' : 'https://qdrant.hub.jackle.dev'),
  },
}
