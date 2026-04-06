export type SharedConnectionMetadata = {
  transport?: string
  clientApp?: string
  clientHost?: string
  clientUserAgent?: string
  clientIp?: string
}

export type SharedProjectMetadata = {
  projectId?: string
  branch?: string
  filesTouched?: string[]
  symbolsTouched?: string[]
  processesAffected?: string[]
  clustersTouched?: string[]
  resourceUris?: string[]
  connection?: SharedConnectionMetadata
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined

  const seen = new Set<string>()
  const items: string[] = []

  for (const value of values) {
    const text = asString(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    items.push(text)
  }

  return items.length > 0 ? items : undefined
}

function compactConnectionMetadata(
  metadata: SharedConnectionMetadata | null | undefined,
): SharedConnectionMetadata | undefined {
  if (!metadata) return undefined

  const compacted: SharedConnectionMetadata = {}

  if (metadata.transport) compacted.transport = metadata.transport
  if (metadata.clientApp) compacted.clientApp = metadata.clientApp
  if (metadata.clientHost) compacted.clientHost = metadata.clientHost
  if (metadata.clientUserAgent) compacted.clientUserAgent = metadata.clientUserAgent
  if (metadata.clientIp) compacted.clientIp = metadata.clientIp

  return Object.keys(compacted).length > 0 ? compacted : undefined
}

function normalizeConnectionMetadata(
  value: unknown,
  defaults?: Partial<SharedConnectionMetadata>,
): SharedConnectionMetadata | undefined {
  const input = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  const normalized: SharedConnectionMetadata = {
    transport:
      asString(input.transport) ??
      asString(input.connectionTransport) ??
      asString(input.connection_transport) ??
      asString(defaults?.transport) ??
      undefined,
    clientApp:
      asString(input.clientApp) ??
      asString(input.client_app) ??
      asString(input.app) ??
      asString(defaults?.clientApp) ??
      undefined,
    clientHost:
      asString(input.clientHost) ??
      asString(input.client_host) ??
      asString(input.host) ??
      asString(defaults?.clientHost) ??
      undefined,
    clientUserAgent:
      asString(input.clientUserAgent) ??
      asString(input.client_user_agent) ??
      asString(input.userAgent) ??
      asString(input.user_agent) ??
      asString(defaults?.clientUserAgent) ??
      undefined,
    clientIp:
      asString(input.clientIp) ??
      asString(input.client_ip) ??
      asString(input.ip) ??
      asString(input.ip_address) ??
      asString(defaults?.clientIp) ??
      undefined,
  }

  return compactConnectionMetadata(normalized)
}

function withDefaults(
  normalized: SharedProjectMetadata,
  defaults?: Partial<SharedProjectMetadata>,
): SharedProjectMetadata {
  if (!defaults) return normalized

  const defaultProjectId = asString(defaults.projectId)
  const defaultBranch = asString(defaults.branch)

  return {
    projectId: normalized.projectId ?? defaultProjectId ?? undefined,
    branch: normalized.branch ?? defaultBranch ?? undefined,
    filesTouched: normalized.filesTouched ?? normalizeStringArray(defaults.filesTouched),
    symbolsTouched: normalized.symbolsTouched ?? normalizeStringArray(defaults.symbolsTouched),
    processesAffected: normalized.processesAffected ?? normalizeStringArray(defaults.processesAffected),
    clustersTouched: normalized.clustersTouched ?? normalizeStringArray(defaults.clustersTouched),
    resourceUris: normalized.resourceUris ?? normalizeStringArray(defaults.resourceUris),
    connection: normalized.connection ?? normalizeConnectionMetadata(defaults.connection),
  }
}

function compactMetadata(metadata: SharedProjectMetadata): SharedProjectMetadata | null {
  const compacted: SharedProjectMetadata = {}

  if (metadata.projectId) compacted.projectId = metadata.projectId
  if (metadata.branch) compacted.branch = metadata.branch
  if (metadata.filesTouched && metadata.filesTouched.length > 0) compacted.filesTouched = metadata.filesTouched
  if (metadata.symbolsTouched && metadata.symbolsTouched.length > 0) compacted.symbolsTouched = metadata.symbolsTouched
  if (metadata.processesAffected && metadata.processesAffected.length > 0) compacted.processesAffected = metadata.processesAffected
  if (metadata.clustersTouched && metadata.clustersTouched.length > 0) compacted.clustersTouched = metadata.clustersTouched
  if (metadata.resourceUris && metadata.resourceUris.length > 0) compacted.resourceUris = metadata.resourceUris
  if (metadata.connection) compacted.connection = metadata.connection

  return Object.keys(compacted).length > 0 ? compacted : null
}

export function normalizeSharedProjectMetadata(
  value: unknown,
  defaults?: Partial<SharedProjectMetadata>,
): SharedProjectMetadata | null {
  if (!value || typeof value !== 'object') {
    return defaults ? compactMetadata(withDefaults({}, defaults)) : null
  }

  const input = value as Record<string, unknown>
  const connectionInput = input.connection && typeof input.connection === 'object'
    ? input.connection
    : input
  const normalized = withDefaults(
    {
      projectId: asString(input.projectId) ?? asString(input.project_id) ?? undefined,
      branch: asString(input.branch) ?? undefined,
      filesTouched: normalizeStringArray(input.filesTouched) ?? normalizeStringArray(input.files_touched),
      symbolsTouched: normalizeStringArray(input.symbolsTouched) ?? normalizeStringArray(input.symbols_touched),
      processesAffected: normalizeStringArray(input.processesAffected) ?? normalizeStringArray(input.processes_affected),
      clustersTouched: normalizeStringArray(input.clustersTouched) ?? normalizeStringArray(input.clusters_touched),
      resourceUris: normalizeStringArray(input.resourceUris) ?? normalizeStringArray(input.resource_uris),
      connection: normalizeConnectionMetadata(connectionInput),
    },
    defaults,
  )

  return compactMetadata(normalized)
}

function unionStringArrays(a?: string[], b?: string[]): string[] | undefined {
  const values = [...(a ?? []), ...(b ?? [])]
  return normalizeStringArray(values)
}

function mergeConnectionMetadata(
  base: SharedConnectionMetadata | undefined,
  incoming: SharedConnectionMetadata | undefined,
): SharedConnectionMetadata | undefined {
  return compactConnectionMetadata({
    transport: incoming?.transport ?? base?.transport,
    clientApp: incoming?.clientApp ?? base?.clientApp,
    clientHost: incoming?.clientHost ?? base?.clientHost,
    clientUserAgent: incoming?.clientUserAgent ?? base?.clientUserAgent,
    clientIp: incoming?.clientIp ?? base?.clientIp,
  })
}

export function mergeSharedProjectMetadata(
  base: SharedProjectMetadata | null | undefined,
  incoming: SharedProjectMetadata | null | undefined,
): SharedProjectMetadata | null {
  const merged: SharedProjectMetadata = {
    projectId: incoming?.projectId ?? base?.projectId,
    branch: incoming?.branch ?? base?.branch,
    filesTouched: unionStringArrays(base?.filesTouched, incoming?.filesTouched),
    symbolsTouched: unionStringArrays(base?.symbolsTouched, incoming?.symbolsTouched),
    processesAffected: unionStringArrays(base?.processesAffected, incoming?.processesAffected),
    clustersTouched: unionStringArrays(base?.clustersTouched, incoming?.clustersTouched),
    resourceUris: unionStringArrays(base?.resourceUris, incoming?.resourceUris),
    connection: mergeConnectionMetadata(base?.connection, incoming?.connection),
  }

  return compactMetadata(merged)
}

export function parseSharedProjectMetadataJson(
  value: unknown,
  defaults?: Partial<SharedProjectMetadata>,
): SharedProjectMetadata | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return normalizeSharedProjectMetadata(JSON.parse(value), defaults)
    } catch {
      return defaults ? compactMetadata(withDefaults({}, defaults)) : null
    }
  }

  return normalizeSharedProjectMetadata(value, defaults)
}
