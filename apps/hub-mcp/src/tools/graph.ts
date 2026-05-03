import { z } from 'zod'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Env } from '../types.js'
import { apiCall } from '../api-call.js'

type GraphNode = {
  id?: string
  type?: string
  name?: string
  filePath?: string | null
  startLine?: number | null
  endLine?: number | null
  community?: string | null
  depth?: number | null
}

type GraphEdge = {
  source?: string
  target?: string
  type?: string
  confidence?: number | null
  reason?: string | null
}

type GraphSnapshotMeta = {
  snapshotHit?: boolean
  stale?: boolean
  source?: string
  refresh?: boolean
  snapshotCreatedAt?: string | null
  snapshotAgeMs?: number | null
  snapshotMaxAgeMs?: number | null
  snapshotKey?: string | null
}

type GraphPayload = {
  success?: boolean
  data?: {
    repo?: string | null
    query?: Record<string, unknown>
    nodes?: GraphNode[]
    edges?: GraphEdge[]
    visibleCounts?: { nodes?: number; edges?: number }
    totalCounts?: { nodes?: number | null; edges?: number | null }
    truncated?: boolean
    capReason?: string[]
    snapshotHit?: boolean
    stale?: boolean
    source?: string
    refresh?: boolean
    snapshot?: GraphSnapshotMeta
    hint?: string | null
  }
  error?: string
}

const commaListSchema = z.array(z.string()).optional()
const GRAPH_ALL_NODE_TYPES = ['all']
const directionSchema = z.enum(['upstream', 'downstream', 'both']).optional()
const refreshSchema = z.boolean().optional()

const DEFAULT_SEARCH_NODES = 24
const DEFAULT_SEARCH_EDGES = 48
const DEFAULT_SLICE_NODES = 60
const DEFAULT_SLICE_EDGES = 120
const DEFAULT_NEIGHBOR_NODES = 60
const DEFAULT_NEIGHBOR_EDGES = 120
const DEFAULT_BRIEF_NODES = 40
const DEFAULT_BRIEF_EDGES = 80

function appendList(params: URLSearchParams, key: string, value?: string[]): void {
  if (value && value.length > 0) params.set(key, value.join(','))
}

function appendNodeTypes(params: URLSearchParams, value?: string[]): void {
  appendList(params, 'nodeTypes', value && value.length > 0 ? value : GRAPH_ALL_NODE_TYPES)
}

function appendNumber(params: URLSearchParams, key: string, value?: number): void {
  if (typeof value === 'number' && Number.isFinite(value)) params.set(key, String(value))
}

function appendBoundedNumber(
  params: URLSearchParams,
  key: string,
  value: number | undefined,
  fallback: number,
  max: number,
): void {
  const candidate = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  params.set(key, String(Math.min(candidate, max)))
}

function setSnapshotFirstParams(params: URLSearchParams, refresh?: boolean): void {
  params.set('format', 'json')
  params.set('refresh', refresh ? 'true' : 'false')
}

function firstLineLocation(node: GraphNode): string {
  const file = node.filePath ? ` ${node.filePath}` : ''
  const line = node.startLine ? `:${node.startLine}` : ''
  return `${file}${line}`.trim()
}

function nodeLabel(node: GraphNode): string {
  const type = node.type ?? 'Unknown'
  const name = node.name ?? node.id ?? 'unknown'
  const location = firstLineLocation(node)
  const depth = typeof node.depth === 'number' ? ` d=${node.depth}` : ''
  return `- ${type} ${name}${location ? ` — ${location}` : ''}${depth}`
}

function edgeLabel(edge: GraphEdge): string {
  const source = edge.source ?? 'unknown'
  const target = edge.target ?? 'unknown'
  const type = edge.type ?? 'RELATES'
  const confidence = typeof edge.confidence === 'number' ? ` (${Math.round(edge.confidence * 100)}%)` : ''
  return `- ${source} -[${type}${confidence}]-> ${target}`
}

function runtimeMeta(payload: GraphPayload): GraphSnapshotMeta {
  const data = payload.data
  const snapshot = data?.snapshot ?? {}
  return {
    snapshotHit: data?.snapshotHit ?? snapshot.snapshotHit,
    stale: data?.stale ?? snapshot.stale,
    source: data?.source ?? snapshot.source,
    refresh: data?.refresh ?? snapshot.refresh,
    snapshotCreatedAt: snapshot.snapshotCreatedAt,
    snapshotAgeMs: snapshot.snapshotAgeMs,
    snapshotMaxAgeMs: snapshot.snapshotMaxAgeMs,
    snapshotKey: snapshot.snapshotKey,
  }
}

function boolLabel(value: boolean | undefined): string {
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'unknown'
}

function capReasonLabel(value: string[] | undefined): string {
  return value && value.length > 0 ? value.join('; ') : 'none'
}

function nodeTypeHint(payload: GraphPayload): string | null {
  const nodes = payload.data?.nodes ?? []
  if (nodes.length === 0) return null

  const unknownCount = nodes.filter((node) => !node.type || node.type === 'Unknown').length
  if (unknownCount === 0) return null

  return `Graph contains ${unknownCount}/${nodes.length} node(s) with unknown GitNexus labels. MCP graph tools default to nodeTypes=["all"] so useful nodes are not hidden by label drift.`
}

function buildGraphSummary(title: string, payload: GraphPayload, maxNodes = 20, maxEdges = 20): string {
  const data = payload.data
  if (!data) return JSON.stringify(payload, null, 2)

  const nodes = data.nodes ?? []
  const edges = data.edges ?? []
  const meta = runtimeMeta(payload)
  const lines = [
    title,
    '',
    `Repo: ${data.repo ?? '(not indexed)'}`,
    `Snapshot: snapshotHit=${boolLabel(meta.snapshotHit)} stale=${boolLabel(meta.stale)} source=${meta.source ?? 'unknown'} refresh=${boolLabel(meta.refresh)}`,
    `Visible: ${data.visibleCounts?.nodes ?? nodes.length} nodes, ${data.visibleCounts?.edges ?? edges.length} edges`,
    `Total: ${data.totalCounts?.nodes ?? '?'} nodes, ${data.totalCounts?.edges ?? '?'} edges`,
    `Truncated: ${data.truncated ? 'yes' : 'no'}`,
    `CapReason: ${capReasonLabel(data.capReason)}`,
  ]

  if (meta.snapshotCreatedAt) {
    lines.push(`SnapshotCreatedAt: ${meta.snapshotCreatedAt}`)
  }
  if (typeof meta.snapshotAgeMs === 'number') {
    lines.push(`SnapshotAgeMs: ${meta.snapshotAgeMs}`)
  }
  if (data.hint) lines.push(`Hint: ${data.hint}`)
  const graphHint = nodeTypeHint(payload)
  if (graphHint) lines.push(`NodeTypeHint: ${graphHint}`)

  lines.push('', 'Nodes:')
  lines.push(...(nodes.length > 0 ? nodes.slice(0, maxNodes).map(nodeLabel) : ['- none']))

  lines.push('', 'Edges:')
  lines.push(...(edges.length > 0 ? edges.slice(0, maxEdges).map(edgeLabel) : ['- none']))

  lines.push('', 'Raw bounded graph JSON:')
  lines.push('```json')
  lines.push(JSON.stringify(data, null, 2))
  lines.push('```')

  return lines.join('\n')
}

export function registerGraphTools(server: McpServer, env: Env) {
  async function callGraph(
    projectId: string,
    params: URLSearchParams,
    timeoutMs = params.get('refresh') === 'true' ? 15000 : 8000,
  ): Promise<GraphPayload> {
    const queryString = params.toString()
    const response = await apiCall(
      env,
      `/api/intel/resources/project/${encodeURIComponent(projectId)}/graph${queryString ? `?${queryString}` : ''}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    )

    const payload = await response.json() as GraphPayload
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error ?? `Graph request failed: ${response.status}`)
    }

    return payload
  }

  server.tool(
    'cortex_graph_search',
    'Find candidate files and symbols from the snapshot-first graph API without reading raw source code. Returns a capped node/edge set for planning.',
    {
      projectId: z.string().describe('Project ID or slug to scope graph search'),
      query: z.string().describe('Symbol, file, or text fragment to search in graph node names and file paths'),
      nodeTypes: commaListSchema.describe('Optional node types. Defaults to all to tolerate GitNexus label drift; pass File,Class,Function,Method,Interface to narrow.'),
      limit: z.number().optional().describe('Maximum candidate nodes to return, capped server-side'),
      refresh: refreshSchema.describe('Explicitly refresh from GitNexus instead of snapshot/cache when supported; default false'),
    },
    async ({ projectId, query, nodeTypes, limit, refresh }) => {
      try {
        const params = new URLSearchParams({ search: query, depth: '1' })
        setSnapshotFirstParams(params, refresh)
        appendNodeTypes(params, nodeTypes)
        appendBoundedNumber(params, 'limitNodes', limit, DEFAULT_SEARCH_NODES, 50)
        appendBoundedNumber(params, 'limitEdges', undefined, DEFAULT_SEARCH_EDGES, 100)

        const payload = await callGraph(projectId, params)
        return {
          content: [{ type: 'text' as const, text: buildGraphSummary(`Graph search: ${query}`, payload, limit ?? DEFAULT_SEARCH_NODES, 12) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Graph search error: ${error instanceof Error ? error.message : 'Unknown'}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'cortex_graph_slice',
    'Return a bounded snapshot-first graph neighborhood around a file or symbol. Use before raw file reads to understand nearby code relationships.',
    {
      projectId: z.string().describe('Project ID or slug to scope graph slice'),
      focus: z.string().describe('Focused symbol name, node id, or file path'),
      depth: z.number().optional().describe('Traversal depth, capped at 5'),
      direction: directionSchema.describe('Traversal direction: upstream, downstream, or both'),
      edgeTypes: commaListSchema.describe('Optional relation types, e.g. CALLS,IMPORTS,DEFINES'),
      nodeTypes: commaListSchema.describe('Optional node types. Defaults to all to tolerate GitNexus label drift; pass File,Class,Function,Method,Interface to narrow.'),
      limitNodes: z.number().optional().describe('Maximum nodes, capped server-side'),
      limitEdges: z.number().optional().describe('Maximum edges, capped server-side'),
      refresh: refreshSchema.describe('Explicitly refresh from GitNexus instead of snapshot/cache when supported; default false'),
    },
    async ({ projectId, focus, depth, direction, edgeTypes, nodeTypes, limitNodes, limitEdges, refresh }) => {
      try {
        const params = new URLSearchParams({ focus })
        setSnapshotFirstParams(params, refresh)
        appendNumber(params, 'depth', depth ?? 1)
        if (direction) params.set('direction', direction)
        appendList(params, 'edgeTypes', edgeTypes)
        appendNodeTypes(params, nodeTypes)
        appendBoundedNumber(params, 'limitNodes', limitNodes, DEFAULT_SLICE_NODES, 120)
        appendBoundedNumber(params, 'limitEdges', limitEdges, DEFAULT_SLICE_EDGES, 240)

        const payload = await callGraph(projectId, params)
        return {
          content: [{ type: 'text' as const, text: buildGraphSummary(`Graph slice: ${focus}`, payload) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Graph slice error: ${error instanceof Error ? error.message : 'Unknown'}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'cortex_file_neighbors',
    'Show imports, definitions, calls, and nearby symbols around one file path using a bounded snapshot-first graph slice.',
    {
      projectId: z.string().describe('Project ID or slug to scope lookup'),
      filePath: z.string().describe('Relative file path within the indexed repository'),
      direction: directionSchema.describe('Neighbor direction: upstream, downstream, or both'),
      depth: z.number().optional().describe('Traversal depth, capped at 5'),
      refresh: refreshSchema.describe('Explicitly refresh from GitNexus instead of snapshot/cache when supported; default false'),
    },
    async ({ projectId, filePath, direction, depth, refresh }) => {
      try {
        const params = new URLSearchParams({
          focus: filePath,
          nodeTypes: 'all',
          edgeTypes: 'CONTAINS,DEFINES,IMPORTS,CALLS,EXTENDS,IMPLEMENTS,HAS_METHOD',
        })
        setSnapshotFirstParams(params, refresh)
        if (direction) params.set('direction', direction)
        appendNumber(params, 'depth', depth ?? 1)
        appendBoundedNumber(params, 'limitNodes', undefined, DEFAULT_NEIGHBOR_NODES, 120)
        appendBoundedNumber(params, 'limitEdges', undefined, DEFAULT_NEIGHBOR_EDGES, 240)

        const payload = await callGraph(projectId, params)
        return {
          content: [{ type: 'text' as const, text: buildGraphSummary(`File neighbors: ${filePath}`, payload) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `File neighbors error: ${error instanceof Error ? error.message : 'Unknown'}` }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'cortex_symbol_brief',
    'Build a compact symbol brief from a bounded snapshot-first graph slice, with optional raw cortex_code_context fallback for ambiguous or detailed inspection.',
    {
      projectId: z.string().describe('Project ID or slug to scope lookup'),
      symbol: z.string().describe('Symbol name or graph node id'),
      includeRaw: z.boolean().optional().describe('When true, append raw cortex_code_context output'),
      depth: z.number().optional().describe('Traversal depth for the compact slice, default 1'),
      refresh: refreshSchema.describe('Explicitly refresh from GitNexus instead of snapshot/cache when supported; default false'),
    },
    async ({ projectId, symbol, includeRaw, depth, refresh }) => {
      try {
        const params = new URLSearchParams({
          focus: symbol,
          nodeTypes: 'all',
          edgeTypes: 'CALLS,IMPORTS,EXTENDS,IMPLEMENTS,HAS_METHOD,DEFINES,STEP_IN_PROCESS',
          direction: 'both',
        })
        setSnapshotFirstParams(params, refresh)
        appendNumber(params, 'depth', depth ?? 1)
        appendBoundedNumber(params, 'limitNodes', undefined, DEFAULT_BRIEF_NODES, 80)
        appendBoundedNumber(params, 'limitEdges', undefined, DEFAULT_BRIEF_EDGES, 160)

        const payload = await callGraph(projectId, params)
        let text = buildGraphSummary(`Symbol brief: ${symbol}`, payload, 16, 16)

        if (includeRaw) {
          const rawRes = await apiCall(env, '/api/intel/context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, name: symbol }),
            signal: AbortSignal.timeout(15000),
          })
          const rawPayload = await rawRes.json()
          text += '\n\nRaw cortex_code_context fallback:\n```json\n'
          text += JSON.stringify(rawPayload, null, 2)
          text += '\n```'
        }

        return {
          content: [{ type: 'text' as const, text }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Symbol brief error: ${error instanceof Error ? error.message : 'Unknown'}` }],
          isError: true,
        }
      }
    },
  )
}
