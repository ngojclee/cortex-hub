'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { getAuthSessions, revokeSession, revokeAllSessions } from '@/lib/api'
import styles from './Sessions.module.css'

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

export default function SessionsPage() {
  const [search, setSearch] = useState('')
  const [isRevoking, setIsRevoking] = useState<string | null>(null)
  const [isRevokingAll, setIsRevokingAll] = useState(false)

  const { data, error, mutate, isLoading } = useSWR(
    'sessions',
    getAuthSessions,
    { refreshInterval: 10000 },
  )

  const sessions = data?.sessions ?? []

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sessions

    return sessions.filter((session) => {
      const haystack = [
        session.email,
        session.ip_address,
        session.user_agent,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [sessions, search])

  const handleRevoke = useCallback(async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to revoke the session for ${email}? They will be logged out immediately.`)) return

    setIsRevoking(id)
    try {
      await revokeSession(id)
      await mutate()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setIsRevoking(null)
    }
  }, [mutate])

  const handleRevokeAll = useCallback(async () => {
    if (!confirm('DANGER: Are you sure you want to revoke ALL active sessions? Everyone (including you) will be logged out!')) return

    setIsRevokingAll(true)
    try {
      await revokeAllSessions()
      await mutate()
      // Current user is also revoked, force a reload to trigger login prompt
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke sessions')
    } finally {
      setIsRevokingAll(false)
    }
  }, [mutate])

  return (
    <DashboardLayout
      title="Active Sessions"
      subtitle="Manage user access and connected devices for Cortex Hub"
    >
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{sessions.length}</span>
          <span className={styles.statLabel}>Active Sessions</span>
        </div>
      </div>

      <div className={styles.actionBar}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Search email, IP address, user agent..."
            className={styles.searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        
        <button 
          className={styles.revokeAllBtn}
          onClick={handleRevokeAll}
          disabled={isRevokingAll || sessions.length === 0}
        >
          {isRevokingAll ? 'Revoking...' : '⚠ Revoke All Sessions'}
        </button>
      </div>

      {error ? (
        <div className="panel error">
          Failed to load sessions: {error.message}
        </div>
      ) : isLoading && !data ? (
        <div className="panel">
          <div className="loading-spinner"></div>
          <p style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--text-dim)' }}>
            Loading sessions...
          </p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔐</div>
          <h3>No Active Sessions</h3>
          <p>
            {search ? 'No sessions match your search.' : 'There are currently no active user sessions.'}
          </p>
        </div>
      ) : (
        <div className={styles.sessionList}>
          {filteredSessions.map((session) => (
            <article key={session.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <span className={styles.email}>{session.email}</span>
                  <span className={styles.date}>Started: {formatDate(session.created_at)}</span>
                </div>
                <div className={styles.statusTag}>Active</div>
              </div>

              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>IP Address</span>
                  <span className={styles.metaValue}>{session.ip_address}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Device / Browser</span>
                  <span className={styles.metaValue}>{session.user_agent}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Session ID</span>
                  <span className={styles.metaValue}>{session.id.slice(0, 8)}...</span>
                </div>
              </div>

              <div className={styles.cardFooter}>
                <button
                  className={`${styles.revokeBtn} ${isRevoking === session.id ? styles.revoking : ''}`}
                  onClick={() => handleRevoke(session.id, session.email)}
                  disabled={isRevoking === session.id}
                  title="Revoke access for this device"
                >
                  <span className={styles.deleteIcon}>⛔</span>
                  Revoke Session
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
