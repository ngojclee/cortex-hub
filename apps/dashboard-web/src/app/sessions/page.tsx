'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

import DashboardLayout from '@/components/layout/DashboardLayout'
import {
  getAuthConfig,
  getAuthSessions,
  getSessions,
  revokeAllSessions,
  revokeSession,
  type SessionHandoff,
} from '@/lib/api'
import styles from './Sessions.module.css'

type ConnectionInfo = {
  transport: string
  clientApp: string
  clientHost: string
  clientUserAgent: string
  clientIp: string
  repo: string
  mode: string
  projectId: string
  resourceUris: string[]
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => asText(item))
    .filter((item): item is string => Boolean(item))
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value?.trim()) return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function inferClientApp(
  session: SessionHandoff,
  transport: string,
  userAgent: string,
): string {
  const haystack = [
    session.from_agent,
    session.api_key_name ?? '',
    userAgent,
  ].join(' ').toLowerCase()

  const inferred = [
    ['antigravity', 'Antigravity'],
    ['claude', 'Claude'],
    ['codex', 'Codex'],
    ['cursor', 'Cursor'],
    ['windsurf', 'Windsurf'],
    ['gemini', 'Gemini'],
  ] as Array<[string, string]>
  const match = inferred.find(([needle]) => haystack.includes(needle))

  if (match) return match[1]
  if (transport === 'dashboard') return 'Dashboard'
  if (transport === 'mcp') return 'MCP Client'
  return session.api_key_name ?? session.from_agent
}

function deriveConnection(session: SessionHandoff): ConnectionInfo {
  const context = parseJsonObject(session.context)
  const sharedMetadata = session.sharedMetadata && typeof session.sharedMetadata === 'object'
    ? session.sharedMetadata as Record<string, unknown>
    : null
  const sharedConnection = sharedMetadata?.connection && typeof sharedMetadata.connection === 'object'
    ? sharedMetadata.connection as Record<string, unknown>
    : null
  const contextConnection = context?.connection && typeof context.connection === 'object'
    ? context.connection as Record<string, unknown>
    : null

  const transport =
    asText(session.connection?.transport) ??
    asText(sharedConnection?.transport) ??
    asText(contextConnection?.transport) ??
    (session.api_key_name ? 'mcp' : 'api')

  const clientUserAgent =
    asText(session.connection?.clientUserAgent) ??
    asText(sharedConnection?.clientUserAgent) ??
    asText(contextConnection?.clientUserAgent) ??
    'Unknown'
  const primaryResourceUris = asStringArray(sharedMetadata?.resourceUris)

  return {
    transport,
    clientApp:
      asText(session.connection?.clientApp) ??
      asText(sharedConnection?.clientApp) ??
      asText(contextConnection?.clientApp) ??
      inferClientApp(session, transport, clientUserAgent),
    clientHost:
      asText(session.connection?.clientHost) ??
      asText(sharedConnection?.clientHost) ??
      asText(contextConnection?.clientHost) ??
      'Unknown',
    clientUserAgent,
    clientIp:
      asText(session.connection?.clientIp) ??
      asText(sharedConnection?.clientIp) ??
      asText(contextConnection?.clientIp) ??
      'Unknown',
    repo: asText(context?.repo) ?? session.project,
    mode: asText(session.mode) ?? asText(context?.mode) ?? 'development',
    projectId:
      asText(sharedMetadata?.projectId) ??
      asText(sharedMetadata?.project_id) ??
      asText(context?.projectId) ??
      'Unknown',
    resourceUris: primaryResourceUris.length > 0
      ? primaryResourceUris
      : asStringArray(sharedMetadata?.resource_uris),
  }
}

function statusTone(status: string): 'active' | 'completed' | 'warning' {
  if (status === 'active') return 'active'
  if (status === 'completed') return 'completed'
  return 'warning'
}

function transportLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

export default function SessionsPage() {
  const [search, setSearch] = useState('')
  const [isRevoking, setIsRevoking] = useState<string | null>(null)
  const [isRevokingAll, setIsRevokingAll] = useState(false)

  const { data: authConfig } = useSWR(
    'sessions-auth-config',
    getAuthConfig,
    { refreshInterval: 30000 },
  )
  const authEnabled = authConfig?.enabled ?? false

  const { data: authData, error: authError, mutate: mutateAuth, isLoading: authLoading } = useSWR(
    authEnabled ? 'sessions-auth-logins' : null,
    getAuthSessions,
    { refreshInterval: 10000 },
  )
  const { data: connectionData, error: connectionError, isLoading: connectionLoading } = useSWR(
    'sessions-connections',
    () => getSessions(100),
    { refreshInterval: 10000 },
  )

  const authSessions = authData?.sessions ?? []
  const connectionSessions = connectionData?.sessions ?? []
  const activeConnections = connectionSessions.filter((session) => session.status === 'active')

  const filteredAuthSessions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return authSessions

    return authSessions.filter((session) => {
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
  }, [authSessions, search])

  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return connectionSessions

    return connectionSessions.filter((session) => {
      const connection = deriveConnection(session)
      const haystack = [
        session.from_agent,
        session.api_key_name ?? '',
        session.project,
        session.task_summary,
        connection.transport,
        connection.clientApp,
        connection.clientHost,
        connection.clientIp,
        connection.clientUserAgent,
        connection.mode,
        connection.projectId,
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [connectionSessions, search])

  const uniqueClientCount = useMemo(() => {
    const unique = new Set(
      connectionSessions.map((session) => {
        const connection = deriveConnection(session)
        return `${connection.clientApp}|${connection.clientHost}|${connection.transport}`
      }),
    )

    return unique.size
  }, [connectionSessions])

  const handleRevoke = useCallback(async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to revoke the session for ${email}? They will be logged out immediately.`)) return

    setIsRevoking(id)
    try {
      await revokeSession(id)
      await mutateAuth()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setIsRevoking(null)
    }
  }, [mutateAuth])

  const handleRevokeAll = useCallback(async () => {
    if (!confirm('DANGER: Are you sure you want to revoke ALL active login sessions? Everyone using dashboard auth will be logged out.')) return

    setIsRevokingAll(true)
    try {
      await revokeAllSessions()
      await mutateAuth()
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke sessions')
    } finally {
      setIsRevokingAll(false)
    }
  }, [mutateAuth])

  return (
    <DashboardLayout
      title="Sessions"
      subtitle="Track user logins alongside live agent, API, and MCP connections"
    >
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{authEnabled ? authSessions.length : 'Off'}</span>
          <span className={styles.statLabel}>User Login Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{activeConnections.length}</span>
          <span className={styles.statLabel}>Active Agent Connections</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{connectionSessions.length}</span>
          <span className={styles.statLabel}>Tracked Agent Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{uniqueClientCount}</span>
          <span className={styles.statLabel}>Known Client Sources</span>
        </div>
      </div>

      {!authEnabled && (
        <div className={styles.infoBanner}>
          Dashboard auth is disabled on this runtime. Login/logout routes exist, but `AUTH_ENABLED` is currently false in the live container, so only agent/API/MCP connections will show activity below.
        </div>
      )}

      <div className={styles.actionBar}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Search email, IP, app, machine, project, or agent..."
            className={styles.searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <button
          className={styles.revokeAllBtn}
          onClick={handleRevokeAll}
          disabled={!authEnabled || isRevokingAll || authSessions.length === 0}
        >
          {isRevokingAll ? 'Revoking...' : '⚠ Revoke All Logins'}
        </button>
      </div>

      {(authError || connectionError) && (
        <div className={styles.errorBanner}>
          Failed to load sessions:
          {' '}
          {authError?.message ?? connectionError?.message}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>User Login Sessions</h2>
            <p className={styles.sectionText}>
              Dashboard auth sessions created through the email approval flow.
            </p>
          </div>
          <span className={styles.sectionCount}>{filteredAuthSessions.length}</span>
        </div>

        {!authEnabled ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔐</div>
            <h3>Auth is disabled</h3>
            <p>Enable `AUTH_ENABLED=true` in the Docker runtime if you want login/logout to actually guard the dashboard.</p>
          </div>
        ) : authLoading && !authData ? (
          <div className={styles.loadingState}>Loading user login sessions...</div>
        ) : filteredAuthSessions.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔐</div>
            <h3>No user login sessions</h3>
            <p>{search ? 'No login sessions match your search.' : 'No approved dashboard login sessions are active right now.'}</p>
          </div>
        ) : (
          <div className={styles.sessionList}>
            {filteredAuthSessions.map((session) => (
              <article key={session.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={styles.email}>{session.email}</span>
                    <span className={styles.date}>Started: {formatDate(session.created_at)}</span>
                  </div>
                  <div className={`${styles.statusTag} ${styles.activeTag}`}>Active</div>
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
                    title="Revoke access for this login session"
                  >
                    <span className={styles.deleteIcon}>⛔</span>
                    Revoke Session
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Agent / API / MCP Connections</h2>
            <p className={styles.sectionText}>
              Live and recent work sessions created through `cortex_session_start` or direct session APIs.
            </p>
          </div>
          <span className={styles.sectionCount}>{filteredConnections.length}</span>
        </div>

        {connectionLoading && !connectionData ? (
          <div className={styles.loadingState}>Loading agent/API/MCP sessions...</div>
        ) : filteredConnections.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>⇄</div>
            <h3>No tracked agent connections</h3>
            <p>{search ? 'No agent/API/MCP sessions match your search.' : 'No agent/API/MCP sessions have been recorded yet.'}</p>
          </div>
        ) : (
          <div className={styles.sessionList}>
            {filteredConnections.map((session) => {
              const connection = deriveConnection(session)
              const tone = statusTone(session.status)

              return (
                <article key={session.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.connectionHeadline}>
                      <span className={styles.email}>{session.from_agent}</span>
                      <span className={styles.date}>
                        {session.status === 'active' ? 'Active since' : 'Last updated'}: {formatDate(session.created_at)}
                      </span>
                    </div>
                    <div className={styles.badgeRow}>
                      <div className={`${styles.statusTag} ${styles[`${tone}Tag`]}`}>{session.status}</div>
                      <div className={styles.transportTag}>{transportLabel(connection.transport)}</div>
                    </div>
                  </div>

                  <p className={styles.summary}>{session.task_summary}</p>

                  <div className={styles.metaGrid}>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Project</span>
                      <span className={styles.metaValue}>{session.project}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Mode</span>
                      <span className={styles.metaValue}>{connection.mode}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Client App</span>
                      <span className={styles.metaValue}>{connection.clientApp}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Machine / Host</span>
                      <span className={styles.metaValue}>{connection.clientHost}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>IP Address</span>
                      <span className={styles.metaValue}>{connection.clientIp}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>API Key Owner</span>
                      <span className={styles.metaValue}>{session.api_key_name ?? 'Unknown'}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Project ID</span>
                      <span className={styles.metaValue}>{connection.projectId}</span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Resources</span>
                      <span className={styles.metaValue}>
                        {connection.resourceUris.length > 0 ? `${connection.resourceUris.length} linked` : 'None'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.longMeta}>
                    <span className={styles.metaLabel}>User Agent</span>
                    <span className={styles.metaValue}>{connection.clientUserAgent}</span>
                  </div>

                  {connection.resourceUris.length > 0 && (
                    <div className={styles.uriRow}>
                      {connection.resourceUris.map((uri) => (
                        <span key={uri} className={styles.uriChip}>{uri}</span>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
