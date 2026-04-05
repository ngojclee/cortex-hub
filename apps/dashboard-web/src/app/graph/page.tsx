'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getIntelProjectsResource,
  getIntelProjectContext,
  getIntelProjectClusters,
  getIntelProjectProcesses,
  type IntelClusterResource,
  type IntelProcessResource,
} from '@/lib/api'
import styles from './page.module.css'

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

function GraphCanvas({
  projectName,
  clusters,
  processes,
}: {
  projectName: string
  clusters: IntelClusterResource[]
  processes: IntelProcessResource[]
}) {
  const clusterNodes = clusters.slice(0, 4)
  const processNodes = processes.slice(0, 4)
  const width = 960
  const height = 420
  const center = { x: 480, y: 210 }

  const clusterPoints = clusterNodes.map((cluster, index) => ({
    ...cluster,
    x: 210,
    y: 90 + index * 88,
  }))

  const processPoints = processNodes.map((process, index) => ({
    ...process,
    x: 750,
    y: 90 + index * 88,
  }))

  return (
    <div className={`card ${styles.graphCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Context Graph</h3>
          <p className={styles.cardSub}>
            Lightweight explorer built from Cortex resources. This is an architecture map, not a full raw call graph.
          </p>
        </div>
      </div>

      <div className={styles.graphViewport}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.graphSvg} role="img" aria-label="Project graph overview">
          <defs>
            <linearGradient id="graphLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(110, 168, 254, 0.18)" />
              <stop offset="100%" stopColor="rgba(192, 132, 252, 0.42)" />
            </linearGradient>
            <linearGradient id="clusterNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#16355f" />
              <stop offset="100%" stopColor="#24538b" />
            </linearGradient>
            <linearGradient id="projectNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#24103d" />
              <stop offset="100%" stopColor="#5d2f8e" />
            </linearGradient>
            <linearGradient id="processNode" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1c3f2d" />
              <stop offset="100%" stopColor="#2f7d57" />
            </linearGradient>
          </defs>

          <rect x="12" y="12" width={width - 24} height={height - 24} rx="28" className={styles.graphFrame} />

          {clusterPoints.map((cluster) => (
            <line
              key={`line-cluster-${cluster.name}`}
              x1={cluster.x + 110}
              y1={cluster.y + 26}
              x2={center.x - 88}
              y2={center.y}
              stroke="url(#graphLine)"
              strokeWidth="2"
              strokeDasharray="6 8"
            />
          ))}

          {processPoints.map((process) => (
            <line
              key={`line-process-${process.name}`}
              x1={center.x + 88}
              y1={center.y}
              x2={process.x}
              y2={process.y + 26}
              stroke="url(#graphLine)"
              strokeWidth="2"
              strokeDasharray="6 8"
            />
          ))}

          {clusterPoints.map((cluster) => (
            <g key={`cluster-${cluster.name}`} transform={`translate(${cluster.x}, ${cluster.y})`}>
              <rect width="220" height="54" rx="18" fill="url(#clusterNode)" className={styles.graphNode} />
              <text x="18" y="24" className={styles.graphNodeTitle}>{cluster.name}</text>
              <text x="18" y="40" className={styles.graphNodeMeta}>{cluster.symbols} symbols</text>
            </g>
          ))}

          <g transform={`translate(${center.x - 90}, ${center.y - 42})`}>
            <rect width="180" height="84" rx="24" fill="url(#projectNode)" className={styles.graphCore} />
            <text x="24" y="35" className={styles.graphCoreTitle}>{projectName}</text>
            <text x="24" y="58" className={styles.graphCoreMeta}>project context</text>
          </g>

          {processPoints.map((process) => (
            <g key={`process-${process.name}`} transform={`translate(${process.x - 220}, ${process.y})`}>
              <rect width="220" height="54" rx="18" fill="url(#processNode)" className={styles.graphNode} />
              <text x="18" y="24" className={styles.graphNodeTitle}>{process.name}</text>
              <text x="18" y="40" className={styles.graphNodeMeta}>{process.steps} steps</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

export default function GraphPage() {
  const [projectId, setProjectId] = useState('')

  const { data: projectsData, error: projectsError } = useSWR('intel-projects-resource', getIntelProjectsResource, {
    refreshInterval: 30000,
  })

  const projects = projectsData?.data.items ?? []

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
    () => getIntelProjectClusters(projectId, 8),
    { refreshInterval: 30000 },
  )

  const { data: processesData } = useSWR(
    projectId ? ['intel-project-processes', projectId] : null,
    () => getIntelProjectProcesses(projectId, 8),
    { refreshInterval: 30000 },
  )

  const context = contextData?.data
  const clusters = clustersData?.data.clusters ?? []
  const processes = processesData?.data.processes ?? []
  const freshnessTone = statusTone(context?.project.staleness.status)

  return (
    <DashboardLayout title="Graph" subtitle="Project architecture explorer built from Cortex intel resources">
      <div className={styles.hero}>
        <div className={styles.heroIntro}>
          <span className={styles.kicker}>Graph Explorer</span>
          <h2 className={styles.heroTitle}>Inspect how a project is indexed without dropping into raw Cypher.</h2>
          <p className={styles.heroText}>
            Pick a linked project to inspect freshness, top clusters, and top processes. This page stays lightweight on purpose so operators can sanity-check architecture quickly.
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

      {projectsError && (
        <div className={styles.errorBanner}>Failed to load linked projects.</div>
      )}

      {!projectsError && projects.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          No linked projects yet. Create or link a project first so Cortex can expose graph resources.
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
            <StatCard label="Processes" value={context.stats.processes ?? 0} hint={`visible: ${processes.length}`} />
          </div>

          <GraphCanvas
            projectName={selectedProject.name}
            clusters={clusters}
            processes={processes}
          />

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
    </DashboardLayout>
  )
}
