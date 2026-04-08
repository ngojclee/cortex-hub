import type { Context } from 'hono'

const ADMIN_SCOPES = new Set(['admin', 'owner', 'system', 'write', 'full'])

function parsePermissions(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function requireAdminAccess(c: Context): Response | null {
  const authType = c.get('authType') as string | undefined
  if (authType === 'session') return null

  if (authType === 'api_key') {
    const scope = String(c.get('authApiKeyScope') ?? '').toLowerCase()
    const permissions = parsePermissions(c.get('authApiKeyPermissions'))
    if (
      ADMIN_SCOPES.has(scope) ||
      permissions.includes('*') ||
      permissions.includes('admin') ||
      permissions.includes('admin:write') ||
      permissions.includes('knowledge:write') ||
      permissions.includes('project:write')
    ) {
      return null
    }
  }

  return c.json({ error: 'Admin access required' }, 403)
}
