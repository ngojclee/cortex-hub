'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getIntelProjectsResource,
  getIntelProjectContext,
  getIntelProjectClusters,
  getIntelProjectProcesses,
  getIntelProjectDiscovery,
  getIntelProjectCrossLinks,
  getIntelProjectClusterMembers,
  getIntelProjectSymbolTree,
  linkDiscoveredProject,
  type IntelClusterResource,
  type IntelDiscoveryCandidate,
  type IntelProcessResource,
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

type OrbitNode = {
  id: string
  title: string
  meta: string
  x: number
  y: number
  variant: 'cluster' | 'process' | 'summary' | 'knowledge'
}

function buildOrbitNodes(
  items: Array<{ id: string; title: string; meta: string }>,
  side: 'left' | 'right',
  center: { x: number; y: number },
  limit: number,
): OrbitNode[] {
  const visible = items.slice(0, limit)
  const remaining = items.length - visible.length
  const start = side === 'left' ? 225 : -45
  const end = side === 'left' ? 135 : 45
  const count = visible.length + (remaining > 0 ? 1 : 0)
  const step = count <= 1 ? 0 : (end - start) / (count - 1)

  const positioned: OrbitNode[] = visible.map((item, index) => {
    const angle = ((start + step * index) * Math.PI) / 180
    const radiusX = 315
    const radiusY = 170

    return {
      id: item.id,
      title: truncateLabel(item.title),
      meta: item.meta,
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
      variant: side === 'left' ? 'cluster' : 'process',
    }
  })

  if (remaining > 0) {
    const angle = ((start + step * (count - 1)) * Math.PI) / 180
    positioned.push({
      id: `${side}-overflow`,
      title: `+${remaining} more`,
      meta: side === 'left' ? 'additional clusters' : 'additional processes',
      x: center.x + Math.cos(angle) * 315,
      y: center.y + Math.sin(angle) * 170,
      variant: 'summary',
    })
  }

  return positioned
}

function linkPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
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
  const height = 700
  const center = { x: 540, y: 320 }

  const clusterNodes = buildOrbitNodes(
    clusters.map((cluster, index) => ({
      id: cluster.id ?? `cluster-${index}`,
      title: cluster.name,
      meta: `${cluster.symbols} symbols`,
    })),
    'left',
    center,
    6,
  )

  const processNodes = buildOrbitNodes(
    processes.map((process, index) => ({
      id: process.id ?? `process-${index}`,
      title: process.name,
      meta: `${process.steps} steps${process.type ? ` · ${process.type}` : ''}`,
    })),
    'right',
    center,
    6,
  )

  const knowledgeNode: OrbitNode | null = knowledgeDocs > 0 || knowledgeChunks > 0
    ? {
        id: 'knowledge-node',
        title: 'Knowledge Base',
        meta: `${knowledgeDocs} docs · ${knowledgeChunks} chunks`,
        x: center.x,
        y: 585,
        variant: 'knowledge',
      }
    : null

  const nodes = [...clusterNodes, ...processNodes, ...(knowledgeNode ? [knowledgeNode] : [])]

  return (
    <div className={`card ${styles.graphCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Context Graph</h3>
          <p className={styles.cardSub}>
            The graph now scales as a hub with orbiting branches, so it can survive more clusters and processes without becoming a four-box mockup.
          </p>
        </div>
      </div>

      <div className={styles.graphViewport}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.graphSvg} role="img" aria-label="Project graph overview">
          <defs>
            <linearGradient id="graphLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(96, 165, 250, 0.18)" />
              <stop offset="100%" stopColor="rgba(192, 132, 252, 0.52)" />
            </linearGradient>
            <radialGradient id="graphGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(124, 58, 237, 0.22)" />
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
          <circle cx={center.x} cy={center.y} r="250" fill="url(#graphGlow)" />

          {nodes.map((node) => (
            <path
              key={`edge-${node.id}`}
              d={linkPath(center, node)}
              stroke="url(#graphLine)"
              strokeWidth="2.2"
              strokeDasharray={node.variant === 'knowledge' ? '0' : '6 8'}
              fill="none"
              className={styles.graphEdge}
            />
          ))}

          {crossLinks.map((link) => {
            const sourceNode = clusterNodes.find(n => n.id === link.source || n.title === link.source)
            const targetNode = clusterNodes.find(n => n.id === link.target || n.title === link.target)
            if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return null
            
            // Adjust SVG path for inter-cluster edges (curved paths between orbiting nodes)
            const pathData = `M ${sourceNode.x} ${sourceNode.y} Q ${center.x - 200} ${center.y + 100} ${targetNode.x} ${targetNode.y}`

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

          <g transform={`translate(${center.x - 118}, ${center.y - 58})`}>
            <rect width="236" height="116" rx="28" fill="url(#projectNode)" className={styles.graphCore} />
            <text x="28" y="45" className={styles.graphCoreTitle}>{truncateLabel(projectName, 22)}</text>
            <text x="28" y="72" className={styles.graphCoreMeta}>project context</text>
            <text x="28" y="92" className={styles.graphCoreSmall}>
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
                className={node.variant === 'cluster' ? styles.graphNodeInteractive : ''}
                onClick={() => {
                  if (node.variant === 'cluster') onNodeClick(node.title, node.variant)
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
  const [isPending, startTransition] = useTransition()

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
      setProjectId(projects[0]!.projectId)
    }
  }, [projectId, projects])

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
  const [symbolTree, setSymbolTree] = useState<any>(null)
  const [loadingTree, setLoadingTree] = useState(false)

  const { data: clusterMembersData } = useSWR(
    projectId && selectedCluster ? ['intel-project-cluster-members', projectId, selectedCluster] : null,
    () => getIntelProjectClusterMembers(projectId, selectedCluster!),
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

  const handleViewTree = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setLoadingTree(true)
    try {
      const data = await getIntelProjectSymbolTree(projectId, symbolName, { depth: 2 })
      setSymbolTree(data)
    } catch (err) {
      console.error('Failed to load symbol tree:', err)
    } finally {
      setLoadingTree(false)
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
                  if (variant === 'cluster') setSelectedCluster(id === selectedCluster ? null : id)
                }}
                selectedClusterId={selectedCluster}
              />
            </div>
            {selectedCluster && (
              <div className={styles.graphSidebar}>
                <div className={`card ${styles.sidebarCard}`}>
                  <h3 className={styles.sidebarTitle}>{selectedCluster}</h3>
                  <div className={styles.sidebarMeta}>
                    {clusterMembersData?.data.totalCount ?? 0} members
                  </div>
                  
                  {!clusterMembersData && <div className={styles.sidebarEmpty}>Loading members...</div>}
                  {clusterMembersData && clusterMembersData.data.members.length === 0 && (
                    <div className={styles.sidebarEmpty}>No members found.</div>
                  )}
                  {clusterMembersData && clusterMembersData.data.members.length > 0 && (
                    <div className={styles.sidebarMemberList}>
                      {clusterMembersData.data.members.map((member) => (
                        <div key={`${member.filePath}-${member.name}`} className={styles.sidebarMember}>
                          <div className={styles.sidebarMemberHead}>
                            <span className={styles.memberName}>{member.name}</span>
                            <button 
                              className="btn btn-sm btn-secondary" 
                              style={{ padding: '2px 8px', fontSize: '10px' }}
                              onClick={() => handleViewTree(member.name)}
                            >
                              Tree
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
        </>
      )}

      {selectedSymbol && (
        <SymbolTreeViewer 
          symbolName={selectedSymbol} 
          treeData={symbolTree} 
          onClose={() => {
            setSelectedSymbol(null)
            setSymbolTree(null)
          }} 
        />
      )}
    </DashboardLayout>
  )
}
