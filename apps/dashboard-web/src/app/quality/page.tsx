'use client'

import { startTransition, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getAllProjects,
  getQualityReports,
  getQualityTrends,
  getQualitySummary,
  getQualityLogs,
  submitQualityReport,
  type Project,
  type QualityDimensionScores,
  type QualityReportRow,
  type QualityTrendData,
  type QueryLog,
} from '@/lib/api'
import styles from './page.module.css'

// ── Grade Utilities ──
const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#3b82f6',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
}

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? '#6b7280'
}

function gradeAction(grade: string): string {
  const actions: Record<string, string> = {
    A: 'Proceed immediately',
    B: 'Proceed with minor warnings',
    C: 'Proceed but flag at next gate',
    D: 'Pause — show report, ask user',
    F: 'Stop — must remediate',
  }
  return actions[grade] ?? ''
}

// ── Components ──

function GradeBadge({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' | 'hero' }) {
  return (
    <span
      className={`${styles.gradeBadge} ${styles[`grade${size.charAt(0).toUpperCase() + size.slice(1)}`]}`}
      style={{ '--grade-color': gradeColor(grade) } as React.CSSProperties}
    >
      {grade}
    </span>
  )
}

function ScoreRing({ score, label, max = 25 }: { score: number; label: string; max?: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0
  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#3b82f6' : pct >= 50 ? '#eab308' : '#ef4444'

  return (
    <div className={styles.scoreRing}>
      <div className={styles.ringTrack}>
        <div
          className={styles.ringFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className={styles.ringInfo}>
        <span className={styles.ringScore} style={{ color }}>{score}</span>
        <span className={styles.ringMax}>/{max}</span>
      </div>
      <span className={styles.ringLabel}>{label}</span>
    </div>
  )
}

function TrendChart({ data }: { data: QualityTrendData[] }) {
  if (data.length === 0) {
    return <div className={styles.emptyTrend}>No trend data yet. Reports will appear after quality checks.</div>
  }

  const maxScore = 100
  const chartHeight = 120

  return (
    <div className={styles.trendChart}>
      <div className={styles.trendBars}>
        {data.map((point) => {
          const height = (point.avg_score / maxScore) * chartHeight
          const grade = scoreToGradeLocal(point.avg_score)
          return (
            <div key={point.date} className={styles.trendBar} title={`${point.date}: ${point.avg_score}/100 (${grade})`}>
              <div className={styles.trendBarStack}>
                <div
                  className={styles.trendBarFill}
                  style={{ height: `${height}px`, background: gradeColor(grade) }}
                />
              </div>
              <span className={styles.trendDate}>{point.date.slice(5)}</span>
              <span className={styles.trendScore}>{Math.round(point.avg_score)}</span>
            </div>
          )
        })}
      </div>
      <div className={styles.trendLegend}>
        <span className={styles.trendLegendItem}>
          <span className={styles.trendDot} style={{ background: '#22c55e' }} /> A (90+)
        </span>
        <span className={styles.trendLegendItem}>
          <span className={styles.trendDot} style={{ background: '#3b82f6' }} /> B (80+)
        </span>
        <span className={styles.trendLegendItem}>
          <span className={styles.trendDot} style={{ background: '#eab308' }} /> C (70+)
        </span>
        <span className={styles.trendLegendItem}>
          <span className={styles.trendDot} style={{ background: '#f97316' }} /> D (60+)
        </span>
        <span className={styles.trendLegendItem}>
          <span className={styles.trendDot} style={{ background: '#ef4444' }} /> F (&lt;60)
        </span>
      </div>
    </div>
  )
}

function DimensionBreakdown({ data }: { data: QualityTrendData[] }) {
  if (data.length === 0) return null

  const latest = data[data.length - 1]
  if (!latest) return null
  return (
    <div className={styles.dimensionGrid}>
      <div className={styles.dimRow}>
        <span className={styles.dimLabel}>Build</span>
        <div className={styles.dimTrack}>
          <div className={styles.dimFill} style={{ width: `${(latest.avg_build / 25) * 100}%`, background: latest.avg_build >= 20 ? '#22c55e' : '#ef4444' }} />
        </div>
        <span className={styles.dimValue}>{Math.round(latest.avg_build)}/25</span>
      </div>
      <div className={styles.dimRow}>
        <span className={styles.dimLabel}>Regression</span>
        <div className={styles.dimTrack}>
          <div className={styles.dimFill} style={{ width: `${(latest.avg_regression / 25) * 100}%`, background: latest.avg_regression >= 20 ? '#22c55e' : '#ef4444' }} />
        </div>
        <span className={styles.dimValue}>{Math.round(latest.avg_regression)}/25</span>
      </div>
      <div className={styles.dimRow}>
        <span className={styles.dimLabel}>Standards</span>
        <div className={styles.dimTrack}>
          <div className={styles.dimFill} style={{ width: `${(latest.avg_standards / 25) * 100}%`, background: latest.avg_standards >= 20 ? '#22c55e' : latest.avg_standards >= 15 ? '#eab308' : '#ef4444' }} />
        </div>
        <span className={styles.dimValue}>{Math.round(latest.avg_standards)}/25</span>
      </div>
      <div className={styles.dimRow}>
        <span className={styles.dimLabel}>Traceability</span>
        <div className={styles.dimTrack}>
          <div className={styles.dimFill} style={{ width: `${(latest.avg_traceability / 25) * 100}%`, background: latest.avg_traceability >= 20 ? '#22c55e' : latest.avg_traceability >= 15 ? '#eab308' : '#ef4444' }} />
        </div>
        <span className={styles.dimValue}>{Math.round(latest.avg_traceability)}/25</span>
      </div>
    </div>
  )
}

type QuickReportPayload = {
  gate_name: string
  agent_id: string
  project_id?: string
  dimension_scores: QualityDimensionScores
  details?: string
  shared_metadata?: Record<string, unknown>
}

type ComposerFeedback = {
  type: 'success' | 'warning' | 'error'
  message: string
}

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function QuickReportCard({
  projects,
  submitting,
  feedback,
  onSubmit,
}: {
  projects: Project[]
  submitting: boolean
  feedback: ComposerFeedback | null
  onSubmit: (payload: QuickReportPayload) => Promise<boolean>
}) {
  const [projectId, setProjectId] = useState('')
  const [gateName, setGateName] = useState('manual-dashboard-gate')
  const [agentId, setAgentId] = useState('dashboard-web')
  const [branch, setBranch] = useState('master')
  const [details, setDetails] = useState('')
  const [filesTouched, setFilesTouched] = useState('')
  const [processesAffected, setProcessesAffected] = useState('')
  const [clustersTouched, setClustersTouched] = useState('')
  const [dimensions, setDimensions] = useState<QualityDimensionScores>({
    build: 25,
    regression: 25,
    standards: 25,
    traceability: 25,
  })

  const totalScore =
    dimensions.build +
    dimensions.regression +
    dimensions.standards +
    dimensions.traceability
  const grade = scoreToGradeLocal(totalScore)
  const canSubmit = gateName.trim().length > 0 && agentId.trim().length > 0

  function updateDimension(key: keyof QualityDimensionScores, rawValue: string) {
    const numeric = Number(rawValue)
    const nextValue = Number.isFinite(numeric) ? Math.max(0, Math.min(25, numeric)) : 0
    setDimensions((current) => ({ ...current, [key]: nextValue }))
  }

  async function handleSubmit() {
    if (!canSubmit) return

    const normalizedFiles = splitCommaList(filesTouched)
    const normalizedProcesses = splitCommaList(processesAffected)
    const normalizedClusters = splitCommaList(clustersTouched)
    const sharedMetadata: Record<string, unknown> = {}

    if (branch.trim()) sharedMetadata.branch = branch.trim()
    if (normalizedFiles.length > 0) sharedMetadata.filesTouched = normalizedFiles
    if (normalizedProcesses.length > 0) sharedMetadata.processesAffected = normalizedProcesses
    if (normalizedClusters.length > 0) sharedMetadata.clustersTouched = normalizedClusters
    if (projectId) sharedMetadata.resourceUris = [`cortex://project/${projectId}/context`]

    const submitted = await onSubmit({
      gate_name: gateName.trim(),
      agent_id: agentId.trim(),
      project_id: projectId || undefined,
      dimension_scores: dimensions,
      details: details.trim() || undefined,
      shared_metadata: Object.keys(sharedMetadata).length > 0 ? sharedMetadata : undefined,
    })

    if (submitted) {
      setDetails('')
      setFilesTouched('')
      setProcessesAffected('')
      setClustersTouched('')
    }
  }

  return (
    <div className={`card ${styles.composerCard}`}>
      <div className={styles.composerHeader}>
        <div>
          <h3 className={styles.cardTitle}>Quick Quality Report</h3>
          <p className={styles.composerSubtext}>
            Log a manual quality gate so the dashboard has a real audit trail even before every agent automates it.
          </p>
        </div>
        <div className={styles.previewBadge}>
          <GradeBadge grade={grade} size="md" />
          <span className={styles.previewScore}>{totalScore}/100 preview</span>
        </div>
      </div>

      {feedback && (
        <div
          className={`${styles.composerFeedback} ${
            feedback.type === 'error'
              ? styles.feedbackError
              : feedback.type === 'warning'
                ? styles.feedbackWarning
                : styles.feedbackSuccess
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className={styles.composerGrid}>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Project</span>
          <select className={styles.formInput} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Global / no project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Gate Name</span>
          <input
            className={styles.formInput}
            value={gateName}
            onChange={(e) => setGateName(e.target.value)}
            placeholder="e.g. phase-5c-manual"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Agent</span>
          <input
            className={styles.formInput}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="e.g. dashboard-web"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Branch</span>
          <input
            className={styles.formInput}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="e.g. master"
          />
        </label>
      </div>

      <div className={styles.dimensionEditor}>
        {([
          ['build', 'Build'],
          ['regression', 'Regression'],
          ['standards', 'Standards'],
          ['traceability', 'Traceability'],
        ] as const).map(([key, label]) => (
          <label key={key} className={styles.dimensionField}>
            <span className={styles.formLabel}>{label}</span>
            <input
              type="number"
              min={0}
              max={25}
              className={styles.formInput}
              value={dimensions[key]}
              onChange={(e) => updateDimension(key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className={styles.metadataGrid}>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Files Touched</span>
          <input
            className={styles.formInput}
            value={filesTouched}
            onChange={(e) => setFilesTouched(e.target.value)}
            placeholder="src/foo.ts, src/bar.ts"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Processes Affected</span>
          <input
            className={styles.formInput}
            value={processesAffected}
            onChange={(e) => setProcessesAffected(e.target.value)}
            placeholder="IndexProject, BuildDocsKnowledge"
          />
        </label>

        <label className={styles.formField}>
          <span className={styles.formLabel}>Clusters Touched</span>
          <input
            className={styles.formInput}
            value={clustersTouched}
            onChange={(e) => setClustersTouched(e.target.value)}
            placeholder="quality, graph, intel"
          />
        </label>
      </div>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Details</span>
        <textarea
          className={styles.formTextarea}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What was checked? What remains risky? Why is this gate acceptable?"
          rows={4}
        />
      </label>

      <div className={styles.composerActions}>
        <div className={styles.composerHint}>
          Manual scores use the same four dimensions the dashboard already visualizes, so the report stays compatible with future automated gates.
        </div>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!canSubmit || submitting}>
          {submitting ? 'Saving...' : 'Save Quality Report'}
        </button>
      </div>
    </div>
  )
}

function scoreToGradeLocal(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

// ── Tab System ──
type TabId = 'overview' | 'reports' | 'logs'

export default function QualityPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [filterGrade, setFilterGrade] = useState('')
  const [filterAgent, setFilterAgent] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [reportPage, setReportPage] = useState(1)
  const [logPage, setLogPage] = useState(1)
  const [composerFeedback, setComposerFeedback] = useState<ComposerFeedback | null>(null)
  const [submittingReport, setSubmittingReport] = useState(false)

  const { data: projectsData } = useSWR('projects', getAllProjects, { refreshInterval: 30000 })
  const { data: summaryData, mutate: mutateSummary } = useSWR('quality-summary', getQualitySummary, { refreshInterval: 15000 })
  const { data: trendsData, mutate: mutateTrends } = useSWR('quality-trends', () => getQualityTrends(30), { refreshInterval: 30000 })
  const { data: reportsData, mutate: mutateReports } = useSWR(
    ['quality-reports', filterGrade, filterAgent, filterProject, reportPage],
    () => getQualityReports({
      limit: 20,
      page: reportPage,
      grade: filterGrade || undefined,
      agentId: filterAgent || undefined,
      projectId: filterProject || undefined,
    }),
    { refreshInterval: 15000 }
  )
  const { data: logsData, mutate: mutateLogs } = useSWR(
    ['quality-logs', logPage],
    () => getQualityLogs({ limit: 20, page: logPage }),
    { refreshInterval: 30000 }
  )

  const projects = projectsData?.projects ?? []
  const summary = summaryData?.summary
  const latest = summaryData?.latest
  const trends = trendsData?.trends ?? []
  const reports = reportsData?.reports ?? []
  const reportsTotalPages = reportsData?.totalPages ?? 1
  const reportsTotal = reportsData?.total ?? 0
  const logs = logsData?.logs ?? []
  const logsTotalPages = logsData?.totalPages ?? 1
  const logsTotal = logsData?.total ?? 0
  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects]
  )

  // Collect unique agent IDs from reports for filter dropdown
  const uniqueAgents = useMemo(() => {
    const set = new Set(reports.map((r: QualityReportRow) => r.agent_id))
    return Array.from(set).sort()
  }, [reports])

  const latestGrade = latest?.grade ?? '—'
  const latestScore = latest?.score_total ?? 0

  // Grade distribution for chart
  const gradeDistribution = useMemo(() => {
    if (!summary) return []
    return [
      { grade: 'A', count: summary.grade_a, color: GRADE_COLORS.A ?? '#22c55e' },
      { grade: 'B', count: summary.grade_b, color: GRADE_COLORS.B ?? '#3b82f6' },
      { grade: 'C', count: summary.grade_c, color: GRADE_COLORS.C ?? '#eab308' },
      { grade: 'D', count: summary.grade_d, color: GRADE_COLORS.D ?? '#f97316' },
      { grade: 'F', count: summary.grade_f, color: GRADE_COLORS.F ?? '#ef4444' },
    ]
  }, [summary])

  const gradeDistMax = Math.max(...gradeDistribution.map(g => g.count), 1)

  async function handleManualReportSubmit(payload: QuickReportPayload): Promise<boolean> {
    setSubmittingReport(true)
    setComposerFeedback(null)
    try {
      const result = await submitQualityReport(payload)
      setComposerFeedback({
        type: result.warning ? 'warning' : 'success',
        message: result.warning
          ? `${result.warning} Report saved with grade ${result.report.grade}.`
          : `Report saved with grade ${result.report.grade} and score ${result.report.score_total}/100.`,
      })
      setActiveTab('reports')
      startTransition(() => {
        void mutateSummary()
        void mutateTrends()
        void mutateReports()
        void mutateLogs()
      })
      return true
    } catch (error) {
      setComposerFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      setSubmittingReport(false)
    }
  }

  return (
    <DashboardLayout title="Quality Gates" subtitle="4-dimension quality scoring with automated enforcement">
      {/* ── Hero Section ── */}
      <div className={styles.heroGrid}>
        {/* Current Grade */}
        <div className={`card ${styles.heroCard}`}>
          <div className={styles.heroGrade}>
            {latest ? (
              <>
                <GradeBadge grade={latestGrade} size="hero" />
                <div className={styles.heroMeta}>
                  <span className={styles.heroScore}>{latestScore}/100</span>
                  <span className={styles.heroAction}>{gradeAction(latestGrade)}</span>
                  <span className={styles.heroTime}>
                    Last: {latest.created_at ? new Date(latest.created_at).toLocaleString() : '—'}
                  </span>
                </div>
              </>
            ) : (
              <div className={styles.heroEmpty}>
                <span className={styles.heroEmptyGrade}>—</span>
                <span className={styles.heroEmptyText}>No quality reports yet</span>
              </div>
            )}
          </div>
        </div>

        {/* 4-Dimension Breakdown */}
        <div className={`card ${styles.heroCard}`}>
          <h3 className={styles.cardTitle}>4-Dimension Breakdown</h3>
          {latest ? (
            <div className={styles.dimensionCards}>
              <ScoreRing score={latest.score_build} label="Build" />
              <ScoreRing score={latest.score_regression} label="Regression" />
              <ScoreRing score={latest.score_standards} label="Standards" />
              <ScoreRing score={latest.score_traceability} label="Traceability" />
            </div>
          ) : (
            <div className={styles.emptyDimensions}>Run a quality gate to see dimension scores</div>
          )}
        </div>

        {/* Stats */}
        <div className={`card ${styles.heroCard}`}>
          <h3 className={styles.cardTitle}>Statistics</h3>
          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniStatValue}>{summary?.total_reports ?? 0}</span>
              <span className={styles.miniStatLabel}>Total Reports</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatValue} style={{ color: '#22c55e' }}>{summary?.passed_count ?? 0}</span>
              <span className={styles.miniStatLabel}>Passed</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatValue} style={{ color: '#ef4444' }}>{summary?.failed_count ?? 0}</span>
              <span className={styles.miniStatLabel}>Failed</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatValue}>{summary?.avg_score != null ? Math.round(summary.avg_score) : '—'}</span>
              <span className={styles.miniStatLabel}>Avg Score</span>
            </div>
          </div>
        </div>
      </div>

      <QuickReportCard
        projects={projects}
        submitting={submittingReport}
        feedback={composerFeedback}
        onSubmit={handleManualReportSubmit}
      />

      {/* ── Tabs ── */}
      <div className={styles.tabs}>
        {(['overview', 'reports', 'logs'] as const).map(tab => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'overview' ? 'Trend & Distribution' : tab === 'reports' ? 'Report History' : 'Execution Logs'}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'overview' && (
        <div className={styles.overviewGrid}>
          {/* Trend Chart */}
          <div className={`card ${styles.chartCard}`}>
            <h3 className={styles.cardTitle}>Quality Trend (30 days)</h3>
            <TrendChart data={trends} />
          </div>

          {/* Dimension Averages */}
          <div className={`card ${styles.chartCard}`}>
            <h3 className={styles.cardTitle}>Dimension Averages</h3>
            <DimensionBreakdown data={trends} />
          </div>

          {/* Grade Distribution */}
          <div className={`card ${styles.chartCard}`}>
            <h3 className={styles.cardTitle}>Grade Distribution</h3>
            <div className={styles.gradeDist}>
              {gradeDistribution.map(g => (
                <div key={g.grade} className={styles.gradeDistBar}>
                  <div className={styles.gradeDistFillWrap}>
                    <div
                      className={styles.gradeDistFill}
                      style={{
                        height: `${(g.count / gradeDistMax) * 100}%`,
                        background: g.color,
                      }}
                    />
                  </div>
                  <span className={styles.gradeDistLabel} style={{ color: g.color }}>{g.grade}</span>
                  <span className={styles.gradeDistCount}>{g.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className={styles.section}>
          <div className={styles.filterBar}>
            <select
              className={styles.filterSelect}
              value={filterProject}
              onChange={(e) => { setFilterProject(e.target.value); setReportPage(1) }}
            >
              <option value="">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <select
              className={styles.filterSelect}
              value={filterGrade}
              onChange={(e) => { setFilterGrade(e.target.value); setReportPage(1) }}
            >
              <option value="">All Grades</option>
              {['A', 'B', 'C', 'D', 'F'].map(g => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
            <select
              className={styles.filterSelect}
              value={filterAgent}
              onChange={(e) => { setFilterAgent(e.target.value); setReportPage(1) }}
            >
              <option value="">All Agents</option>
              {uniqueAgents.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={() => mutateReports()}>
              Refresh
            </button>
          </div>

          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>API Key</th>
                  <th className={styles.cellCenter}>Build</th>
                  <th className={styles.cellCenter}>Regr.</th>
                  <th className={styles.cellCenter}>Stds.</th>
                  <th className={styles.cellCenter}>Trace.</th>
                  <th className={styles.cellCenter}>Total</th>
                  <th className={styles.cellCenter}>Grade</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: QualityReportRow) => (
                  <ReportRow
                    key={r.id}
                    report={r}
                    projectName={r.project_id ? (projectNameById[r.project_id] ?? r.project_id) : 'Global'}
                  />
                ))}
                {reports.length === 0 && (
                  <tr>
                    <td colSpan={11} className={styles.emptyState}>
                      No quality reports yet. Use Quick Quality Report above or let agents submit <code>cortex_quality_report</code>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {reportsTotalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.paginationBtn}
                disabled={reportPage <= 1}
                onClick={() => setReportPage(p => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className={styles.pageInfo}>
                Page {reportPage} of {reportsTotalPages} ({reportsTotal} total)
              </span>
              <button
                className={styles.paginationBtn}
                disabled={reportPage >= reportsTotalPages}
                onClick={() => setReportPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className={styles.section}>
          <div className={styles.tableCard}>
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
                {logs.map((log: QueryLog) => (
                  <LegacyLogRow key={log.id} log={log} />
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.emptyState}>
                      No execution logs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {logsTotalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.paginationBtn}
                disabled={logPage <= 1}
                onClick={() => setLogPage(p => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className={styles.pageInfo}>
                Page {logPage} of {logsTotalPages} ({logsTotal} total)
              </span>
              <button
                className={styles.paginationBtn}
                disabled={logPage >= logsTotalPages}
                onClick={() => setLogPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  )
}

// ── Table Row Components ──

function ReportRow({
  report,
  projectName,
}: {
  report: QualityReportRow
  projectName: string
}) {
  return (
    <tr>
      <td><code className={styles.toolName}>{report.gate_name}</code></td>
      <td className={styles.cellMuted}>{projectName}</td>
      <td className={styles.cellMono}>{report.agent_id}</td>
      <td className={styles.cellMuted}>{report.api_key_name || '—'}</td>
      <td className={styles.cellCenter}>
        <DimScore value={report.score_build} max={25} />
      </td>
      <td className={styles.cellCenter}>
        <DimScore value={report.score_regression} max={25} />
      </td>
      <td className={styles.cellCenter}>
        <DimScore value={report.score_standards} max={25} />
      </td>
      <td className={styles.cellCenter}>
        <DimScore value={report.score_traceability} max={25} />
      </td>
      <td className={styles.cellCenter}>
        <span className={styles.totalScore}>{report.score_total}</span>
      </td>
      <td className={styles.cellCenter}>
        <GradeBadge grade={report.grade} size="sm" />
      </td>
      <td className={styles.cellMuted}>
        {report.created_at ? new Date(report.created_at).toLocaleString() : '—'}
      </td>
    </tr>
  )
}

function DimScore({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? value / max : 0
  const color = pct >= 0.9 ? '#22c55e' : pct >= 0.7 ? '#eab308' : '#ef4444'
  return <span style={{ color, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8125rem' }}>{value}</span>
}

function LegacyLogRow({ log }: { log: QueryLog }) {
  const parsed = parseParams(log.params)
  return (
    <tr>
      <td className={styles.cellMono}>{log.agent_id}</td>
      <td><code className={styles.toolName}>{log.tool}</code></td>
      <td className={styles.cellCenter}>
        {parsed.score != null ? (
          <span className={styles.score}>{parsed.score}/100</span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>
      <td className={styles.cellCenter}>
        {log.latency_ms != null ? <span>{log.latency_ms}ms</span> : <span className={styles.muted}>—</span>}
      </td>
      <td className={styles.cellCenter}>
        <span className={`badge badge-${log.status === 'ok' ? 'healthy' : 'error'}`}>{log.status}</span>
      </td>
      <td className={styles.cellMuted}>
        {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
      </td>
    </tr>
  )
}

function parseParams(params: string | null): { score?: number; details?: string } {
  if (!params) return {}
  try { return JSON.parse(params) } catch { return {} }
}
