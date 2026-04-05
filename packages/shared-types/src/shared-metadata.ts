export type SharedProjectMetadata = {
  projectId?: string
  branch?: string
  filesTouched?: string[]
  symbolsTouched?: string[]
  processesAffected?: string[]
  clustersTouched?: string[]
  resourceUris?: string[]
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
  const normalized = withDefaults(
    {
      projectId: asString(input.projectId) ?? asString(input.project_id) ?? undefined,
      branch: asString(input.branch) ?? undefined,
      filesTouched: normalizeStringArray(input.filesTouched) ?? normalizeStringArray(input.files_touched),
      symbolsTouched: normalizeStringArray(input.symbolsTouched) ?? normalizeStringArray(input.symbols_touched),
      processesAffected: normalizeStringArray(input.processesAffected) ?? normalizeStringArray(input.processes_affected),
      clustersTouched: normalizeStringArray(input.clustersTouched) ?? normalizeStringArray(input.clusters_touched),
      resourceUris: normalizeStringArray(input.resourceUris) ?? normalizeStringArray(input.resource_uris),
    },
    defaults,
  )

  return compactMetadata(normalized)
}

function unionStringArrays(a?: string[], b?: string[]): string[] | undefined {
  const values = [...(a ?? []), ...(b ?? [])]
  return normalizeStringArray(values)
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
