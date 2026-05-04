'use client'

import { useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getActivityFeed,
  getIntelProjectsResource,
  getSystemMetrics,
  startIndexing,
  type ActivityEvent,
  type IntelProjectResourceSummary,
  type SystemMetrics,
} from '@/lib/api'
import styles from './page.module.css'

type Container = SystemMetrics['containers'][number]
type IndexJob = SystemMetrics['indexJobs'][number]
type ProjectResource = IntelProjectResourceSummary

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'not started'
  const ts = new Date(dateStr).getTime()
  if (Number.isNaN(ts)) return dateStr
  const diff = Math.max(0, Date.now() - ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function statusClass(status: string | null | undefined, active = false): string {
  if (active) return 'warning'
  if (status === 'done' || status === 'running' || status === 'ok' || status === 'active' || status === 'fresh') return 'healthy'
  if (status === 'error' || status === 'exited' || status === 'dead') return 'error'
  return 'warning'
}

function ResourceCard({ label, value, detail, level }: {
  label: string
  value: string
  detail: string
  level: number
}) {
  const tone = level >= 90 ? styles.danger : level >= 70 ? styles.warning : styles.healthy
  return (
    <div className={`card ${styles.resourceCard}`}>
      <div className={styles.resourceHeader}>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
      </div>
      <div className={styles.meterTrack}>
        <div className={`${styles.meterFill} ${tone}`} style={{ width: `${Math.min(100, Math.max(0, level))}%` }} />
      </div>
      <span className={styles.resourceDetail}>{detail}</span>
    </div>
  )
}

function ContainerRow({ container }: { container: Container }) {
  const running = container.status === 'running'
  return (
    <div className={styles.tableRow}>
      <div className={styles.nameCell}>
        <span className={`status-dot ${statusClass(container.status)}`} />
        <div>
          <strong>{container.name}</strong>
          <span>{container.image || 'unknown image'}</span>
        </div>
      </div>
      <span className={running ? styles.hotValue : styles.muted}>{running ? container.cpu : '-'}</span>
      <span>{running ? container.memory : '-'}</span>
      <span>{running ? `${container.memoryPercent.toFixed(1)}%` : '-'}</span>
      <span className={styles.muted}>{container.uptime}</span>
    </div>
  )
}

function JobRow({ job }: { job: IndexJob }) {
  const started = job.startedAt ?? job.createdAt
  const secondary = [
    `${job.symbolsFound}/${job.totalFiles} symbols/files`,
    job.mem9Status ? `mem9 ${job.mem9Status}${job.mem9Chunks ? ` (${job.mem9Chunks})` : ''}` : null,
    job.docsKnowledgeStatus ? `docs ${job.docsKnowledgeStatus}${job.docsKnowledgeCount ? ` (${job.docsKnowledgeCount})` : ''}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={styles.jobRow}>
      <div className={styles.jobMain}>
        <div className={styles.jobTitleLine}>
          <span className={`status-dot ${statusClass(job.status, job.active)}`} />
          <strong>{job.projectName}</strong>
          <code>{job.branch}</code>
        </div>
        <span className={styles.jobMeta}>{secondary || 'no sub-jobs recorded'}</span>
        {job.error && <span className={styles.jobError}>{job.error}</span>}
      </div>
      <div className={styles.jobProgress}>
        <span className={`badge badge-${statusClass(job.status, job.active)}`}>{job.status}</span>
        <div className={styles.progressTrack}>
          <div style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} />
        </div>
        <span className={styles.muted}>{job.progress}% · {timeAgo(started)}</span>
      </div>
    </div>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const latency = event.latency_ms && event.latency_ms > 0 ? `${event.latency_ms}ms` : '-'
  const project = event.project_name ?? event.project_id ?? 'global'

  return (
    <div className={styles.activityRow}>
      <div className={styles.activityMain}>
        <span className={`status-dot ${statusClass(event.status)}`} />
        <div>
          <strong>{event.detail}</strong>
          <span>{event.agent_id} · {project}</span>
        </div>
      </div>
      <span className={`badge badge-${statusClass(event.status)}`}>{event.status}</span>
      <span className={styles.muted}>{latency}</span>
      <span className={styles.muted}>{timeAgo(event.created_at)}</span>
    </div>
  )
}

function Signal({ label, value, tone = 'neutral' }: {
  label: string
  value: string
  tone?: 'neutral' | 'healthy' | 'warning' | 'danger'
}) {
  const toneClass = tone === 'healthy'
    ? styles.healthy
    : tone === 'warning'
      ? styles.warning
      : tone === 'danger'
        ? styles.danger
        : ''

  return (
    <div className={styles.signalItem}>
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
    </div>
  )
}

function projectIndexTone(project: ProjectResource): 'healthy' | 'warning' | 'danger' {
  const status = project.latestIndexJob?.status ?? project.staleness.latestJobStatus ?? 'none'
  if (status === 'done') return 'healthy'
  if (status === 'error') return 'danger'
  return 'warning'
}

export default function OpsPage() {
  const { data, error, isLoading, mutate } = useSWR('ops-system-metrics', getSystemMetrics, {
    refreshInterval: 5000,
  })
  const { data: activityData } = useSWR('ops-activity', () => getActivityFeed(24), {
    refreshInterval: 5000,
  })
  const { data: projectsData, mutate: mutateProjects } = useSWR('ops-intel-projects', getIntelProjectsResource, {
    refreshInterval: 30000,
  })
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [startMessage, setStartMessage] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const containers = data?.containers ?? []
  const jobs = data?.indexJobs ?? []
  const activeJobs = jobs.filter((job) => job.active)
  const activity = activityData?.activity ?? []
  const topCpu = containers[0]
  const topMemory = [...containers].sort((a, b) => b.memoryRaw - a.memoryRaw)[0]
  const projects = projectsData?.data.items ?? []
  const indexableProjects = useMemo(
    () => projects
      .filter((project) => project.classification.isIndexable)
      .sort((a, b) => {
        if (a.projectId === 'proj-10cea6cf') return -1
        if (b.projectId === 'proj-10cea6cf') return 1
        const staleRank = (project: ProjectResource) => project.staleness.status === 'fresh' ? 1 : 0
        return staleRank(a) - staleRank(b) || a.name.localeCompare(b.name)
      }),
    [projects],
  )
  const selectedProject = indexableProjects.find((project) => project.projectId === selectedProjectId)
    ?? indexableProjects[0]
  const graphRelationships = selectedProject?.gitnexus.stats.relationships ?? 0
  const graphReady = graphRelationships > 0
  const canStartIndex = Boolean(selectedProject) && !isStarting && activeJobs.length === 0

  async function handleStartGitNexus() {
    if (!selectedProject) return
    setIsStarting(true)
    setStartMessage(null)
    setStartError(null)

    try {
      const result = await startIndexing(selectedProject.projectId, selectedProject.branch ?? undefined)
      setStartMessage(`Queued ${selectedProject.name} · ${result.jobId}`)
      await Promise.all([mutate(), mutateProjects()])
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <DashboardLayout title="Ops" subtitle="Live runtime load, containers, and indexing activity">
      <div className={styles.toolbar}>
        <div>
          <span className={styles.livePill}>Live · refreshes every 5s</span>
          {data && <span className={styles.hostMeta}>{data.hostname} · {data.ip} · {data.cpu.cores} cores</span>}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => mutate()} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.errorBanner}>Could not load system metrics.</div>}
      {startError && <div className={styles.errorBanner}>{startError}</div>}
      {startMessage && <div className={styles.successBanner}>{startMessage}</div>}

      <div className={styles.resourceGrid}>
        <ResourceCard
          label="CPU"
          value={`${data?.cpu.percent ?? 0}%`}
          detail={data ? `Load ${data.cpu.loadAvg.join(' / ')}` : 'waiting for metrics'}
          level={data?.cpu.percent ?? 0}
        />
        <ResourceCard
          label="Memory"
          value={`${data?.memory.percent ?? 0}%`}
          detail={data ? `${data.memory.usedHuman} / ${data.memory.totalHuman}` : 'waiting for metrics'}
          level={data?.memory.percent ?? 0}
        />
        <ResourceCard
          label="Disk"
          value={`${data?.disk[0]?.usedPercent ?? 0}%`}
          detail={data?.disk[0] ? `${data.disk[0].used} / ${data.disk[0].size} on ${data.disk[0].mountpoint}` : 'waiting for metrics'}
          level={data?.disk[0]?.usedPercent ?? 0}
        />
        <div className={`card ${styles.summaryCard}`}>
          <span className={styles.summaryLabel}>Hot spots</span>
          <strong>{topCpu ? `${topCpu.name} · ${topCpu.cpu}` : 'No container stats'}</strong>
          <span>{topMemory ? `Top memory: ${topMemory.name} · ${formatBytes(topMemory.memoryRaw)}` : 'No memory data'}</span>
          <span>{activeJobs.length} active job{activeJobs.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>GitNexus One-Project Run</h2>
          <span>{activeJobs.length > 0 ? 'Waiting for current job' : 'Ready for one bounded run'}</span>
        </div>
        <div className={`card ${styles.gitnexusCard}`}>
          <div className={styles.gitnexusControls}>
            <label className={styles.selectLabel} htmlFor="ops-project-select">Project</label>
            <select
              id="ops-project-select"
              className={styles.projectSelect}
              value={selectedProject?.projectId ?? ''}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              disabled={indexableProjects.length === 0 || isStarting}
            >
              {indexableProjects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name} ({project.slug})
                </option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleStartGitNexus} disabled={!canStartIndex}>
              {isStarting ? 'Queueing...' : 'Analyze selected project'}
            </button>
          </div>

          {selectedProject ? (
            <div className={styles.signalGrid}>
              <Signal
                label="Index"
                value={selectedProject.latestIndexJob?.status ?? selectedProject.staleness.latestJobStatus ?? 'none'}
                tone={projectIndexTone(selectedProject)}
              />
              <Signal
                label="Symbols"
                value={String(selectedProject.gitnexus.stats.symbols ?? selectedProject.symbols ?? 0)}
                tone={(selectedProject.gitnexus.stats.symbols ?? selectedProject.symbols ?? 0) > 0 ? 'healthy' : 'warning'}
              />
              <Signal
                label="Mem9"
                value={selectedProject.latestIndexJob?.mem9Status ?? 'unknown'}
                tone={selectedProject.latestIndexJob?.mem9Status === 'done' ? 'healthy' : 'warning'}
              />
              <Signal
                label="Docs"
                value={`${selectedProject.knowledge.docs} docs / ${selectedProject.knowledge.chunks} chunks`}
                tone={selectedProject.knowledge.docs > 0 ? 'healthy' : 'warning'}
              />
              <Signal
                label="Staleness"
                value={selectedProject.staleness.status}
                tone={selectedProject.staleness.status === 'fresh' ? 'healthy' : 'warning'}
              />
              <Signal
                label="Graph"
                value={graphReady ? `${graphRelationships} edges` : 'no edges yet'}
                tone={graphReady ? 'healthy' : 'warning'}
              />
            </div>
          ) : (
            <div className={styles.emptyState}>No indexable Cortex projects reported.</div>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Containers</h2>
          <span>{containers.length} total, sorted by CPU</span>
        </div>
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <span>Container</span>
            <span>CPU</span>
            <span>Memory</span>
            <span>Mem %</span>
            <span>Status</span>
          </div>
          {containers.length > 0 ? (
            containers.map((container) => <ContainerRow key={container.name} container={container} />)
          ) : (
            <div className={styles.emptyState}>No Docker containers reported.</div>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Indexing Activity</h2>
          <span>{activeJobs.length} active, {jobs.length} recent</span>
        </div>
        <div className={`card ${styles.jobsCard}`}>
          {jobs.length > 0 ? (
            jobs.map((job) => <JobRow key={job.id} job={job} />)
          ) : (
            <div className={styles.emptyState}>No indexing jobs recorded yet.</div>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Runtime Activity</h2>
          <span>{activity.length} recent events</span>
        </div>
        <div className={`card ${styles.activityCard}`}>
          {activity.length > 0 ? (
            activity.map((event, index) => (
              <ActivityRow key={`${event.type}-${event.created_at}-${index}`} event={event} />
            ))
          ) : (
            <div className={styles.emptyState}>No runtime activity recorded yet.</div>
          )}
        </div>
      </section>
    </DashboardLayout>
  )
}
