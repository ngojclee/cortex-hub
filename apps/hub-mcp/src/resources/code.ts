import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { Env } from '../types.js'
import { apiCall } from '../api-call.js'

type ProjectsResourceItem = {
  projectId: string
  slug: string
  name: string
  branch?: string | null
  symbols?: number | null
  staleness?: { status?: string | null }
  gitnexus?: { registered?: boolean; repoName?: string | null }
}

type ProjectsResourceResponse = {
  success?: boolean
  data?: {
    items?: ProjectsResourceItem[]
  }
}

type ProjectContextResourceResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    stats?: Record<string, any>
    toolsAvailable?: string[]
    resourcesAvailable?: string[]
    hint?: string | null
  }
}

type ProjectClustersResourceResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    repo?: string | null
    clusters?: Array<Record<string, any>>
    hint?: string | null
  }
}

type ProjectClusterDetailResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    repo?: string | null
    cluster?: Record<string, any> | null
    members?: Array<Record<string, any>>
  }
}

type ProjectProcessesResourceResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    repo?: string | null
    processes?: Array<Record<string, any>>
    hint?: string | null
  }
}

type ProjectProcessDetailResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    repo?: string | null
    process?: Record<string, any>
    steps?: Array<Record<string, any>>
  }
}

type ProjectSchemaResourceResponse = {
  success?: boolean
  data?: {
    project?: Record<string, any>
    schema?: string
    toolsAvailable?: string[]
    resourcesAvailable?: string[]
  }
}

async function fetchJson<T>(env: Env, path: string): Promise<T> {
  const response = await apiCall(env, path)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`${path} failed: ${response.status} ${errorText}`)
  }
  return response.json() as Promise<T>
}

async function listProjects(env: Env): Promise<ProjectsResourceItem[]> {
  const response = await fetchJson<ProjectsResourceResponse>(env, '/api/intel/resources/projects')
  return response.data?.items ?? []
}

async function completeProjectIds(env: Env, value: string): Promise<string[]> {
  const needle = value.toLowerCase()
  const projects = await listProjects(env)
  return projects
    .map((project) => project.projectId)
    .filter((projectId) => projectId.toLowerCase().includes(needle))
    .slice(0, 25)
}

async function completeClusterNames(env: Env, projectId: string, value: string): Promise<string[]> {
  const needle = value.toLowerCase()
  const response = await fetchJson<ProjectClustersResourceResponse>(
    env,
    `/api/intel/resources/project/${encodeURIComponent(projectId)}/clusters?limit=100`,
  )
  return (response.data?.clusters ?? [])
    .map((cluster) => String(cluster.name ?? ''))
    .filter((name) => name.toLowerCase().includes(needle))
    .slice(0, 25)
}

async function completeProcessNames(env: Env, projectId: string, value: string): Promise<string[]> {
  const needle = value.toLowerCase()
  const response = await fetchJson<ProjectProcessesResourceResponse>(
    env,
    `/api/intel/resources/project/${encodeURIComponent(projectId)}/processes?limit=100`,
  )
  return (response.data?.processes ?? [])
    .map((process) => String(process.name ?? ''))
    .filter((name) => name.toLowerCase().includes(needle))
    .slice(0, 25)
}

function yamlValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value))
}

function textResource(uri: URL, text: string, mimeType = 'text/yaml') {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text,
      },
    ],
  }
}

function formatProjectsResource(items: ProjectsResourceItem[]): string {
  if (items.length === 0) return 'projects: []'

  const lines = ['projects:']
  for (const item of items) {
    lines.push(`  - projectId: ${yamlValue(item.projectId)}`)
    lines.push(`    slug: ${yamlValue(item.slug)}`)
    lines.push(`    name: ${yamlValue(item.name)}`)
    lines.push(`    branch: ${yamlValue(item.branch ?? null)}`)
    lines.push(`    symbols: ${yamlValue(item.symbols ?? null)}`)
    lines.push(`    staleness: ${yamlValue(item.staleness?.status ?? null)}`)
    lines.push(`    gitnexus_registered: ${yamlValue(item.gitnexus?.registered ?? false)}`)
    lines.push(`    gitnexus_repo: ${yamlValue(item.gitnexus?.repoName ?? null)}`)
  }

  return lines.join('\n')
}

function formatProjectContextResource(data: ProjectContextResourceResponse['data']): string {
  const project = data?.project ?? {}
  const stats = data?.stats ?? {}

  const lines = [
    `projectId: ${yamlValue(project.projectId ?? null)}`,
    `slug: ${yamlValue(project.slug ?? null)}`,
    `name: ${yamlValue(project.name ?? null)}`,
    `branch: ${yamlValue(project.branch ?? null)}`,
    `description: ${yamlValue(project.description ?? null)}`,
    '',
    'organization:',
    `  id: ${yamlValue(project.organization?.id ?? null)}`,
    `  name: ${yamlValue(project.organization?.name ?? null)}`,
    `  slug: ${yamlValue(project.organization?.slug ?? null)}`,
    '',
    'gitnexus:',
    `  registered: ${yamlValue(project.gitnexus?.registered ?? false)}`,
    `  repoName: ${yamlValue(project.gitnexus?.repoName ?? null)}`,
    `  path: ${yamlValue(project.gitnexus?.path ?? null)}`,
    `  indexedAt: ${yamlValue(project.gitnexus?.indexedAt ?? null)}`,
    '',
    'staleness:',
    `  status: ${yamlValue(project.staleness?.status ?? null)}`,
    `  basedOn: ${yamlValue(project.staleness?.basedOn ?? null)}`,
    `  indexedAt: ${yamlValue(project.staleness?.indexedAt ?? null)}`,
    `  ageHours: ${yamlValue(project.staleness?.ageHours ?? null)}`,
    '',
    'stats:',
    `  files: ${yamlValue(stats.files ?? null)}`,
    `  symbols: ${yamlValue(stats.symbols ?? null)}`,
    `  relationships: ${yamlValue(stats.relationships ?? null)}`,
    `  processes: ${yamlValue(stats.processes ?? null)}`,
  ]

  const tools = data?.toolsAvailable ?? []
  if (tools.length > 0) {
    lines.push('', 'tools_available:')
    for (const tool of tools) {
      lines.push(`  - ${tool}`)
    }
  }

  const resources = data?.resourcesAvailable ?? []
  if (resources.length > 0) {
    lines.push('', 'resources_available:')
    for (const resource of resources) {
      lines.push(`  - ${resource}`)
    }
  }

  if (data?.hint) {
    lines.push('', `hint: ${yamlValue(data.hint)}`)
  }

  return lines.join('\n')
}

function formatClustersResource(data: ProjectClustersResourceResponse['data']): string {
  const clusters = data?.clusters ?? []
  const lines = [
    `projectId: ${yamlValue(data?.project?.projectId ?? null)}`,
    `slug: ${yamlValue(data?.project?.slug ?? null)}`,
    `repo: ${yamlValue(data?.repo ?? null)}`,
    '',
  ]

  if (clusters.length === 0) {
    lines.push('clusters: []')
    if (data?.hint) lines.push(`hint: ${yamlValue(data.hint)}`)
    return lines.join('\n')
  }

  lines.push('clusters:')
  for (const cluster of clusters) {
    lines.push(`  - name: ${yamlValue(cluster.name ?? null)}`)
    lines.push(`    symbols: ${yamlValue(cluster.symbols ?? null)}`)
    lines.push(`    cohesion: ${yamlValue(cluster.cohesion ?? null)}`)
    lines.push(`    subCommunities: ${yamlValue(cluster.subCommunities ?? null)}`)
  }

  return lines.join('\n')
}

function formatClusterDetailResource(data: ProjectClusterDetailResponse['data']): string {
  const cluster = data?.cluster ?? {}
  const members = data?.members ?? []
  const lines = [
    `projectId: ${yamlValue(data?.project?.projectId ?? null)}`,
    `slug: ${yamlValue(data?.project?.slug ?? null)}`,
    `repo: ${yamlValue(data?.repo ?? null)}`,
    '',
    'cluster:',
    `  id: ${yamlValue(cluster.id ?? null)}`,
    `  name: ${yamlValue(cluster.name ?? null)}`,
    `  label: ${yamlValue(cluster.label ?? null)}`,
    `  heuristicLabel: ${yamlValue(cluster.heuristicLabel ?? null)}`,
    `  symbols: ${yamlValue(cluster.symbols ?? null)}`,
    `  cohesion: ${yamlValue(cluster.cohesion ?? null)}`,
    `  subCommunities: ${yamlValue(cluster.subCommunities ?? null)}`,
  ]

  lines.push('', 'members:')
  if (members.length === 0) {
    lines.push('  []')
  } else {
    for (const member of members) {
      lines.push(`  - name: ${yamlValue(member.name ?? null)}`)
      lines.push(`    type: ${yamlValue(member.type ?? null)}`)
      lines.push(`    filePath: ${yamlValue(member.filePath ?? null)}`)
    }
  }

  return lines.join('\n')
}

function formatProcessesResource(data: ProjectProcessesResourceResponse['data']): string {
  const processes = data?.processes ?? []
  const lines = [
    `projectId: ${yamlValue(data?.project?.projectId ?? null)}`,
    `slug: ${yamlValue(data?.project?.slug ?? null)}`,
    `repo: ${yamlValue(data?.repo ?? null)}`,
    '',
  ]

  if (processes.length === 0) {
    lines.push('processes: []')
    if (data?.hint) lines.push(`hint: ${yamlValue(data.hint)}`)
    return lines.join('\n')
  }

  lines.push('processes:')
  for (const process of processes) {
    lines.push(`  - name: ${yamlValue(process.name ?? null)}`)
    lines.push(`    type: ${yamlValue(process.type ?? null)}`)
    lines.push(`    steps: ${yamlValue(process.steps ?? null)}`)
  }

  return lines.join('\n')
}

function formatProcessDetailResource(data: ProjectProcessDetailResponse['data']): string {
  const process = data?.process ?? {}
  const steps = data?.steps ?? []
  const lines = [
    `projectId: ${yamlValue(data?.project?.projectId ?? null)}`,
    `slug: ${yamlValue(data?.project?.slug ?? null)}`,
    `repo: ${yamlValue(data?.repo ?? null)}`,
    '',
    'process:',
    `  id: ${yamlValue(process.id ?? null)}`,
    `  name: ${yamlValue(process.name ?? null)}`,
    `  label: ${yamlValue(process.label ?? null)}`,
    `  heuristicLabel: ${yamlValue(process.heuristicLabel ?? null)}`,
    `  type: ${yamlValue(process.type ?? null)}`,
    `  steps: ${yamlValue(process.steps ?? null)}`,
    '',
    'trace:',
  ]

  if (steps.length === 0) {
    lines.push('  []')
  } else {
    for (const step of steps) {
      lines.push(`  - step: ${yamlValue(step.step ?? null)}`)
      lines.push(`    name: ${yamlValue(step.name ?? null)}`)
      lines.push(`    type: ${yamlValue(step.type ?? null)}`)
      lines.push(`    filePath: ${yamlValue(step.filePath ?? null)}`)
    }
  }

  return lines.join('\n')
}

function formatSchemaResource(data: ProjectSchemaResourceResponse['data']): string {
  const lines = [
    `projectId: ${yamlValue(data?.project?.projectId ?? null)}`,
    `slug: ${yamlValue(data?.project?.slug ?? null)}`,
    '',
  ]

  const tools = data?.toolsAvailable ?? []
  if (tools.length > 0) {
    lines.push('tools_available:')
    for (const tool of tools) {
      lines.push(`  - ${tool}`)
    }
    lines.push('')
  }

  const resources = data?.resourcesAvailable ?? []
  if (resources.length > 0) {
    lines.push('resources_available:')
    for (const resource of resources) {
      lines.push(`  - ${resource}`)
    }
    lines.push('')
  }

  lines.push(data?.schema ?? '# No schema available')
  return lines.join('\n')
}

export function registerCodeResources(server: McpServer, env: Env) {
  server.registerResource(
    'cortex_projects',
    'cortex://projects',
    {
      title: 'Cortex Projects',
      description: 'All Cortex projects with GitNexus registration and staleness summary.',
      mimeType: 'text/yaml',
    },
    async (uri) => {
      const items = await listProjects(env)
      return textResource(uri, formatProjectsResource(items))
    },
  )

  server.registerResource(
    'cortex_project_context',
    new ResourceTemplate('cortex://project/{projectId}/context', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
      },
    }),
    {
      title: 'Project Context',
      description: 'Overview of one project: mapping, staleness, stats, and companion resources.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const response = await fetchJson<ProjectContextResourceResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/context`,
      )
      return textResource(uri, formatProjectContextResource(response.data))
    },
  )

  server.registerResource(
    'cortex_project_clusters',
    new ResourceTemplate('cortex://project/{projectId}/clusters', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
      },
    }),
    {
      title: 'Project Clusters',
      description: 'Functional areas discovered for one project.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const response = await fetchJson<ProjectClustersResourceResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/clusters`,
      )
      return textResource(uri, formatClustersResource(response.data))
    },
  )

  server.registerResource(
    'cortex_project_cluster_detail',
    new ResourceTemplate('cortex://project/{projectId}/cluster/{clusterName}', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
        clusterName: async (value, context) => {
          const projectId = context?.arguments?.projectId
          if (!projectId) return []
          return completeClusterNames(env, projectId, value)
        },
      },
    }),
    {
      title: 'Cluster Detail',
      description: 'Detailed view of one functional area and its member symbols.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const clusterName = String(variables.clusterName ?? '')
      const response = await fetchJson<ProjectClusterDetailResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/cluster/${encodeURIComponent(clusterName)}`,
      )
      return textResource(uri, formatClusterDetailResource(response.data))
    },
  )

  server.registerResource(
    'cortex_project_processes',
    new ResourceTemplate('cortex://project/{projectId}/processes', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
      },
    }),
    {
      title: 'Project Processes',
      description: 'Execution flows discovered for one project.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const response = await fetchJson<ProjectProcessesResourceResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/processes`,
      )
      return textResource(uri, formatProcessesResource(response.data))
    },
  )

  server.registerResource(
    'cortex_project_process_detail',
    new ResourceTemplate('cortex://project/{projectId}/process/{processName}', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
        processName: async (value, context) => {
          const projectId = context?.arguments?.projectId
          if (!projectId) return []
          return completeProcessNames(env, projectId, value)
        },
      },
    }),
    {
      title: 'Process Detail',
      description: 'Step-by-step trace for one execution flow.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const processName = String(variables.processName ?? '')
      const response = await fetchJson<ProjectProcessDetailResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/process/${encodeURIComponent(processName)}`,
      )
      return textResource(uri, formatProcessDetailResource(response.data))
    },
  )

  server.registerResource(
    'cortex_project_schema',
    new ResourceTemplate('cortex://project/{projectId}/schema', {
      list: undefined,
      complete: {
        projectId: async (value) => completeProjectIds(env, value),
      },
    }),
    {
      title: 'Project Graph Schema',
      description: 'Cypher schema reference and companion tools/resources for one project.',
      mimeType: 'text/yaml',
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '')
      const response = await fetchJson<ProjectSchemaResourceResponse>(
        env,
        `/api/intel/resources/project/${encodeURIComponent(projectId)}/schema`,
      )
      return textResource(uri, formatSchemaResource(response.data))
    },
  )
}
