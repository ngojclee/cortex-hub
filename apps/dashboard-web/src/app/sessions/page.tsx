'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { getSessions, type SessionHandoff } from '@/lib/api'
import styles from './page.module.css'

function PriorityBadge({ priority }: { priority: number }) {
  const label = priority <= 3 ? 'high' : priority <= 6 ? 'medium' : 'low'
  const variant = priority <= 3 ? 'error' : priority <= 6 ? 'warning' : 'healthy'
  return <span className={`badge badge-${variant}`}>{label} ({priority})</span>
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'completed' ? 'healthy'
    : status === 'claimed' ? 'warning'
    : status === 'pending' ? 'warning'
    : 'error'
  return <span className={`badge badge-${variant}`}>{status}</span>
}

function SessionCard({ session }: { session: SessionHandoff }) {
  return (
    <div className={`card ${styles.sessionCard}`}>
      <div className={styles.sessionHeader}>
        <code className={styles.sessionId}>{session.id}</code>
        <StatusBadge status={session.status} />
      </div>

      <p className={styles.taskSummary}>{session.task_summary}</p>

      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Project</span>
          <span className={styles.metaValue}>{session.project}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>From</span>
          <code className={styles.agentName}>{session.from_agent}</code>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>To</span>
          <code className={styles.agentName}>{session.to_agent ?? '—'}</code>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Priority</span>
          <PriorityBadge priority={session.priority} />
        </div>
      </div>

      <div className={styles.sessionFooter}>
        <span className={styles.timestamp}>
          {session.created_at ? new Date(session.created_at).toLocaleString() : '—'}
        </span>
        {session.claimed_by && (
          <span className={styles.claimedBy}>
            Claimed by <code>{session.claimed_by}</code>
          </span>
        )}
      </div>
    </div>
  )
}

export default function SessionsPage() {
  const { data, error, isLoading, mutate } = useSWR('sessions', () => getSessions(50), {
    refreshInterval: 15000,
  })

  const sessions = data?.sessions ?? []
  const pendingCount = sessions.filter((s) => s.status === 'pending').length
  const claimedCount = sessions.filter((s) => s.status === 'claimed').length
  const completedCount = sessions.filter((s) => s.status === 'completed').length

  return (
    <DashboardLayout title="Sessions" subtitle="Agent task handoffs and execution tracking">
      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>📋</span>
          <div>
            <div className={styles.statValue}>{sessions.length}</div>
            <div className={styles.statLabel}>Total Sessions</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>⏳</span>
          <div>
            <div className={styles.statValue}>{pendingCount}</div>
            <div className={styles.statLabel}>Pending</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>🔄</span>
          <div>
            <div className={styles.statValue}>{claimedCount}</div>
            <div className={styles.statLabel}>In Progress</div>
          </div>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statIcon}>✅</span>
          <div>
            <div className={styles.statValue}>{completedCount}</div>
            <div className={styles.statLabel}>Completed</div>
          </div>
        </div>
      </div>

      {/* Sessions List */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Session Handoffs</h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => mutate()}
            disabled={isLoading}
          >
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            ⚠️ Failed to load sessions
          </div>
        )}

        {sessions.length === 0 && !isLoading ? (
          <div className={`card ${styles.emptyState}`}>
            <span className={styles.emptyIcon}>⇄</span>
            <p>No session handoffs yet.</p>
            <p className={styles.emptyHint}>
              Sessions appear when agents start tasks via the <code>cortex.session.start</code> MCP tool.
            </p>
          </div>
        ) : (
          <div className={styles.sessionsGrid}>
            {sessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
