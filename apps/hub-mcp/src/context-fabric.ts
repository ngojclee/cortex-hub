import { apiCall } from './api-call.js'
import type { Env } from './types.js'

type JsonRecord = Record<string, unknown>

type ProjectContextResponse = {
  success?: boolean
  data?: {
    project?: JsonRecord
    stats?: JsonRecord
    toolsAvailable?: string[]
    resourcesAvailable?: string[]
    hint?: string | null
  }
}

type ProjectClustersResponse = {
  success?: boolean
  data?: {
    clusters?: Array<JsonRecord>
  }
}

type ProjectClusterDetailResponse = {
  success?: boolean
  data?: {
    cluster?: JsonRecord | null
    members?: Array<JsonRecord>
  }
}

type ProjectProcessesResponse = {
  success?: boolean
  data?: {
    processes?: Array<JsonRecord>
  }
}

type ProjectProcessDetailResponse = {
  success?: boolean
  data?: {
    process?: JsonRecord
    steps?: Array<JsonRecord>
  }
}

export type ContextFabricSummary = {
  projectId: string
  projectName: string | null
  branch: string | null
  staleness: string | null
  indexHint: string | null
  resources: {
    overview: string
    clusters: string
    processes: string
    schema: string
    clusterDetails: string[]
    processDetails: string[]
  }
  stats: {
    files: number | null
    symbols: number | null
    relationships: number | null
    processes: number | null
  }
  topClusters: Array<{
    name: string
    symbols: number | null
    cohesion: number | null
    uri: string
  }>
  topProcesses: Array<{
    name: string
    type: string | null
    steps: number | null
    uri: string
  }>
  suggestedFiles: string[]
  suggestedNext: {
    resources: string[]
    tools: string[]
    workflow: string[]
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function uniqueStrings(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>()
  const items: string[] = []

  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    items.push(value)
    if (items.length >= limit) break
  }

  return items
}

async function fetchJson<T>(env: Env, path: string): Promise<T> {
  const response = await apiCall(env, path)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`${path} failed: ${response.status} ${errorText}`)
  }
  return response.json() as Promise<T>
}

function buildResourceUri(projectId: string, kind: 'context' | 'clusters' | 'processes' | 'schema'): string {
  return `cortex://project/${projectId}/${kind}`
}

function buildClusterUri(projectId: string, clusterName: string): string {
  return `cortex://project/${projectId}/cluster/${encodeURIComponent(clusterName)}`
}

function buildProcessUri(projectId: string, processName: string): string {
  return `cortex://project/${projectId}/process/${encodeURIComponent(processName)}`
}

export async function buildContextFabric(
  env: Env,
  projectId: string,
  options?: {
    clusterLimit?: number
    processLimit?: number
    suggestedFileLimit?: number
  },
): Promise<ContextFabricSummary | null> {
  const clusterLimit = options?.clusterLimit ?? 3
  const processLimit = options?.processLimit ?? 3
  const suggestedFileLimit = options?.suggestedFileLimit ?? 8

  const [contextResponse, clustersResponse, processesResponse] = await Promise.all([
    fetchJson<ProjectContextResponse>(
      env,
      `/api/intel/resources/project/${encodeURIComponent(projectId)}/context`,
    ),
    fetchJson<ProjectClustersResponse>(
      env,
      `/api/intel/resources/project/${encodeURIComponent(projectId)}/clusters?limit=${clusterLimit}`,
    ),
    fetchJson<ProjectProcessesResponse>(
      env,
      `/api/intel/resources/project/${encodeURIComponent(projectId)}/processes?limit=${processLimit}`,
    ),
  ])

  const project = contextResponse.data?.project
  if (!project) return null

  const stats = contextResponse.data?.stats ?? {}
  const topClusters = (clustersResponse.data?.clusters ?? []).slice(0, clusterLimit).map((cluster) => {
    const name =
      asString(cluster.name) ??
      asString(cluster.heuristicLabel) ??
      asString(cluster.label) ??
      'unknown-cluster'

    return {
      name,
      symbols: asNumber(cluster.symbols),
      cohesion: asNumber(cluster.cohesion),
      uri: buildClusterUri(projectId, name),
    }
  })

  const topProcesses = (processesResponse.data?.processes ?? []).slice(0, processLimit).map((process) => {
    const name =
      asString(process.name) ??
      asString(process.heuristicLabel) ??
      asString(process.label) ??
      'unknown-process'

    return {
      name,
      type: asString(process.type),
      steps: asNumber(process.steps),
      uri: buildProcessUri(projectId, name),
    }
  })

  const [clusterDetailResponses, processDetailResponses] = await Promise.all([
    Promise.all(
      topClusters.slice(0, 2).map((cluster) =>
        fetchJson<ProjectClusterDetailResponse>(
          env,
          `/api/intel/resources/project/${encodeURIComponent(projectId)}/cluster/${encodeURIComponent(cluster.name)}`,
        ).catch(() => null),
      ),
    ),
    Promise.all(
      topProcesses.slice(0, 2).map((process) =>
        fetchJson<ProjectProcessDetailResponse>(
          env,
          `/api/intel/resources/project/${encodeURIComponent(projectId)}/process/${encodeURIComponent(process.name)}`,
        ).catch(() => null),
      ),
    ),
  ])

  const suggestedFiles = uniqueStrings(
    [
      ...clusterDetailResponses.flatMap((response) =>
        (response?.data?.members ?? []).map((member) => asString(member.filePath)),
      ),
      ...processDetailResponses.flatMap((response) =>
        (response?.data?.steps ?? []).map((step) => asString(step.filePath)),
      ),
    ],
    suggestedFileLimit,
  )

  const tools = asString((project.gitnexus as JsonRecord | undefined)?.repoName)
    ? ['cortex_code_context', 'cortex_code_impact', 'cortex_code_search', 'cortex_cypher', 'cortex_code_read']
    : ['cortex_code_reindex', 'cortex_list_repos', 'cortex_code_search']

  const overviewUri = buildResourceUri(projectId, 'context')
  const clustersUri = buildResourceUri(projectId, 'clusters')
  const processesUri = buildResourceUri(projectId, 'processes')
  const schemaUri = buildResourceUri(projectId, 'schema')

  return {
    projectId,
    projectName: asString(project.name),
    branch: asString(project.branch),
    staleness: asString((project.staleness as JsonRecord | undefined)?.status),
    indexHint: contextResponse.data?.hint ?? null,
    resources: {
      overview: overviewUri,
      clusters: clustersUri,
      processes: processesUri,
      schema: schemaUri,
      clusterDetails: topClusters.map((cluster) => cluster.uri),
      processDetails: topProcesses.map((process) => process.uri),
    },
    stats: {
      files: asNumber(stats.files),
      symbols: asNumber(stats.symbols),
      relationships: asNumber(stats.relationships),
      processes: asNumber(stats.processes),
    },
    topClusters,
    topProcesses,
    suggestedFiles,
    suggestedNext: {
      resources: uniqueStrings(
        [
          overviewUri,
          clustersUri,
          processesUri,
          topClusters[0]?.uri,
          topProcesses[0]?.uri,
          schemaUri,
        ],
        6,
      ),
      tools,
      workflow: asString((project.gitnexus as JsonRecord | undefined)?.repoName)
        ? [
            'Read the project context resource first.',
            'Scan clusters and processes to choose the most relevant architecture slice.',
            'Open one detailed cluster or process resource before calling action tools.',
            'Use code tools only after the resource map is clear.',
          ]
        : [
            'Project is not fully indexed yet.',
            'Run indexing or repo registration first.',
            'Re-open the context, cluster, and process resources after indexing completes.',
          ],
    },
  }
}
