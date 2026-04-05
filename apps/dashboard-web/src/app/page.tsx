'use client'

import Link from 'next/link'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  checkHealth,
  getDashboardOverview,
  getActivityFeed,
  getSystemMetrics,
  type ActivityEvent,
  type SystemMetrics,
} from '@/lib/api'
import { config } from '@/lib/config'
import styles from './page.module.css'

// ── Utilities ──

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Stat Pill ──

function StatPill({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className={styles.statPill}>
      <span className={styles.statPillIcon}>{icon}</span>
      <div className={styles.statPillContent}>
        <span className={styles.statPillValue}>{value}</span>
        <span className={styles.statPillLabel}>{label}</span>
      </div>
    </div>
  )
}

// ── Activity Row ──

function ActivityRow({ event }: { event: ActivityEvent }) {
  const icon = event.type === 'query' ? '🔍' : '📋'
  const statusClass = event.status === 'ok' || event.status === 'completed' ? 'healthy' : event.status === 'error' ? 'error' : 'warning'
  return (
    <div className={styles.activityRow}>
      <span className={styles.activityIcon}>{icon}</span>
      <div className={styles.activityInfo}>
        <span className={styles.activityDetail}>{event.detail}</span>
        <span className={styles.activityMeta}>
          {event.agent_id}
          {event.latency_ms ? ` · ${event.latency_ms}ms` : ''}
        </span>
      </div>
      <div className={styles.activityRight}>
        <span className={`badge badge-${statusClass}`}>{event.status}</span>
        <span className={styles.activityTime}>{timeAgo(event.created_at)}</span>
      </div>
    </div>
  )
}

// ── Gauge Chart ──

function GaugeChart({ value, label, subtitle, color, icon }: {
  value: number; label: string; subtitle: string; color: string; icon: string
}) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  const statusColor = value > 90 ? '#e74c3c' : value > 70 ? '#f5a623' : color

  return (
    <div className={styles.gaugeCard}>
      <div className={styles.gaugeContainer}>
        <svg viewBox="0 0 100 100" className={styles.gaugeSvg}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--border)" strokeWidth="6" opacity="0.3" />
          <circle
            cx="50" cy="50" r={radius} fill="none" stroke={statusColor} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 50 50)" className={styles.gaugeRing}
            style={{ filter: `drop-shadow(0 0 6px ${statusColor}40)` }}
          />
        </svg>
        <div className={styles.gaugeCenter}>
          <span className={styles.gaugeIcon}>{icon}</span>
          <span className={styles.gaugeValue}>{value}%</span>
        </div>
      </div>
      <div className={styles.gaugeLabel}>{label}</div>
      <div className={styles.gaugeSub}>{subtitle}</div>
    </div>
  )
}

// ── Container Row ──

function ContainerRow({ container }: { container: SystemMetrics['containers'][0] }) {
  const isRunning = container.status === 'running'
  const statusClass = isRunning ? 'healthy' : container.status === 'exited' ? 'error' : 'warning'
  return (
    <div className={styles.containerRow}>
      <div className={styles.containerInfo}>
        <span className={`status-dot ${statusClass}`} />
        <span className={styles.containerName}>{container.name.replace('cortex-', '')}</span>
      </div>
      <span className={styles.containerCpu}>{isRunning ? container.cpu : '—'}</span>
      <span className={styles.containerMem}>{isRunning ? container.memory : '—'}</span>
      <span className={styles.containerUptime}>{container.uptime}</span>
    </div>
  )
}

// ── Service Mini Card ──

function ServiceMini({ name, status }: { name: string; status: string }) {
  const cls = status === 'ok' ? 'healthy' : status === 'error' ? 'error' : 'warning'
  return (
    <div className={styles.serviceMini}>
      <span className={`status-dot ${cls}`} />
      <span className={styles.serviceMiniName}>{name}</span>
    </div>
  )
}

// ══════════════════════════════════════════════
//  Main Dashboard
// ══════════════════════════════════════════════

export default function DashboardPage() {
  const { data: healthData, error: healthError, mutate, isLoading } = useSWR('health', checkHealth, {
    refreshInterval: 30000,
  })
  const { data: overview } = useSWR('dashboard-overview', getDashboardOverview, {
    refreshInterval: 15000,
  })
  const { data: activityData } = useSWR('activity', () => getActivityFeed(15), {
    refreshInterval: 15000,
  })
  const { data: systemData } = useSWR('system-metrics', getSystemMetrics, {
    refreshInterval: 5000,
  })

  const svcMap = healthData?.services as Record<string, string> | undefined
  const mcpConfigSnippet = `{
  "mcpServers": {
    "cortex-hub": {
      "url": "${config.mcp.endpoint}",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}`
  const hasQualityReports = overview?.quality.lastGrade && overview.quality.lastGrade !== 'N/A'

  return (
    <DashboardLayout title="Dashboard" subtitle="System overview and project health">

      {/* ── Hero Stats Bar ── */}
      <div className={styles.heroBar}>
        <StatPill icon="📁" value={overview ? String(overview.projects.length) : '...'} label="Projects" />
        <StatPill icon="🤖" value={overview ? formatNumber(overview.totalAgents) : '...'} label="Agents" />
        <StatPill icon="📊" value={overview ? formatNumber(overview.today.queries) : '...'} label="Queries Today" />
        <StatPill icon="💎" value={overview ? formatNumber(overview.tokenSavings?.totalTokensSaved ?? 0) : '...'} label="Tokens Saved" />
        <StatPill icon="🏆" value={overview?.quality.lastGrade ?? '...'} label="Quality" />
        <StatPill icon="⚡" value={overview ? `${Math.floor(overview.uptime / 3600)}h` : '...'} label="Uptime" />
      </div>

      {/* ── Services Health Strip ── */}
      <div className={styles.servicesStrip}>
        <div className={styles.servicesStripLeft}>
          <h3 className={styles.stripTitle}>Services</h3>
          <div className={styles.servicesInline}>
            {['qdrant', 'cliproxy', 'gitnexus', 'mem9', 'mcp'].map((svc) => (
              <ServiceMini key={svc} name={svc} status={svcMap?.[svc] ?? (isLoading ? 'loading' : healthError ? 'error' : 'unknown')} />
            ))}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => mutate()} disabled={isLoading}>
          {isLoading ? 'Checking...' : 'Refresh'}
        </button>
      </div>


      {/* ── Two Column: System Resources + Quality/Knowledge ── */}
      <div className={styles.twoColumn}>

        {/* Left: System Resources */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>System Resources</h2>
            {systemData && (
              <span className={styles.serverTag}>
                🖥️ {systemData.hostname} · {systemData.cpu.cores} cores
              </span>
            )}
          </div>
          <div className={styles.gaugesGrid}>
            <GaugeChart
              value={systemData?.cpu.percent ?? 0} label="CPU"
              subtitle={systemData ? `Load: ${systemData.cpu.loadAvg.join(' / ')}` : '...'}
              color="#4a90d9" icon="⚡"
            />
            <GaugeChart
              value={systemData?.memory.percent ?? 0} label="Memory"
              subtitle={systemData ? `${systemData.memory.usedHuman} / ${systemData.memory.totalHuman}` : '...'}
              color="#9b59b6" icon="🧠"
            />
            <GaugeChart
              value={systemData?.disk[0]?.usedPercent ?? 0} label="Disk"
              subtitle={systemData?.disk[0] ? `${systemData.disk[0].used} / ${systemData.disk[0].size}` : '...'}
              color="#27ae60" icon="💾"
            />
          </div>
          {/* Docker Containers */}
          {systemData?.containers && systemData.containers.length > 0 && (
            <div className={`card ${styles.containersCard}`}>
              <div className={styles.containersHeader}>
                <span>Container</span><span>CPU</span><span>Memory</span><span>Status</span>
              </div>
              {systemData.containers.map((c) => (
                <ContainerRow key={c.name} container={c} />
              ))}
            </div>
          )}

          {/* Cortex Savings */}
          <div style={{ marginTop: 'var(--space-8)' }}>
            <h2 className={styles.sectionTitle} style={{ marginBottom: 'var(--space-4)' }}>Cortex Savings</h2>
            <div className={`card ${styles.intelCard}`}>
              <div className={styles.intelHeader}>
                <span>💎 Token Analytics</span>
                <Link href="/usage" className={styles.intelLink}>View →</Link>
              </div>
              <div className={styles.intelGrid}>
                <div className={styles.intelStat}>
                  <span className={styles.intelValue} style={{ color: '#22c55e' }}>
                    {formatNumber(overview?.tokenSavings?.totalTokensSaved ?? 0)}
                  </span>
                  <span className={styles.intelLabel}>Tokens Saved</span>
                </div>
                <div className={styles.intelStat}>
                  <span className={styles.intelValue}>{formatNumber(overview?.tokenSavings?.totalToolCalls ?? 0)}</span>
                  <span className={styles.intelLabel}>Tool Calls</span>
                </div>
                <div className={styles.intelStat}>
                  <span className={styles.intelValue}>{overview?.tokenSavings?.avgTokensPerCall ?? 0}</span>
                  <span className={styles.intelLabel}>Avg/Call</span>
                </div>
              </div>
              {overview?.tokenSavings?.topTools && overview.tokenSavings.topTools.length > 0 && (
                <div className={styles.topToolsList}>
                  {overview.tokenSavings.topTools.slice(0, 3).map((t) => (
                    <div key={t.tool} className={styles.topToolRow}>
                      <code className={styles.topToolName}>{t.tool.replace('cortex_', '')}</code>
                      <span className={styles.topToolValue}>{formatNumber(t.tokensSaved)} tokens</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right: Quick Stats */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Intelligence</h2>

          {/* Quality */}
          <div className={`card ${styles.intelCard}`}>
            <div className={styles.intelHeader}>
              <span>🏆 Quality Gates</span>
              <Link href="/quality" className={styles.intelLink}>View →</Link>
            </div>
            <div className={styles.intelGrid}>
              <div className={styles.intelStat}>
                <span className={styles.intelValue} style={{ color: overview?.quality.lastGrade === 'A' ? '#22c55e' : overview?.quality.lastGrade === 'F' ? '#ef4444' : '#eab308' }}>
                  {overview?.quality.lastGrade ?? '—'}
                </span>
                <span className={styles.intelLabel}>Last Grade</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.quality.averageScore ?? '—'}</span>
                <span className={styles.intelLabel}>Avg Score</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.quality.reportsToday ?? 0}</span>
                <span className={styles.intelLabel}>Today</span>
              </div>
            </div>
            {!hasQualityReports && (
              <div className={styles.intelHint}>
                No quality reports yet. Agents need to submit <code>cortex_quality_report</code> before this card can score anything.
              </div>
            )}
          </div>

          {/* Knowledge */}
          <div className={`card ${styles.intelCard}`}>
            <div className={styles.intelHeader}>
              <span>📚 Knowledge Base</span>
              <Link href="/knowledge" className={styles.intelLink}>View →</Link>
            </div>
            <div className={styles.intelGrid}>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.knowledge.totalDocs ?? 0}</span>
                <span className={styles.intelLabel}>Documents</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{formatNumber(overview?.knowledge.totalChunks ?? 0)}</span>
                <span className={styles.intelLabel}>Chunks</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{formatNumber(overview?.knowledge.totalHits ?? 0)}</span>
                <span className={styles.intelLabel}>Hits</span>
              </div>
            </div>
          </div>

          {/* Sessions + Keys */}
          <div className={`card ${styles.intelCard}`}>
            <div className={styles.intelHeader}><span>🔑 Platform</span></div>
            <div className={styles.intelGrid}>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.activeKeys ?? '—'}</span>
                <span className={styles.intelLabel}>API Keys</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.totalSessions ?? '—'}</span>
                <span className={styles.intelLabel}>Sessions</span>
              </div>
              <div className={styles.intelStat}>
                <span className={styles.intelValue}>{overview?.organizations ?? '—'}</span>
                <span className={styles.intelLabel}>Orgs</span>
              </div>
            </div>
          </div>

        </section>
      </div>

      {/* ── Activity Feed ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Activity</h2>
          <Link href="/sessions" className="btn btn-secondary btn-sm">All Sessions →</Link>
        </div>
        <div className={`card ${styles.activityCard}`}>
          {activityData?.activity && activityData.activity.length > 0 ? (
            <div className={styles.activityList}>
              {activityData.activity.map((event, i) => (
                <ActivityRow key={`${event.created_at}-${i}`} event={event} />
              ))}
            </div>
          ) : (
            <div className={styles.emptyActivity}>
              <span>📭</span>
              <p>No activity yet. Events appear when agents make API calls.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Quick Connect ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick Connect</h2>
        <div className={`card ${styles.connectCard}`}>
          <p className={styles.connectText}>
            Add Cortex Hub to your AI agent&apos;s MCP config:
          </p>
          <pre className={styles.codeBlock}>
{mcpConfigSnippet}
          </pre>
          <a href="/keys" className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-4)', display: 'inline-flex' }}>
            Generate API Key →
          </a>
        </div>
      </section>
    </DashboardLayout>
  )
}
