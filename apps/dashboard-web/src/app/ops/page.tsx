'use client'

import { useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getActivityFeed,
  getIntelProjectsResource,
  getRuntimeLogs,
  getSystemMetrics,
  startIndexing,
  type ActivityEvent,
  type IntelProjectResourceSummary,
  type RuntimeLogEntry,
  type SystemMetrics,
} from '@/lib/api'
import styles from './page.module.css'

type Container = SystemMetrics['containers'][number]
type IndexJob = SystemMetrics['indexJobs'][number]
type ProjectResource = IntelProjectResourceSummary

const LOG_SERVICES = [
  { id: 'all', label: 'All Cortex' },
  { id: 'cortex-gitnexus', label: 'GitNexus' },
  { id: 'cortex-api', label: 'API + UI' },
  { id: 'cortex-mcp', label: 'MCP' },
  { id: 'cortex-llm-proxy', label: 'LLM Proxy' },
  { id: 'cortex-qdrant', label: 'Qdrant' },
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'unknown'
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

function logLevel(message: string): 'error' | 'warn' | 'info' {
  const lowered = message.toLowerCase()
  if (lowered.includes('error') || lowered.includes('failed') || lowered.includes('exception')) return 'error'
  if (lowered.includes('warn') || lowered.includes('unhealthy') || lowered.includes('timeout')) return 'warn'
  return 'info'
}

function WorkloadRow({ container }: { container: Container }) {
  const running = container.status === 'running'
  return (
    <div className={styles.workloadRow}>
      <div className={styles.nameCell}>
        <span className={`status-dot ${statusClass(container.status)}`} />
        <div>
          <strong>{container.name}</strong>
          <span>{container.uptime || container.image}</span>
        </div>
      </div>
      <strong className={container.cpuPercent >= 50 ? styles.danger : container.cpuPercent >= 20 ? styles.warning : styles.hotValue}>
        {running ? container.cpu : '-'}
      </strong>
      <span>{running ? formatBytes(container.memoryRaw) : '-'}</span>
      <span className={styles.muted}>{running ? `${container.memoryPercent.toFixed(1)}%` : '-'}</span>
    </div>
  )
}

function JobRow({ job }: { job: IndexJob }) {
  const started = job.startedAt ?? job.createdAt
  const secondary = [
    `${job.symbolsFound}/${job.totalFiles} symbols/files`,
    job.mem9Status ? `mem9 ${job.mem9Status}${job.mem9Chunks ? ` (${job.mem9Chunks})` : ''}` : null,
    job.docsKnowledgeStatus ? `docs ${job.docsKnowledgeStatus}${job.docsKnowledgeCount ? ` (${job.docsKnowledgeCount})` : ''}` : null,
  ].filter(Boolean).join(' - ')

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
        <span className={styles.muted}>{job.progress}% - {timeAgo(started)}</span>
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
          <span>{event.agent_id} - {project}</span>
        </div>
      </div>
      <span className={`badge badge-${statusClass(event.status)}`}>{event.status}</span>
      <span className={styles.muted}>{latency}</span>
      <span className={styles.muted}>{timeAgo(event.created_at)}</span>
    </div>
  )
}

function LogRow({ log }: { log: RuntimeLogEntry }) {
  const level = logLevel(log.message)
  return (
    <div className={`${styles.logRow} ${styles[level]}`}>
      <span className={styles.logTime}>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--:--:--'}</span>
      <span className={styles.logService}>{log.container.replace('cortex-', '')}</span>
      <code>{log.message}</code>
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
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedLogService, setSelectedLogService] = useState('cortex-gitnexus')
  const [isStarting, setIsStarting] = useState(false)
  const [startMessage, setStartMessage] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR('ops-system-metrics', getSystemMetrics, {
    refreshInterval: 5000,
  })
  const { data: logData, mutate: mutateLogs } = useSWR(
    ['ops-runtime-logs', selectedLogService],
    () => getRuntimeLogs(selectedLogService, 160),
    { refreshInterval: 3000 },
  )
  const { data: activityData } = useSWR('ops-activity', () => getActivityFeed(18), {
    refreshInterval: 5000,
  })
  const { data: projectsData, mutate: mutateProjects } = useSWR('ops-intel-projects', getIntelProjectsResource, {
    refreshInterval: 30000,
  })

  const containers = data?.containers ?? []
  const jobs = data?.indexJobs ?? []
  const logs = logData?.logs ?? []
  const activity = activityData?.activity ?? []
  const activeJobs = jobs.filter((job) => job.active)
  const gitnexus = containers.find((container) => container.name === 'cortex-gitnexus')
  const hotContainers = containers.filter((container) => container.status === 'running').slice(0, 8)
  const startCount = logs.filter((log) => log.message.includes('Starting eval-server')).length
  const shutdownCount = logs.filter((log) => log.message.includes('shutting down')).length
  const startupScanCount = logs.filter((log) => log.message.includes('Startup indexing enabled')).length

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
  const canStartIndex = Boolean(selectedProject) && !isStarting && activeJobs.length === 0
  const restartPattern = startCount >= 2 || shutdownCount >= 1

  async function refreshAll() {
    await Promise.all([mutate(), mutateLogs(), mutateProjects()])
  }

  async function handleStartGitNexus() {
    if (!selectedProject) return
    setIsStarting(true)
    setStartMessage(null)
    setStartError(null)

    try {
      const result = await startIndexing(selectedProject.projectId, selectedProject.branch ?? undefined)
      setStartMessage(`Queued ${selectedProject.name} - ${result.jobId}`)
      await refreshAll()
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <DashboardLayout title="Ops" subtitle="Live server workload, logs, and bounded maintenance actions">
      <div className={styles.toolbar}>
        <div>
          <span className={styles.livePill}>Live - logs every 3s</span>
          {data && <span className={styles.hostMeta}>{data.hostname} - {data.ip} - {data.cpu.cores} cores</span>}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={refreshAll} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.errorBanner}>Could not load system metrics.</div>}
      {startError && <div className={styles.errorBanner}>{startError}</div>}
      {startMessage && <div className={styles.successBanner}>{startMessage}</div>}

      <div className={`card ${restartPattern ? styles.diagnosisCardDanger : styles.diagnosisCard}`}>
        <div>
          <span className={styles.summaryLabel}>GitNexus runtime diagnosis</span>
          <strong>
            {restartPattern
              ? `Restart/shutdown pattern visible: ${startCount} starts, ${shutdownCount} shutdowns in current log window`
              : 'No restart loop visible in current log window'}
          </strong>
          <p>
            {startupScanCount > 0
              ? `Startup indexing scan appeared ${startupScanCount} time(s). Keep startup indexing disabled and run one project manually.`
              : 'Startup indexing scan is not visible in this log window.'}
          </p>
        </div>
        <div className={styles.diagnosisMetrics}>
          <Signal label="GitNexus CPU" value={gitnexus?.cpu ?? '-'} tone={(gitnexus?.cpuPercent ?? 0) >= 50 ? 'danger' : 'warning'} />
          <Signal label="Memory" value={gitnexus ? formatBytes(gitnexus.memoryRaw) : '-'} />
          <Signal label="Status" value={gitnexus?.status ?? 'missing'} tone={gitnexus?.status === 'running' ? 'healthy' : 'danger'} />
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Server Logs</h2>
          <div className={styles.logControls}>
            <select value={selectedLogService} onChange={(event) => setSelectedLogService(event.target.value)}>
              {LOG_SERVICES.map((service) => (
                <option key={service.id} value={service.id}>{service.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={`card ${styles.logCard}`}>
          {logs.length > 0 ? (
            logs.map((log, index) => <LogRow key={`${log.container}-${log.timestamp}-${index}`} log={log} />)
          ) : (
            <div className={styles.emptyState}>No logs reported for this service.</div>
          )}
        </div>
      </section>

      <div className={styles.opsGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Hot Containers</h2>
            <span>Sorted by current CPU</span>
          </div>
          <div className={`card ${styles.workloadCard}`}>
            <div className={styles.workloadHeader}>
              <span>Container</span>
              <span>CPU</span>
              <span>Memory</span>
              <span>Mem %</span>
            </div>
            {hotContainers.length > 0 ? (
              hotContainers.map((container) => <WorkloadRow key={container.name} container={container} />)
            ) : (
              <div className={styles.emptyState}>No running containers reported.</div>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>One-Project GitNexus Run</h2>
            <span>{activeJobs.length > 0 ? 'Waiting for current job' : 'Ready'}</span>
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
                {isStarting ? 'Queueing...' : 'Analyze'}
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
                  label="Mem9"
                  value={selectedProject.latestIndexJob?.mem9Status ?? 'unknown'}
                  tone={selectedProject.latestIndexJob?.mem9Status === 'done' ? 'healthy' : 'warning'}
                />
                <Signal
                  label="Graph"
                  value={graphRelationships > 0 ? `${graphRelationships} edges` : 'no edges'}
                  tone={graphRelationships > 0 ? 'healthy' : 'warning'}
                />
              </div>
            ) : (
              <div className={styles.emptyState}>No indexable Cortex projects reported.</div>
            )}
          </div>
        </section>
      </div>

      <div className={styles.opsGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Indexing Pipeline</h2>
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
            <h2>MCP/API Activity</h2>
            <span>{activity.length} events</span>
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
      </div>
    </DashboardLayout>
  )
}
