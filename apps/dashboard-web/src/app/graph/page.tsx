'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getIntelProjectsResource,
  getIntelProjectContext,
  getIntelProjectClusters,
  getIntelProjectProcesses,
  getIntelProjectProcessDetail,
  getIntelProjectDiscovery,
  getIntelProjectCrossLinks,
  getIntelProjectClusterMembers,
  getIntelProjectSymbolTree,
  getIntelSymbolContext,
  getIntelSymbolImpact,
  runIntelCypherQuery,
  linkDiscoveredProject,
  type IntelClusterResource,
  type IntelDiscoveryCandidate,
  type IntelProcessResource,
  type IntelProcessStep,
  type IntelCrossLink,
} from '@/lib/api'
import styles from './page.module.css'
import SymbolTreeViewer from '@/components/intel/SymbolTreeViewer'

function formatIndexedAt(value: string | null | undefined): string {
  if (!value) return 'Not indexed'
  return new Date(value).toLocaleString()
}

function statusTone(status: string | undefined): 'healthy' | 'warning' | 'error' {
  if (status === 'fresh') return 'healthy'
  if (status === 'aging' || status === 'indexing') return 'warning'
  return 'error'
}

function statusLabel(status: string | undefined): string {
  if (!status) return 'unknown'
  return status.replaceAll('_', ' ')
}

function truncateLabel(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className={`card ${styles.statCard}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  )
}

function ColumnList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ name: string; meta: string }>
  empty: string
}) {
  return (
    <div className={`card ${styles.listCard}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className={styles.emptyCard}>{empty}</div>
      ) : (
        <div className={styles.listStack}>
          {items.map((item) => (
            <div key={`${title}-${item.name}-${item.meta}`} className={styles.listRow}>
              <span className={styles.listName}>{item.name}</span>
              <span className={styles.listMeta}>{item.meta}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatCypherOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const CYPHER_PRESETS = [
  {
    label: 'Top processes',
    query: `MATCH (p:Process)
RETURN p.label AS label, p.heuristicLabel AS heuristicLabel, p.stepCount AS steps
LIMIT 12`,
  },
  {
    label: 'Cluster nodes',
    query: `MATCH (c:Cluster)
RETURN c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion
LIMIT 12`,
  },
  {
    label: 'Step flow',
    query: `MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
RETURN p.label AS process, n.name AS stepName, n.filePath AS filePath, r.step AS step
ORDER BY process, step
LIMIT 30`,
  },
]

type OrbitNode = {
  id: string
  title: string
  meta: string
  x: number
  y: number
  variant: 'cluster' | 'process' | 'summary' | 'knowledge'
}

function buildTreeLevel(
  items: Array<{ id: string; title: string; meta: string }>,
  startX: number,
  endX: number,
  y: number,
  variant: 'cluster' | 'process' | 'knowledge',
): OrbitNode[] {
  const maxVisible = 6
  const visible = items.slice(0, maxVisible)
  const remaining = items.length - visible.length
  const count = visible.length + (remaining > 0 ? 1 : 0)

  const positioned: OrbitNode[] = visible.map((item, index) => ({
    id: item.id,
    title: truncateLabel(item.title),
    meta: item.meta,
    x: count <= 1 ? (startX + endX) / 2 : startX + (endX - startX) * index / (count - 1),
    y,
    variant: variant as OrbitNode['variant'],
  }))

  if (remaining > 0) {
    positioned.push({
      id: `${variant}-overflow`,
      title: `+${remaining} more`,
      meta: variant === 'cluster' ? 'additional clusters' : 'additional processes',
      x: count <= 1 ? (startX + endX) / 2 : startX + (endX - startX) * visible.length / (count - 1),
      y,
      variant: 'summary',
    })
  }

  return positioned
}

function treeEdge(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = (fromY + toY) / 2
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`
}

function GraphCanvas({
  projectName,
  clusters,
  processes,
  knowledgeDocs,
  knowledgeChunks,
  crossLinks,
  onNodeClick,
  selectedClusterId,
}: {
  projectName: string
  clusters: IntelClusterResource[]
  processes: IntelProcessResource[]
  knowledgeDocs: number
  knowledgeChunks: number
  crossLinks: IntelCrossLink[]
  onNodeClick: (nodeId: string, nodeVariant: string) => void
  selectedClusterId: string | null
}) {
  const width = 1080
  const height = 580
  const rootX = width / 2
  const rootY = 58
  const level1Y = 240
  const knowledgeY = 420

  const clusterNodes = buildTreeLevel(
    clusters.map((cluster, index) => ({
      id: cluster.id ?? `cluster-${index}`,
      title: cluster.name,
      meta: `${cluster.symbols} symbols`,
    })),
    130, 430, level1Y, 'cluster',
  )

  const processNodes = buildTreeLevel(
    processes.map((process, index) => ({
      id: process.id ?? `process-${index}`,
      title: process.name,
      meta: `${process.steps} steps${process.type ? ` · ${process.type}` : ''}`,
    })),
    650, 950, level1Y, 'process',
  )

  const knowledgeNode: OrbitNode | null = knowledgeDocs > 0 || knowledgeChunks > 0
    ? {
        id: 'knowledge-node',
        title: 'Knowledge Base',
        meta: `${knowledgeDocs} docs · ${knowledgeChunks} chunks`,
        x: rootX,
        y: knowledgeY,
        variant: 'knowledge',
      }
    : null

  const nodes = [...clusterNodes, ...processNodes, ...(knowledgeNode ? [knowledgeNode] : [])]

  return (
    <div className={`card ${styles.graphCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Context Tree</h3>
          <p className={styles.cardSub}>
            Hierarchical tree view: project root branches into clusters (left) and processes (right), with cross-community links shown between related clusters.
          </p>
        </div>
      </div>

      <div className={styles.graphViewport}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.graphSvg} role="img" aria-label="Project tree overview">
          <defs>
            <linearGradient id="graphLine" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(96, 165, 250, 0.28)" />
              <stop offset="100%" stopColor="rgba(192, 132, 252, 0.52)" />
            </linearGradient>
            <radialGradient id="graphGlow" cx="50%" cy="25%" r="50%">
              <stop offset="0%" stopColor="rgba(124, 58, 237, 0.16)" />
              <stop offset="100%" stopColor="rgba(17, 24, 39, 0)" />
            </radialGradient>
            <linearGradient id="clusterNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#102f58" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <linearGradient id="processNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#163b29" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            <linearGradient id="summaryNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b305f" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
            <linearGradient id="knowledgeNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5b3413" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <linearGradient id="projectNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#24103d" />
              <stop offset="100%" stopColor="#5d2f8e" />
            </linearGradient>
          </defs>

          <rect x="14" y="14" width={width - 28} height={height - 28} rx="34" className={styles.graphFrame} />
          <ellipse cx={rootX} cy={level1Y - 40} rx="420" ry="180" fill="url(#graphGlow)" />

          {nodes.map((node) => (
            <path
              key={`edge-${node.id}`}
              d={treeEdge(rootX, rootY + 34, node.x, node.y - 28)}
              stroke="url(#graphLine)"
              strokeWidth="2"
              fill="none"
              className={styles.graphEdge}
            />
          ))}

          {crossLinks.map((link) => {
            const sourceNode = clusterNodes.find(n => n.id === link.source || n.title === link.source)
            const targetNode = clusterNodes.find(n => n.id === link.target || n.title === link.target)
            if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return null

            const midY = Math.max(sourceNode.y, targetNode.y) + 60
            const pathData = `M ${sourceNode.x} ${sourceNode.y + 28} Q ${(sourceNode.x + targetNode.x) / 2} ${midY} ${targetNode.x} ${targetNode.y + 28}`

            return (
              <path
                key={`crosslink-${link.source}-${link.target}`}
                d={pathData}
                stroke="rgba(192, 132, 252, 0.45)"
                strokeWidth={Math.min(link.weight + 1, 6)}
                fill="none"
                style={{ strokeDasharray: '4 4' }}
                opacity={selectedClusterId ? (sourceNode.id === selectedClusterId || targetNode.id === selectedClusterId ? 1 : 0.1) : 0.8}
              >
                <title>{link.weight} cross_community process(es): {link.processes.join(', ')}</title>
              </path>
            )
          })}

          <g transform={`translate(${rootX - 118}, ${rootY - 28})`}>
            <rect width="236" height="56" rx="28" fill="url(#projectNode)" className={styles.graphCore} />
            <text x="22" y="24" className={styles.graphCoreTitle}>{truncateLabel(projectName, 22)}</text>
            <text x="22" y="44" className={styles.graphCoreSmall}>
              {clusters.length} clusters · {processes.length} processes
            </text>
          </g>

          {nodes.map((node) => {
            const fill = node.variant === 'cluster'
              ? 'url(#clusterNode)'
              : node.variant === 'process'
                ? 'url(#processNode)'
                : node.variant === 'knowledge'
                  ? 'url(#knowledgeNode)'
                  : 'url(#summaryNode)'
            
            const isSelected = selectedClusterId === node.id || selectedClusterId === node.title
            const highlightStroke = isSelected ? 'rgba(59, 130, 246, 0.9)' : 'rgba(255, 255, 255, 0.08)'

            return (
              <g 
                key={node.id} 
                transform={`translate(${node.x - 112}, ${node.y - 30})`}
                className={node.variant === 'cluster' || node.variant === 'process' ? styles.graphNodeInteractive : ''}
                onClick={() => {
                  if (node.variant === 'cluster' || node.variant === 'process') onNodeClick(node.title, node.variant)
                }}
              >
                <rect 
                  width="224" 
                  height="60" 
                  rx="20" 
                  fill={fill} 
                  className={styles.graphNode} 
                  style={{ stroke: highlightStroke, strokeWidth: isSelected ? 2 : 1 }} 
                />
                <text x="18" y="25" className={styles.graphNodeTitle}>{node.title}</text>
                <text x="18" y="44" className={styles.graphNodeMeta}>{node.meta}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function DiscoveryCard({
  candidate,
  onLink,
  linking,
}: {
  candidate: IntelDiscoveryCandidate
  onLink: (candidate: IntelDiscoveryCandidate) => void
  linking: boolean
}) {
  return (
    <div className={`card ${styles.discoveryCard}`}>
      <div className={styles.discoveryHead}>
        <div>
          <h3 className={styles.discoveryTitle}>{candidate.name}</h3>
          <p className={styles.discoverySlug}>{candidate.slug}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => onLink(candidate)} disabled={linking}>
          {linking ? 'Linking…' : 'Link Project'}
        </button>
      </div>
      <div className={styles.discoveryTags}>
        {candidate.sourceKinds.map((source) => (
          <span key={source} className={styles.discoveryTag}>{source.replaceAll('_', ' ')}</span>
        ))}
      </div>
      <div className={styles.discoveryMeta}>
        {candidate.gitRepoUrl && <span>repo: {candidate.gitRepoUrl}</span>}
        {candidate.gitnexus && <span>{candidate.gitnexus.stats.symbols ?? 0} symbols</span>}
        {candidate.knowledge && <span>{candidate.knowledge.docs} knowledge docs</span>}
      </div>
    </div>
  )
}

export default function GraphPage() {
  const [projectId, setProjectId] = useState('')
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null)
  const [processDetail, setProcessDetail] = useState<{
    process: {
      id: string
      name: string
      label: string | null
      heuristicLabel: string | null
      type: string | null
      steps: number
    }
    steps: IntelProcessStep[]
  } | null>(null)
  const [loadingProcess, setLoadingProcess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [cypherQuery, setCypherQuery] = useState(CYPHER_PRESETS[0]?.query ?? '')
  const [cypherResult, setCypherResult] = useState<string | null>(null)
  const [cypherError, setCypherError] = useState<string | null>(null)
  const [runningCypher, setRunningCypher] = useState(false)

  const { data: projectsData, error: projectsError, mutate: mutateProjects } = useSWR(
    'intel-projects-resource',
    getIntelProjectsResource,
    { refreshInterval: 30000 },
  )
  const { data: discoveryData, mutate: mutateDiscovery } = useSWR(
    'intel-project-discovery',
    getIntelProjectDiscovery,
    { refreshInterval: 30000 },
  )

  const projects = projectsData?.data.items ?? []
  const discoveryCandidates = discoveryData?.data.candidates ?? []

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      const first = projects[0]
      if (first) setProjectId(first.projectId)
    }
  }, [projectId, projects])

  useEffect(() => {
    setSelectedCluster(null)
    setSelectedProcess(null)
    setProcessDetail(null)
    setSymbolTree(null)
    setSymbolContext(null)
    setSymbolImpact(null)
    setSelectedSymbol(null)
    setCypherResult(null)
    setCypherError(null)
  }, [projectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId) ?? null,
    [projectId, projects],
  )

  const { data: contextData, error: contextError } = useSWR(
    projectId ? ['intel-project-context', projectId] : null,
    () => getIntelProjectContext(projectId),
    { refreshInterval: 30000 },
  )

  const { data: clustersData } = useSWR(
    projectId ? ['intel-project-clusters', projectId] : null,
    () => getIntelProjectClusters(projectId, 12),
    { refreshInterval: 30000 },
  )

  const { data: processesData } = useSWR(
    projectId ? ['intel-project-processes', projectId] : null,
    () => getIntelProjectProcesses(projectId, 12),
    { refreshInterval: 30000 },
  )

  const { data: crossLinksData } = useSWR(
    projectId ? ['intel-project-crosslinks', projectId] : null,
    () => getIntelProjectCrossLinks(projectId),
    { refreshInterval: 60000 },
  )

  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [symbolTree, setSymbolTree] = useState<Record<string, unknown> | null>(null)
  const [symbolContext, setSymbolContext] = useState<{ name: string; raw: string } | null>(null)
  const [symbolImpact, setSymbolImpact] = useState<{ target: string; direction: string; results: unknown } | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [treeDirection, setTreeDirection] = useState<'upstream' | 'downstream'>('downstream')

  const { data: clusterMembersData } = useSWR(
    projectId && selectedCluster ? ['intel-project-cluster-members', projectId, selectedCluster] : null,
    () => getIntelProjectClusterMembers(projectId, selectedCluster ?? ''),
    { refreshInterval: 60000 },
  )

  const context = contextData?.data
  const clusters = clustersData?.data.clusters ?? []
  const processes = processesData?.data.processes ?? []
  const crossLinks = crossLinksData?.data.crossLinks ?? []
  const freshnessTone = statusTone(context?.project.staleness.status)

  function handleLinkCandidate(candidate: IntelDiscoveryCandidate) {
    setLinkingKey(candidate.key)
    startTransition(async () => {
      try {
        const result = await linkDiscoveredProject({
          slug: candidate.slug,
          name: candidate.name,
          gitRepoUrl: candidate.gitRepoUrl,
          repoPath: candidate.repoPath,
        })

        await Promise.all([mutateProjects(), mutateDiscovery()])
        if (result.project?.id) {
          setProjectId(result.project.id)
        }
      } finally {
        setLinkingKey(null)
      }
    })
  }

  const handleViewProcess = async (processName: string) => {
    if (!projectId) return
    setSelectedCluster(null)
    setSelectedProcess(processName)
    setProcessDetail(null)
    setLoadingProcess(true)
    try {
      const data = await getIntelProjectProcessDetail(projectId, processName)
      if (data.success) {
        setProcessDetail({
          process: data.data.process,
          steps: data.data.steps,
        })
      }
    } catch (err) {
      console.error('Failed to load process detail:', err)
    } finally {
      setLoadingProcess(false)
    }
  }

  const handleViewTree = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setLoadingTree(true)
    try {
      const data = await getIntelProjectSymbolTree(projectId, symbolName, { depth: 2, direction: treeDirection })
      setSymbolTree(data)
    } catch (err) {
      console.error('Failed to load symbol tree:', err)
    } finally {
      setLoadingTree(false)
    }
  }

  const handleViewContext = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setSymbolContext(null)
    setLoadingContext(true)
    try {
      const data = await getIntelSymbolContext(projectId, symbolName)
      if (data.success && data.data.results.raw) {
        setSymbolContext({ name: symbolName, raw: data.data.results.raw })
      }
    } catch (err) {
      console.error('Failed to load symbol context:', err)
    } finally {
      setLoadingContext(false)
    }
  }

  const handleViewImpact = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setSymbolImpact(null)
    setLoadingImpact(true)
    try {
      const data = await getIntelSymbolImpact(projectId, symbolName, 'downstream')
      if (data.success) {
        setSymbolImpact({ target: data.data.target, direction: data.data.direction, results: data.data.results })
      }
    } catch (err) {
      console.error('Failed to load impact analysis:', err)
    } finally {
      setLoadingImpact(false)
    }
  }

  const handleRunCypher = async () => {
    if (!projectId || !cypherQuery.trim()) return
    setRunningCypher(true)
    setCypherError(null)
    setCypherResult(null)
    try {
      const data = await runIntelCypherQuery(projectId, cypherQuery)
      setCypherResult(formatCypherOutput(data.data))
    } catch (err) {
      setCypherError(err instanceof Error ? err.message : 'Cypher query failed')
    } finally {
      setRunningCypher(false)
    }
  }

  return (
    <DashboardLayout title="Graph" subtitle="Project architecture explorer built from Cortex intel resources">
      <div className={styles.hero}>
        <div className={styles.heroIntro}>
          <span className={styles.kicker}>Graph Explorer</span>
          <h2 className={styles.heroTitle}>Link orphan repos, surface knowledge-aware projects, and inspect architecture without raw Cypher.</h2>
          <p className={styles.heroText}>
            Cortex now needs to do more than show already-linked projects. This view is meant to expose missing project candidates and give you a graph that still reads when branches grow.
          </p>
        </div>

        <div className={`card ${styles.selectorCard}`}>
          <label className={styles.selectorLabel} htmlFor="graph-project-select">Project</label>
          <select
            id="graph-project-select"
            className={styles.selector}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name} ({project.slug})
              </option>
            ))}
          </select>
          <div className={styles.selectorMeta}>
            {selectedProject ? (
              <>
                <span>branch: {selectedProject.branch ?? 'unknown'}</span>
                <span className={`badge badge-${freshnessTone}`}>{statusLabel(context?.project.staleness.status)}</span>
              </>
            ) : (
              <span>No linked projects yet.</span>
            )}
          </div>
        </div>
      </div>

      {discoveryCandidates.length > 0 && (
        <div className={styles.discoverySection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Unlinked Project Candidates</h2>
            <p className={styles.sectionText}>
              Repos or knowledge spaces exist, but Cortex has not promoted them into first-class projects yet.
            </p>
          </div>
          <div className={styles.discoveryGrid}>
            {discoveryCandidates.map((candidate) => (
              <DiscoveryCard
                key={candidate.key}
                candidate={candidate}
                onLink={handleLinkCandidate}
                linking={linkingKey === candidate.key || isPending}
              />
            ))}
          </div>
        </div>
      )}

      {projectsError && (
        <div className={styles.errorBanner}>Failed to load linked projects.</div>
      )}

      {!projectsError && projects.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          No linked projects yet. Use the discovery cards above to promote repos or knowledge spaces into first-class Cortex projects.
        </div>
      )}

      {contextError && (
        <div className={styles.errorBanner}>Failed to load graph context for the selected project.</div>
      )}

      {selectedProject && context && (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Indexed At" value={formatIndexedAt(context.project.indexedAt)} hint={context.project.staleness.basedOn} />
            <StatCard label="Symbols" value={context.stats.symbols ?? 0} hint={`GitNexus: ${context.project.gitnexus.stats.symbols ?? 0}`} />
            <StatCard label="Relationships" value={context.stats.relationships ?? 0} hint="graph edges" />
            <StatCard label="Knowledge" value={context.project.knowledge.docs} hint={`${context.project.knowledge.chunks} chunks`} />
          </div>

          <div className={styles.graphWrapper}>
            <div className={styles.graphMain}>
              <GraphCanvas
                projectName={selectedProject.name}
                clusters={clusters}
                processes={processes}
                knowledgeDocs={context.project.knowledge.docs}
                knowledgeChunks={context.project.knowledge.chunks}
                crossLinks={crossLinks}
                onNodeClick={(id, variant) => {
                  if (variant === 'cluster') {
                    setSelectedProcess(null)
                    setProcessDetail(null)
                    setSelectedCluster(id === selectedCluster ? null : id)
                  }
                  if (variant === 'process') {
                    void handleViewProcess(id)
                  }
                }}
                selectedClusterId={selectedCluster}
              />
            </div>
            {selectedCluster && (
              <div className={styles.graphSidebar}>
                <div className={`card ${styles.sidebarCard}`}>
                  <div className={styles.sidebarHeader}>
                    <h3 className={styles.sidebarTitle}>{selectedCluster}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCluster(null)}>×</button>
                  </div>
                  <div className={styles.sidebarMeta}>
                    {clusterMembersData?.data?.members?.length ?? 0} members
                  </div>

                  {/* Direction toggle */}
                  <div className={styles.directionToggle}>
                    <span>Tree direction:</span>
                    <button
                      className={`btn btn-sm ${treeDirection === 'upstream' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTreeDirection('upstream')}
                    >↑ Up</button>
                    <button
                      className={`btn btn-sm ${treeDirection === 'downstream' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTreeDirection('downstream')}
                    >↓ Down</button>
                  </div>

                  {!clusterMembersData && <div className={styles.sidebarEmpty}>Loading members...</div>}
                  {clusterMembersData && clusterMembersData.data.members.length === 0 && (
                    <div className={styles.sidebarEmpty}>No members found.</div>
                  )}
                  {clusterMembersData && clusterMembersData.data.members.length > 0 && (
                    <div className={styles.sidebarMemberList}>
                      {clusterMembersData.data.members.map((member) => (
                        <div key={`${member.filePath ?? 'root'}-${member.name}`} className={styles.sidebarMember}>
                          <div className={styles.sidebarMemberHead}>
                            <span className={styles.memberName}>{member.name}</span>
                          </div>
                          <div className={styles.memberActions}>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewTree(member.name)}
                            >
                              Tree
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewContext(member.name)}
                            >
                              Context
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewImpact(member.name)}
                            >
                              Impact
                            </button>
                          </div>
                          <span className={styles.memberType}>{member.type}</span>
                          {member.filePath && <span className={styles.memberFile}>{member.filePath}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {!selectedCluster && selectedProcess && (
              <div className={styles.graphSidebar}>
                <div className={`card ${styles.sidebarCard}`}>
                  <div className={styles.sidebarHeader}>
                    <div>
                      <h3 className={styles.sidebarTitle}>{selectedProcess}</h3>
                      <div className={styles.sidebarMeta}>
                        {loadingProcess
                          ? 'Loading process detail...'
                          : `${processDetail?.steps.length ?? 0} steps${processDetail?.process.type ? ` · ${processDetail.process.type}` : ''}`}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setSelectedProcess(null)
                        setProcessDetail(null)
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {loadingProcess && <div className={styles.sidebarEmpty}>Loading process detail...</div>}
                  {!loadingProcess && !processDetail && (
                    <div className={styles.sidebarEmpty}>No process detail found for this process yet.</div>
                  )}
                  {!loadingProcess && processDetail && (
                    <>
                      <div className={styles.processMetaGrid}>
                        <div className={styles.processMetaItem}>
                          <span className={styles.processMetaLabel}>Type</span>
                          <span className={styles.processMetaValue}>{processDetail.process.type ?? 'unknown'}</span>
                        </div>
                        <div className={styles.processMetaItem}>
                          <span className={styles.processMetaLabel}>Steps</span>
                          <span className={styles.processMetaValue}>{processDetail.process.steps}</span>
                        </div>
                      </div>
                      <div className={styles.processSteps}>
                        {processDetail.steps.map((step) => (
                          <div key={`${processDetail.process.id}-${step.step}-${step.name}`} className={styles.processStep}>
                            <div className={styles.processStepHead}>
                              <span className={styles.processStepIndex}>Step {step.step}</span>
                              {step.type && <span className={styles.processStepType}>{step.type}</span>}
                            </div>
                            <span className={styles.processStepName}>{step.name}</span>
                            {step.filePath && <span className={styles.processStepFile}>{step.filePath}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={styles.columns}>
            <ColumnList
              title="Top Clusters"
              empty="No cluster data yet."
              items={clusters.map((cluster) => ({
                name: cluster.name,
                meta: `${cluster.symbols} symbols${cluster.cohesion != null ? ` · cohesion ${cluster.cohesion}` : ''}`,
              }))}
            />

            <ColumnList
              title="Top Processes"
              empty="No process data yet."
              items={processes.map((process) => ({
                name: process.name,
                meta: `${process.steps} steps${process.type ? ` · ${process.type}` : ''}`,
              }))}
            />
          </div>

          {(clustersData?.data.hint || processesData?.data.hint) && (
            <div className={`card ${styles.hintsCard}`}>
              <h3 className={styles.cardTitle}>Current Index Quality</h3>
              {clustersData?.data.hint && <p className={styles.hintText}>{clustersData.data.hint}</p>}
              {processesData?.data.hint && <p className={styles.hintText}>{processesData.data.hint}</p>}
            </div>
          )}

          <div className={`card ${styles.playgroundCard}`}>
            <div className={styles.playgroundHeader}>
              <div>
                <h3 className={styles.cardTitle}>Cypher Playground</h3>
                <p className={styles.cardSub}>
                  Run read-only GitNexus graph queries against the selected project when the overview view is not enough.
                </p>
              </div>
              <div className={styles.playgroundPresets}>
                {CYPHER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="btn btn-secondary btn-sm"
                    onClick={() => setCypherQuery(preset.query)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className={styles.playgroundInput}
              value={cypherQuery}
              onChange={(event) => setCypherQuery(event.target.value)}
              spellCheck={false}
            />

            <div className={styles.playgroundActions}>
              <span className={styles.playgroundHint}>
                Scoped to project: {selectedProject.slug}
              </span>
              <button className="btn btn-primary btn-sm" onClick={handleRunCypher} disabled={runningCypher || !cypherQuery.trim()}>
                {runningCypher ? 'Running…' : 'Run Query'}
              </button>
            </div>

            {cypherError && <div className={styles.errorBanner}>{cypherError}</div>}
            {cypherResult && (
              <pre className={styles.playgroundOutput}>{cypherResult}</pre>
            )}
          </div>
        </>
      )}

      {selectedSymbol && (
        loadingTree ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading dependency tree for {selectedSymbol}…</div>
        ) : (
          <SymbolTreeViewer
            symbolName={selectedSymbol}
            treeData={symbolTree}
            onClose={() => {
              setSelectedSymbol(null)
              setSymbolTree(null)
            }}
          />
        )
      )}

      {/* Symbol Context Panel */}
      {selectedSymbol && symbolContext && !loadingContext && (
        <div className={`card ${styles.contextPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>360° Symbol View</span>
              <h3 className={styles.panelTitle}>{symbolContext.name}</h3>
            </div>
            <button className="btn btn-ghost" onClick={() => { setSelectedSymbol(null); setSymbolContext(null) }}>Close</button>
          </div>
          <div className={styles.contextContent}>
            <pre className={styles.contextPre}>{symbolContext.raw}</pre>
          </div>
        </div>
      )}

      {selectedSymbol && loadingContext && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading context for {selectedSymbol}…</div>
      )}

      {/* Impact Analysis Panel */}
      {selectedSymbol && symbolImpact && !loadingImpact && (
        <div className={`card ${styles.impactPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>Blast Radius Analysis</span>
              <h3 className={styles.panelTitle}>{symbolImpact.target}</h3>
              <span className={styles.panelSub}>Direction: {symbolImpact.direction}</span>
            </div>
            <button className="btn btn-ghost" onClick={() => { setSelectedSymbol(null); setSymbolImpact(null) }}>Close</button>
          </div>
          <div className={styles.impactContent}>
            {typeof symbolImpact.results === 'string' ? (
              <pre className={styles.contextPre}>{symbolImpact.results as string}</pre>
            ) : (
              <pre className={styles.contextPre}>{JSON.stringify(symbolImpact.results, null, 2)}</pre>
            )}
          </div>
        </div>
      )}

      {selectedSymbol && loadingImpact && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading impact analysis for {selectedSymbol}…</div>
      )}
    </DashboardLayout>
  )
}
