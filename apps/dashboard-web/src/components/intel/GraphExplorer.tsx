'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import {
  getIntelProjectGraph,
  type IntelGraphEdge,
  type IntelGraphNode,
  type IntelGraphSlice,
} from '@/lib/api'
import styles from './GraphExplorer.module.css'

const NODE_TYPE_OPTIONS = ['File', 'Class', 'Function', 'Method', 'Interface', 'Module']
const EDGE_TYPE_OPTIONS = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'ACCESSES']
const DEFAULT_NODE_TYPES = ['File', 'Class', 'Function', 'Method', 'Interface']
const DEFAULT_EDGE_TYPES = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
const DEPTH_OPTIONS = [1, 2, 3, 5]
const DEFAULT_SLICE_NODES = 40
const DEFAULT_SLICE_EDGES = 80

type CanvasCommand = {
  id: number
  kind: 'fit' | 'zoom-in' | 'zoom-out'
}

type GraphNodeRenderAttrs = {
  label: string
  x: number
  y: number
  size: number
  color: string
  nodeType: string
  community?: string | null
  degree: number
  source: IntelGraphNode
}

type GraphEdgeRenderAttrs = {
  label: string
  size: number
  color: string
  edgeType: string
  source: IntelGraphEdge
}

type SigmaNodePayload = { node: string }
type SigmaStagePayload = { preventSigmaDefault?: () => void }

type SigmaCameraLike = {
  animatedReset: (opts?: { duration?: number }) => Promise<void>
  animatedZoom: (opts?: { duration?: number; factor?: number }) => Promise<void>
  animatedUnzoom: (opts?: { duration?: number; factor?: number }) => Promise<void>
}

type GraphLike = {
  order: number
  size: number
  hasNode: (node: unknown) => boolean
  addNode: (node: unknown, attributes: GraphNodeRenderAttrs) => string
  addDirectedEdgeWithKey: (edge: unknown, source: unknown, target: unknown, attributes: GraphEdgeRenderAttrs) => string
  source: (edge: unknown) => string
  target: (edge: unknown) => string
}

type GraphConstructor = new (options?: { type?: 'directed'; multi?: boolean; allowSelfLoops?: boolean }) => GraphLike

type SigmaLike = {
  kill: () => void
  refresh: () => SigmaLike
  getCamera: () => SigmaCameraLike
  on: ((event: 'clickNode', listener: (payload: SigmaNodePayload) => void) => SigmaLike)
    & ((event: 'clickStage', listener: (payload: SigmaStagePayload) => void) => SigmaLike)
}

type SigmaSettings = {
  renderLabels?: boolean
  renderEdgeLabels?: boolean
  hideEdgesOnMove?: boolean
  labelRenderedSizeThreshold?: number
  defaultNodeColor?: string
  defaultEdgeColor?: string
  labelColor?: { color: string }
  edgeLabelColor?: { color: string }
  nodeReducer?: (node: string, data: GraphNodeRenderAttrs) => Partial<{
    label: string | null
    color: string
    size: number
    forceLabel: boolean
    zIndex: number
  }>
  edgeReducer?: (edge: string, data: GraphEdgeRenderAttrs) => Partial<{
    label: string | null
    color: string
    size: number
  }>
}

type SigmaConstructor = new (graph: GraphLike, container: HTMLElement, settings?: SigmaSettings) => SigmaLike

interface GraphExplorerProps {
  projectId: string
  projectName: string
  indexStatus: string
}

function formatAge(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return null
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s old`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m old`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h old`
  return `${Math.round(seconds / 86400)}d old`
}

function totalCountLabel(visible: number, total: number | null) {
  return total == null ? `${visible}/?` : `${visible}/${total}`
}
function toggleList(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function colorForType(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('file') || normalized.includes('module')) return '#60a5fa'
  if (normalized.includes('class') || normalized.includes('interface')) return '#c084fc'
  if (normalized.includes('method') || normalized.includes('function')) return '#34d399'
  if (normalized.includes('process')) return '#fbbf24'
  return '#94a3b8'
}

function colorForEdge(type: string) {
  const normalized = type.toUpperCase()
  if (normalized.includes('CALL')) return '#22d3ee'
  if (normalized.includes('IMPORT')) return '#818cf8'
  if (normalized.includes('EXTEND')) return '#fbbf24'
  if (normalized.includes('IMPLEM')) return '#34d399'
  if (normalized.includes('ACCESS')) return '#fb7185'
  return '#64748b'
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function positionNodes(nodes: IntelGraphNode[], layoutSeed: number) {
  const byType = new Map<string, IntelGraphNode[]>()
  for (const node of nodes) {
    const type = node.type || 'Symbol'
    byType.set(type, [...(byType.get(type) ?? []), node])
  }

  const positions = new Map<string, { x: number; y: number }>()
  const typeEntries = Array.from(byType.entries()).sort(([a], [b]) => a.localeCompare(b))
  const ringCount = Math.max(1, typeEntries.length)

  typeEntries.forEach(([type, group], typeIndex) => {
    const radius = 2 + typeIndex * (4 / ringCount)
    const offset = ((hashText(type) + layoutSeed * 23) % 360) * Math.PI / 180
    group.forEach((node, index) => {
      const angle = offset + (index / Math.max(1, group.length)) * Math.PI * 2
      const jitter = ((hashText(node.id) % 17) - 8) / 40
      positions.set(node.id, {
        x: Math.cos(angle) * (radius + jitter),
        y: Math.sin(angle) * (radius + jitter),
      })
    })
  })

  return positions
}

function buildMockGraphSlice(
  projectId: string,
  projectName: string,
  opts: {
    nodeTypes: string[]
    edgeTypes: string[]
    depth: number
    search: string
    community: string
  },
): IntelGraphSlice {
  const baseNodes: IntelGraphNode[] = [
    { id: 'file:apps/dashboard-web/src/app/graph/page.tsx', label: 'graph/page.tsx', type: 'File', filePath: 'apps/dashboard-web/src/app/graph/page.tsx', community: 'dashboard-web', degree: 5, summary: 'Graph route shell and mode switch.' },
    { id: 'module:intel-api-client', label: 'intel api client', type: 'Module', filePath: 'apps/dashboard-web/src/lib/api.ts', community: 'dashboard-web', degree: 4, summary: 'Typed client for bounded graph slices.' },
    { id: 'component:GraphExplorer', label: 'GraphExplorer', type: 'Function', filePath: 'apps/dashboard-web/src/components/intel/GraphExplorer.tsx', community: 'explorer', degree: 7, summary: 'Explorer shell with search, filters, depth, canvas, and inspector.' },
    { id: 'component:GraphCanvas', label: 'GraphCanvas', type: 'Function', filePath: 'apps/dashboard-web/src/components/intel/GraphExplorer.tsx', community: 'explorer', degree: 5, summary: 'Sigma renderer fed by Graphology.' },
    { id: 'api:bounded-graph', label: 'GET project graph', type: 'Interface', filePath: 'apps/dashboard-api/src/routes/intel.ts', community: 'api-contract', degree: 6, summary: 'Planned bounded graph API contract.' },
    { id: 'tool:cortex_graph_slice', label: 'cortex_graph_slice', type: 'Method', filePath: 'apps/hub-mcp/src/tools/graph.ts', community: 'api-contract', degree: 3, summary: 'Planned MCP graph slice tool.' },
    { id: 'file:ForceGraph', label: 'ForceGraph', type: 'Class', filePath: 'apps/dashboard-web/src/components/intel/ForceGraph.tsx', community: 'architecture', degree: 3, summary: 'Existing high-level architecture graph.' },
    { id: 'process:agent-ladder', label: 'agent graph ladder', type: 'Process', filePath: '.docs/guides/agent-cortex-workflow.md', community: 'workflow', degree: 4, summary: 'Memory, graph slice, context, impact, quality workflow.' },
  ]

  const baseEdges: IntelGraphEdge[] = [
    { id: 'e1', source: 'file:apps/dashboard-web/src/app/graph/page.tsx', target: 'component:GraphExplorer', type: 'IMPORTS', label: 'renders' },
    { id: 'e2', source: 'component:GraphExplorer', target: 'component:GraphCanvas', type: 'CONTAINS', label: 'contains' },
    { id: 'e3', source: 'component:GraphExplorer', target: 'module:intel-api-client', type: 'CALLS', label: 'fetches' },
    { id: 'e4', source: 'module:intel-api-client', target: 'api:bounded-graph', type: 'CALLS', label: 'GET' },
    { id: 'e5', source: 'api:bounded-graph', target: 'tool:cortex_graph_slice', type: 'IMPLEMENTS', label: 'contract' },
    { id: 'e6', source: 'file:ForceGraph', target: 'file:apps/dashboard-web/src/app/graph/page.tsx', type: 'IMPORTS', label: 'architecture' },
    { id: 'e7', source: 'process:agent-ladder', target: 'api:bounded-graph', type: 'REFERENCES', label: 'uses' },
    { id: 'e8', source: 'process:agent-ladder', target: 'tool:cortex_graph_slice', type: 'REFERENCES', label: 'uses' },
  ]

  const search = opts.search.trim().toLowerCase()
  const nodeTypeSet = new Set(opts.nodeTypes)
  const edgeTypeSet = new Set(opts.edgeTypes)
  const filteredNodes = baseNodes.filter((node) => {
    const typeMatches = nodeTypeSet.size === 0 || nodeTypeSet.has(node.type)
    const communityMatches = !opts.community || node.community === opts.community
    const searchMatches = !search
      || node.label.toLowerCase().includes(search)
      || node.filePath?.toLowerCase().includes(search)
      || node.summary?.toLowerCase().includes(search)
    return typeMatches && communityMatches && searchMatches
  })
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id))
  const filteredEdges = baseEdges.filter((edge) => {
    const edgeMatches = edgeTypeSet.size === 0 || edgeTypeSet.has(edge.type)
    return edgeMatches && visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  })

  return {
    uri: `cortex://project/${projectId}/graph?mock=true`,
    projectId,
    query: {
      nodeTypes: opts.nodeTypes,
      edgeTypes: opts.edgeTypes,
      focus: null,
      depth: opts.depth,
      community: opts.community || null,
      search: opts.search || null,
      limitNodes: DEFAULT_SLICE_NODES,
      limitEdges: DEFAULT_SLICE_EDGES,
    },
    nodes: filteredNodes,
    edges: filteredEdges,
    visibleCounts: { nodes: filteredNodes.length, edges: filteredEdges.length },
    totalCounts: { nodes: baseNodes.length, edges: baseEdges.length },
    truncated: false,
    capReason: `Mock contract while ${projectName} graph API is pending`,
  }
}

function connectedNodeIds(slice: IntelGraphSlice, selectedNodeId: string | null) {
  const ids = new Set<string>()
  if (!selectedNodeId) return ids
  for (const edge of slice.edges) {
    if (edge.source === selectedNodeId) ids.add(edge.target)
    if (edge.target === selectedNodeId) ids.add(edge.source)
  }
  return ids
}

function GraphCanvas({
  slice,
  selectedNodeId,
  onSelectNode,
  command,
  layoutSeed,
}: {
  slice: IntelGraphSlice
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
  command: CanvasCommand
  layoutSeed: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<SigmaLike | null>(null)
  const [status, setStatus] = useState('idle')
  const neighborIds = useMemo(() => connectedNodeIds(slice, selectedNodeId), [selectedNodeId, slice])

  useEffect(() => {
    let disposed = false
    let renderer: SigmaLike | null = null

    async function mountGraph() {
      const container = containerRef.current
      if (!container) return
      container.innerHTML = ''
      setStatus('building')

      const [sigmaModule, graphModule] = await Promise.all([
        import('sigma'),
        import('graphology'),
      ])
      const Sigma = sigmaModule.default as unknown as SigmaConstructor
      const Graph = graphModule.default as unknown as GraphConstructor

      if (disposed) return

      const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: true })
      const positions = positionNodes(slice.nodes, layoutSeed)

      for (const node of slice.nodes) {
        if (graph.hasNode(node.id)) continue
        const position = positions.get(node.id) ?? { x: 0, y: 0 }
        graph.addNode(node.id, {
          label: node.label,
          x: position.x,
          y: position.y,
          size: Math.max(5, Math.min(18, 6 + (node.degree ?? 1) * 1.2)),
          color: colorForType(node.type),
          nodeType: node.type,
          community: node.community,
          degree: node.degree ?? 0,
          source: node,
        })
      }

      slice.edges.forEach((edge, index) => {
        if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return
        graph.addDirectedEdgeWithKey(`${edge.id}:${index}`, edge.source, edge.target, {
          label: edge.label ?? edge.type,
          size: Math.max(0.5, Math.min(3, edge.weight ?? 1)),
          color: colorForEdge(edge.type),
          edgeType: edge.type,
          source: edge,
        })
      })

      renderer = new Sigma(graph, container, {
        renderLabels: true,
        renderEdgeLabels: false,
        hideEdgesOnMove: true,
        labelRenderedSizeThreshold: 8,
        defaultNodeColor: '#94a3b8',
        defaultEdgeColor: '#475569',
        labelColor: { color: '#e5e7eb' },
        edgeLabelColor: { color: '#94a3b8' },
        nodeReducer: (node, data) => {
          const isSelected = node === selectedNodeId
          const isNeighbor = neighborIds.has(node)
          const muted = Boolean(selectedNodeId) && !isSelected && !isNeighbor
          return {
            color: muted ? '#334155' : data.color,
            size: isSelected ? data.size + 4 : muted ? Math.max(3, data.size - 1) : data.size,
            label: muted ? null : data.label,
            forceLabel: isSelected || data.degree >= 4,
            zIndex: isSelected ? 3 : isNeighbor ? 2 : 1,
          }
        },
        edgeReducer: (edge, data) => {
          const source = graph.source(edge)
          const target = graph.target(edge)
          const active = !selectedNodeId || source === selectedNodeId || target === selectedNodeId
          return {
            color: active ? data.color : 'rgba(71, 85, 105, 0.2)',
            size: active ? data.size : 0.35,
            label: active ? data.label : null,
          }
        },
      })

      renderer.on('clickNode', (payload) => onSelectNode(payload.node))
      renderer.on('clickStage', () => onSelectNode(null))
      renderer.refresh()
      rendererRef.current = renderer
      setStatus(`ready: ${graph.order} nodes, ${graph.size} edges`)
    }

    mountGraph().catch((error: unknown) => {
      console.error('Failed to render graph explorer:', error)
      if (!disposed) setStatus('render failed')
    })

    return () => {
      disposed = true
      renderer?.kill()
      rendererRef.current = null
      const container = containerRef.current
      if (container) container.innerHTML = ''
    }
  }, [layoutSeed, neighborIds, onSelectNode, selectedNodeId, slice])

  useEffect(() => {
    if (command.id === 0) return
    const camera = rendererRef.current?.getCamera()
    if (!camera) return
    if (command.kind === 'fit') void camera.animatedReset({ duration: 220 })
    if (command.kind === 'zoom-in') void camera.animatedZoom({ duration: 180, factor: 1.5 })
    if (command.kind === 'zoom-out') void camera.animatedUnzoom({ duration: 180, factor: 1.5 })
  }, [command])

  return (
    <div className={styles.canvasWrap}>
      <div ref={containerRef} className={styles.sigmaCanvas} />
      {slice.nodes.length === 0 && <div className={styles.canvasEmpty}>No nodes match the current slice.</div>}
      <div className={styles.layoutBadge}>{status}</div>
    </div>
  )
}

function GraphInspector({
  node,
  edges,
  onFocus,
  onClear,
  onSelectNode,
}: {
  node: IntelGraphNode | null
  edges: IntelGraphEdge[]
  onFocus: (node: IntelGraphNode) => void
  onClear: () => void
  onSelectNode: (nodeId: string) => void
}) {
  if (!node) {
    return (
      <aside className={styles.inspectorPanel}>
        <div className={styles.panelTitle}>Inspector</div>
        <div className={styles.emptyPanel}>Select a node to inspect file path, relationships, and slice actions.</div>
      </aside>
    )
  }

  const relatedEdges = edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 12)

  return (
    <aside className={styles.inspectorPanel}>
      <div className={styles.inspectorHead}>
        <div>
          <span className={styles.nodeType}>{node.type}</span>
          <h3 className={styles.inspectorTitle}>{node.label}</h3>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>
      </div>

      <div className={styles.detailList}>
        {node.filePath && <div><span>Path</span><code>{node.filePath}</code></div>}
        {(node.lineStart || node.lineEnd) && <div><span>Lines</span><strong>{node.lineStart ?? '?'}-{node.lineEnd ?? '?'}</strong></div>}
        {node.community && <div><span>Community</span><strong>{node.community}</strong></div>}
        <div><span>Degree</span><strong>{node.degree ?? relatedEdges.length}</strong></div>
      </div>

      {node.summary && <p className={styles.summary}>{node.summary}</p>}

      <div className={styles.inspectorActions}>
        <button className="btn btn-primary btn-sm" onClick={() => onFocus(node)}>Expand Slice</button>
        <button className="btn btn-secondary btn-sm" onClick={onClear}>Clear Selection</button>
      </div>

      <div className={styles.neighborList}>
        <div className={styles.panelSubTitle}>Relationships</div>
        {relatedEdges.length === 0 ? (
          <div className={styles.emptyPanel}>No visible relationships in this slice.</div>
        ) : relatedEdges.map((edge) => {
          const neighborId = edge.source === node.id ? edge.target : edge.source
          return (
            <button key={edge.id} className={styles.neighborRow} onClick={() => onSelectNode(neighborId)}>
              <span>{edge.type}</span>
              <strong>{neighborId}</strong>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

export default function GraphExplorer({ projectId, projectName, indexStatus }: GraphExplorerProps) {
  const [searchInput, setSearchInput] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [nodeTypes, setNodeTypes] = useState<string[]>(DEFAULT_NODE_TYPES)
  const [edgeTypes, setEdgeTypes] = useState<string[]>(DEFAULT_EDGE_TYPES)
  const [depth, setDepth] = useState(1)
  const [community, setCommunity] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [layoutSeed, setLayoutSeed] = useState(0)
  const [command, setCommand] = useState<CanvasCommand>({ id: 0, kind: 'fit' })
  const [refreshArmed, setRefreshArmed] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    projectId ? ['intel-project-graph', projectId, submittedSearch, nodeTypes.join(','), edgeTypes.join(','), depth, community, selectedNodeId] : null,
    () => getIntelProjectGraph(projectId, {
      nodeTypes,
      edgeTypes,
      depth,
      community: community || undefined,
      search: submittedSearch.trim() || undefined,
      focus: selectedNodeId ?? undefined,
      limitNodes: DEFAULT_SLICE_NODES,
      limitEdges: DEFAULT_SLICE_EDGES,
    }),
    { keepPreviousData: true, refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const fallbackSlice = useMemo(
    () => buildMockGraphSlice(projectId, projectName, { nodeTypes, edgeTypes, depth, search: submittedSearch, community }),
    [community, depth, edgeTypes, nodeTypes, projectId, projectName, submittedSearch],
  )

  const slice = data?.data ?? fallbackSlice
  const usingMock = Boolean(error && !data?.data)
  const snapshotAgeLabel = formatAge(slice.snapshotAgeSeconds ?? slice.cache?.ageSeconds)
  const sourceLabel = usingMock
    ? 'mock contract'
    : slice.snapshotHit || slice.cache?.hit
      ? 'snapshot'
      : 'live slice'
  const selectedNode = useMemo(
    () => slice.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, slice.nodes],
  )
  const communities = useMemo(
    () => Array.from(new Set(slice.nodes.map((node) => node.community).filter((value): value is string => Boolean(value)))).sort(),
    [slice.nodes],
  )
  const searchResults = useMemo(() => {
    const query = searchInput.trim().toLowerCase()
    const pool = query
      ? slice.nodes.filter((node) => node.label.toLowerCase().includes(query) || node.filePath?.toLowerCase().includes(query))
      : [...slice.nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
    return pool.slice(0, 10)
  }, [searchInput, slice.nodes])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  useEffect(() => {
    if (selectedNodeId && !slice.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [selectedNodeId, slice.nodes])

  function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setRefreshArmed(false)
    setSubmittedSearch(searchInput.trim())
  }

  async function refreshSnapshot() {
    setRefreshArmed(true)
    try {
      const refreshed = await getIntelProjectGraph(projectId, {
        nodeTypes,
        edgeTypes,
        depth,
        community: community || undefined,
        search: submittedSearch.trim() || undefined,
        focus: selectedNodeId ?? undefined,
        limitNodes: DEFAULT_SLICE_NODES,
        limitEdges: DEFAULT_SLICE_EDGES,
        refresh: true,
      })
      await mutate(refreshed, { revalidate: false })
    } finally {
      setRefreshArmed(false)
    }
  }

  function setCanvasCommand(kind: CanvasCommand['kind']) {
    setCommand((current) => ({ id: current.id + 1, kind }))
  }

  return (
    <section className={styles.explorerShell}>
      <div className={styles.topBar}>
        <form className={styles.searchForm} onSubmit={runSearch}>
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search symbols or files"
          />
          <button className="btn btn-primary btn-sm" type="submit">Search</button>
        </form>
        <div className={styles.countStrip}>
          <span>{totalCountLabel(slice.visibleCounts.nodes, slice.totalCounts.nodes)} nodes</span>
          <span>{totalCountLabel(slice.visibleCounts.edges, slice.totalCounts.edges)} edges</span>
          <span>{indexStatus}</span>
          <span>{isLoading ? 'loading' : sourceLabel}</span>
          {snapshotAgeLabel && <span>{snapshotAgeLabel}</span>}
          {refreshArmed && <span className={styles.warningChip}>refreshing</span>}
          {slice.stale && <span className={styles.warningChip}>stale</span>}
          {slice.truncated && <span className={styles.warningChip}>capped</span>}
        </div>
      </div>

      {usingMock && (
        <div className={styles.noticeBar}>
          Backend graph contract unavailable. Explorer is rendering a small local slice with the expected response shape.
        </div>
      )}
      {slice.truncated && <div className={styles.noticeBar}>{slice.capReason ?? 'Graph slice capped by server limits.'}</div>}

      <div className={styles.workspaceGrid}>
        <aside className={styles.filterRail}>
          <div className={styles.panelTitle}>Filters</div>
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Node Types</div>
            {NODE_TYPE_OPTIONS.map((type) => (
              <label key={type} className={styles.checkRow}>
                <input type="checkbox" checked={nodeTypes.includes(type)} onChange={() => setNodeTypes((current) => toggleList(current, type))} />
                <span>{type}</span>
              </label>
            ))}
          </div>

          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Edge Types</div>
            {EDGE_TYPE_OPTIONS.map((type) => (
              <label key={type} className={styles.checkRow}>
                <input type="checkbox" checked={edgeTypes.includes(type)} onChange={() => setEdgeTypes((current) => toggleList(current, type))} />
                <span>{type}</span>
              </label>
            ))}
          </div>

          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Depth</div>
            <div className={styles.depthGrid}>
              {DEPTH_OPTIONS.map((value) => (
                <button
                  key={value}
                  className={`${styles.depthButton} ${depth === value ? styles.depthButtonActive : ''}`}
                  onClick={() => setDepth(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="community-filter">Community</label>
            <select id="community-filter" className={styles.selectInput} value={community} onChange={(event) => setCommunity(event.target.value)}>
              <option value="">All</option>
              {communities.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </aside>

        <main className={styles.canvasPanel}>
          <div className={styles.canvasToolbar}>
            <div className={styles.layoutStatus}>Layout: static sigma</div>
            <div className={styles.canvasActions}>
              <button className="btn btn-secondary btn-sm" onClick={() => setCanvasCommand('zoom-in')}>Zoom In</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCanvasCommand('zoom-out')}>Zoom Out</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCanvasCommand('fit')}>Fit</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setLayoutSeed((current) => current + 1)}>Rerun Layout</button>
              <button className="btn btn-secondary btn-sm" onClick={refreshSnapshot} disabled={isLoading || refreshArmed}>Refresh Snapshot</button>
              <button className="btn btn-secondary btn-sm" disabled>Stop</button>
            </div>
          </div>

          <GraphCanvas
            slice={slice}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            command={command}
            layoutSeed={layoutSeed}
          />

          <div className={styles.resultTray}>
            {searchResults.map((node) => (
              <button key={node.id} className={styles.resultPill} onClick={() => setSelectedNodeId(node.id)}>
                <span>{node.type}</span>
                <strong>{node.label}</strong>
              </button>
            ))}
          </div>
        </main>

        <GraphInspector
          node={selectedNode}
          edges={slice.edges}
          onFocus={(node) => {
            setRefreshArmed(false)
            setSelectedNodeId(node.id)
            setSubmittedSearch('')
          }}
          onClear={() => setSelectedNodeId(null)}
          onSelectNode={setSelectedNodeId}
        />
      </div>

      <div className={styles.footerMeta}>
        <span>{slice.uri}</span>
        <span>limits: {slice.query.limitNodes} nodes, {slice.query.limitEdges} edges</span>
      </div>
    </section>
  )
}
