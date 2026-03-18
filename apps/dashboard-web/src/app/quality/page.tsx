'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { getQualityLogs, type QueryLog } from '@/lib/api'
import styles from './page.module.css'

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ok' ? 'healthy' : status === 'error' ? 'error' : 'warning'
  return <span className={`badge badge-${variant}`}>{status}</span>
}

function parseParams(params: string | null): { score?: number; details?: string } {
  if (!params) return {}
  try { return JSON.parse(params) } catch { return {} }
}

function LogRow({ log }: { log: QueryLog }) {
  const parsed = parseParams(log.params)
  return (
    <tr>
      <td className={styles.cellMono}>{log.agent_id}</td>
      <td>
        <code className={styles.toolName}>{log.tool}</code>
      </td>
      <td className={styles.cellCenter}>
        {parsed.score != null ? (
          <span className={styles.score}>{parsed.score}/100</span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.cellCenter}>
        {log.latency_ms != null ? (
          <span>{log.latency_ms}ms</span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.cellCenter}>
        <StatusBadge status={log.status} />
      </td>
      <td className={styles.cellMuted}>
        {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
      </td>
    </tr>
  )
}

export default function QualityPage() {
  const { data, error, isLoading, mutate } = useSWR('quality-logs', () => getQualityLogs(100), {
    refreshInterval: 15000,
  })

  const logs = data?.logs ?? []

  const totalLogs = logs.length
  const okCount = logs.filter((l) => l.status === 'ok').length
  const errorCount = logs.filter((l) => l.status === 'error').length
  const successRate = totalLogs > 0 ? Math.round((okCount / totalLogs) * 100) : 0

  return (
    <DashboardLayout title="Quality Gates" subtitle="Agent execution logs and quality metrics">
      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>📊</span>
          <div>
            <div className={styles.statValue}>{totalLogs}</div>
            <div className={styles.statLabel}>Total Executions</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>✅</span>
          <div>
            <div className={styles.statValue}>{okCount}</div>
            <div className={styles.statLabel}>Passed</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>❌</span>
          <div>
            <div className={styles.statValue}>{errorCount}</div>
            <div className={styles.statLabel}>Failed</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>⚡</span>
          <div>
            <div className={styles.statValue}>{successRate}%</div>
            <div className={styles.statLabel}>Success Rate</div>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Execution Log</h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => mutate()}
            disabled={isLoading}
          >
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className={styles.tableCard}>
          {error && (
            <div className={styles.errorBanner}>
              ⚠️ Failed to load quality logs
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Tool / Gate</th>
                <th className={styles.cellCenter}>Score</th>
                <th className={styles.cellCenter}>Latency</th>
                <th className={styles.cellCenter}>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
              {logs.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>
                    No quality logs yet. Logs appear when agents report quality gate results via MCP.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
