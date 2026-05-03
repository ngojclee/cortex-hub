/**
 * Hub MCP Environment configuration.
 */
export interface Env {
  // Backend service URLs
  QDRANT_URL: string
  CLIPROXY_URL: string
  DASHBOARD_API_URL: string

  // MCP Server metadata
  MCP_SERVER_NAME: string
  MCP_SERVER_VERSION: string

  // Resolved at runtime from API key during auth
  // This is the authoritative identity of the caller (api_keys.name)
  API_KEY_OWNER?: string
  API_KEY_TOKEN?: string

  // Request-scoped client/source metadata propagated to dashboard-api
  CLIENT_TRANSPORT?: string
  CLIENT_APP?: string
  CLIENT_HOST?: string
  CLIENT_IP?: string
  CLIENT_USER_AGENT?: string
  CORTEX_ACCESS_URL?: string
  CORTEX_ACCESS_PORT?: string
}

