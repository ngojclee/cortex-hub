'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { getSystemMetrics, type SystemMetrics } from '@/lib/api'
import styles from './page.module.css'

type Container = SystemMetrics['containers'][number]
type IndexJob = SystemMetrics['indexJobs'][number]

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
  if (status === 'done' || status === 'running') return 'healthy'
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

export default function OpsPage() {
  const { data, error, isLoading, mutate } = useSWR('ops-system-metrics', getSystemMetrics, {
    refreshInterval: 5000,
  })

  const containers = data?.containers ?? []
  const jobs = data?.indexJobs ?? []
  const activeJobs = jobs.filter((job) => job.active)
  const topCpu = containers[0]
  const topMemory = [...containers].sort((a, b) => b.memoryRaw - a.memoryRaw)[0]

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
    </DashboardLayout>
  )
}