'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import {
  getIntelProjectsResource,
  getIntelProjectContext,
  getIntelProjectClusters,
  getIntelProjectProcesses,
  getIntelProjectProcessDetail,
  getIntelProjectDiscovery,
  getIntelProjectCrossLinks,
  getIntelProjectClusterMembers,
  getIntelProjectSymbolTree,
  getIntelSymbolContext,
  getIntelSymbolImpact,
  runIntelCypherQuery,
  linkDiscoveredProject,
  type IntelDiscoveryCandidate,
  type IntelProjectResourceSummary,
  type IntelProcessStep,
} from '@/lib/api'
import styles from './page.module.css'
import SymbolTreeViewer from '@/components/intel/SymbolTreeViewer'
import ForceGraph from '@/components/intel/ForceGraph'
import GraphExplorer from '@/components/intel/GraphExplorer'

const EDGE_FILTER_OPTIONS = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'ACCESSES'] as const
type EdgeFilter = typeof EDGE_FILTER_OPTIONS[number]
type GraphPreset = 'overview' | 'dependencies' | 'types'
type GraphMode = 'architecture' | 'explorer'

const GRAPH_PRESETS: Array<{
  key: GraphPreset
  label: string
  description: string
  focusMode: boolean
  filters: EdgeFilter[]
}> = [
  {
    key: 'overview',
    label: 'Overview',
    description: 'See the broad architecture map without semantic filtering.',
    focusMode: false,
    filters: [],
  },
  {
    key: 'dependencies',
    label: 'Dependency Lens',
    description: 'Bias toward runtime and module dependency relationships.',
    focusMode: true,
    filters: ['CALLS', 'IMPORTS', 'ACCESSES'],
  },
  {
    key: 'types',
    label: 'Type System',
    description: 'Isolate inheritance and implementation relationships.',
    focusMode: true,
    filters: ['EXTENDS', 'IMPLEMENTS'],
  },
]

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

function projectKindLabel(kind: string | undefined): string {
  if (!kind) return 'unknown'
  return kind.replaceAll('_', ' ')
}

function projectStatusNote(project: IntelProjectResourceSummary | null | undefined): string | null {
  if (!project) return null
  if (project.classification.kind === 'umbrella') {
    return 'Umbrella project. Keep it visible for navigation, but index and inspect its sub-projects instead.'
  }
  if (project.classification.kind === 'knowledge_only') {
    return 'Knowledge-linked project with no repo registration yet.'
  }
  if (project.classification.kind === 'placeholder') {
    return 'Placeholder project. No repo or project-scoped knowledge detected yet.'
  }
  if (project.classification.hasAliasDrift) {
    return `GitNexus alias drift detected (${project.classification.aliasCount} repo aliases).`
  }
  if (!project.classification.isIndexable) {
    return 'This project currently has no direct repo signal for indexing.'
  }
  return null
}

function matchesEdgeFilter(edge: string | undefined, filters: EdgeFilter[]): boolean {
  if (filters.length === 0) return true
  if (!edge) return false
  const normalized = edge.toUpperCase()
  return filters.some((filter) => normalized.includes(filter))
}

/* ── Parse GitNexus raw text into categorized sections ── */
interface ParsedEntry {
  symbol: string
  edge?: string
  file?: string
  type?: string
}

interface ParsedContext {
  sections: {
    key: string
    title: string
    entries: ParsedEntry[]
  }[]
}

function parseGitNexusContext(raw: string): ParsedContext {
  const lines = raw.split('\n')
  const sections: ParsedContext['sections'] = []
  let currentSection: ParsedContext['sections'][number] | null = null

  const sectionPatterns: Array<{ pattern: RegExp; key: string; title: string }> = [
    { pattern: /===\s*CALLERS?\s*===/i, key: 'callers', title: 'Callers (Who uses this)' },
    { pattern: /===\s*CALLEES?\s*===/i, key: 'callees', title: 'Callees (What this uses)' },
    { pattern: /===\s*IMPORTS?\s*===/i, key: 'imports', title: 'Imports' },
    { pattern: /===\s*EXTENDS?\s*===/i, key: 'extends', title: 'Extends / Inherits' },
    { pattern: /===\s*IMPLEMENTS?\s*===/i, key: 'implements', title: 'Implements' },
    { pattern: /===\s*OVERRIDES?\s*===/i, key: 'overrides', title: 'Overrides' },
    { pattern: /===\s*ACCESSES?\s*===/i, key: 'accesses', title: 'Accesses' },
    { pattern: /===\s*MEMBERS?\s*===/i, key: 'members', title: 'Members' },
    { pattern: /===\s*USED BY\s*===/i, key: 'usedby', title: 'Used By' },
    { pattern: /===\s*USES\s*===/i, key: 'uses', title: 'Uses' },
    { pattern: /===\s*RELATED\s*===/i, key: 'related', title: 'Related Symbols' },
    { pattern: /===\s*.+\s*===/, key: 'other', title: 'Other' },
  ]

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('Symbol:') || trimmed.startsWith('File:') || trimmed.startsWith('Type:')) continue

    // Check for section header
    let matched = false
    for (const sp of sectionPatterns) {
      if (sp.pattern.test(trimmed)) {
        currentSection = { key: sp.key, title: sp.title, entries: [] }
        sections.push(currentSection)
        matched = true
        break
      }
    }
    if (matched) continue

    // Parse entry line: "- symbolName (Type) [EDGE_TYPE] @ filePath"
    if (currentSection && trimmed) {
      const entryMatch = trimmed.match(/^[-•*]\s+(.+?)(?:\s*\((\w+)\))?(?:\s*\[(\w+)\])?(?:\s*@\s*(.+))?$/)
      if (entryMatch) {
        currentSection.entries.push({
          symbol: entryMatch[1]?.trim() ?? trimmed.replace(/^[-•*]\s*/, ''),
          type: entryMatch[2] || undefined,
          edge: entryMatch[3] || undefined,
          file: entryMatch[4]?.trim() || undefined,
        })
      } else if (!trimmed.startsWith('-') && !trimmed.startsWith('•') && trimmed.length > 2) {
        // Non-bullet line that isn't a header — could be a description
        currentSection.entries.push({ symbol: trimmed })
      }
    }
  }

  // If no sections parsed, try a flat parse
  if (sections.length === 0) {
    const entries: ParsedEntry[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const entryMatch = trimmed.match(/^[-•*]\s+(.+?)(?:\s*\((\w+)\))?(?:\s*\[(\w+)\])?(?:\s*@\s*(.+))?$/)
      if (entryMatch) {
        entries.push({
          symbol: entryMatch[1]?.trim() ?? '',
          type: entryMatch[2] || undefined,
          edge: entryMatch[3] || undefined,
          file: entryMatch[4]?.trim() || undefined,
        })
      }
    }
    if (entries.length > 0) {
      sections.push({ key: 'all', title: 'All References', entries })
    }
  }

  return { sections }
}

function ContextVisual({ raw, filters }: { raw: string; filters: EdgeFilter[] }) {
  const parsed = useMemo(() => parseGitNexusContext(raw), [raw])
  const filteredSections = useMemo(
    () => parsed.sections.map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => matchesEdgeFilter(entry.edge, filters)),
    })).filter((section) => section.entries.length > 0),
    [filters, parsed.sections],
  )

  if (parsed.sections.length === 0) {
    return <pre className={styles.contextPre}>{raw}</pre>
  }

  const titleClass = (key: string) =>
    key === 'callers' || key === 'usedby' ? styles.contextCallersTitle :
    key === 'callees' || key === 'uses' ? styles.contextCalleesTitle :
    styles.contextRelatedTitle

  const edgeClass = (edge?: string) => {
    if (!edge) return styles.edgeDEFAULT
    const e = edge.toUpperCase()
    if (e.includes('CALL')) return styles.edgeCALLS
    if (e.includes('IMPORT')) return styles.edgeIMPORTS
    if (e.includes('EXTEND')) return styles.edgeEXTENDS
    if (e.includes('IMPLEM')) return styles.edgeIMPLEMENTS
    if (e.includes('OVERRIDE')) return styles.edgeOVERRIDES
    if (e.includes('ACCESS')) return styles.edgeACCESSES
    return styles.edgeDEFAULT
  }

  return (
    <div>
      {filteredSections.length === 0 && (
        <div className={styles.contextEmpty}>No entries match the active edge filters.</div>
      )}
      {filteredSections.map(section => (
        <div key={section.key} className={styles.contextSection}>
          <div className={`${styles.contextSectionTitle} ${titleClass(section.key)}`}>
            {section.title} ({section.entries.length})
          </div>
          {section.entries.length === 0 ? (
            <div className={styles.contextEmpty}>No entries found.</div>
          ) : (
            section.entries.map((entry, i) => (
              <div key={`${section.key}-${i}`} className={styles.contextEntry}>
                <span className={styles.contextEntrySymbol}>{entry.symbol}</span>
                {entry.type && <span className={styles.contextEntryType}>{entry.type}</span>}
                {entry.edge && <span className={`${styles.contextEntryEdge} ${edgeClass(entry.edge)}`}>{entry.edge}</span>}
                {entry.file && <span className={styles.contextEntryFile} title={entry.file}>{entry.file}</span>}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Parse GitNexus impact results into depth groups ── */
interface ImpactSymbol {
  name: string
  file?: string
  type?: string
  edge?: string
}

interface ImpactDepthGroup {
  depth: number
  label: string
  severity: 'critical' | 'warning' | 'info'
  symbols: ImpactSymbol[]
}

interface TreeSegmentNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

interface TreeSegmentRelation {
  type: string
  id: string
  properties: Record<string, unknown>
}

interface TreeSegment {
  start: TreeSegmentNode
  end: TreeSegmentNode
  relationship: TreeSegmentRelation
}

interface TreeApiResult {
  success?: boolean
  data?: {
    results?: Array<{
      path?: Array<{
        segments: TreeSegment[]
      }>
    }>
  }
}

interface BranchRelation {
  name: string
  type: string
  edge: string
}

interface BranchChainNode {
  name: string
  type: string
  edge?: string
}

interface BranchTraceData {
  upstream: BranchRelation[]
  downstream: BranchRelation[]
  upstreamChains: BranchChainNode[][]
  downstreamChains: BranchChainNode[][]
}

function parseImpactResults(results: unknown): ImpactDepthGroup[] {
  const groups: ImpactDepthGroup[] = []

  // Handle string results
  if (typeof results === 'string') {
    const lines = results.split('\n').filter(l => l.trim())
    const symbols: ImpactSymbol[] = []
    for (const line of lines) {
      const match = line.match(/^[-•*]?\s*(.+?)(?:\s*\((\w+)\))?(?:\s*\[(\w+)\])?(?:\s*@\s*(.+))?$/)
      if (match) {
        symbols.push({ name: match[1]?.trim() ?? '', type: match[2], edge: match[3], file: match[4]?.trim() })
      }
    }
    if (symbols.length > 0) {
      groups.push({ depth: 1, label: 'Direct Impact', severity: 'critical', symbols })
    }
    return groups
  }

  // Handle JSON results (could be structured depth data)
  if (typeof results === 'object' && results !== null) {
    const r = results as Record<string, unknown>
    // Try depth-based structure: { depth_1: [...], depth_2: [...] }
    for (const key of Object.keys(r)) {
      const depthMatch = key.match(/depth[_-]?(\d+)/i)
      if (depthMatch) {
        const depth = parseInt(depthMatch[1] ?? '0')
        const arr = Array.isArray(r[key]) ? r[key] : []
        const symbols: ImpactSymbol[] = arr.map((item: unknown) => {
          const obj = item as Record<string, unknown>
          return {
            name: String(obj.name ?? obj.symbol ?? obj.target ?? 'unknown'),
            file: obj.file?.toString() ?? obj.filePath?.toString(),
            type: obj.type?.toString(),
            edge: obj.edge?.toString() ?? obj.relationship?.toString(),
          }
        })
        groups.push({
          depth,
          label: depth <= 1 ? 'Direct Impact (WILL BREAK)' : depth === 2 ? 'Likely Affected' : 'May Need Testing',
          severity: depth <= 1 ? 'critical' : depth === 2 ? 'warning' : 'info',
          symbols,
        })
      }
    }

    // Fallback: flat array of symbols
    if (groups.length === 0) {
      const symbols: ImpactSymbol[] = []
      // results could be an array of strings or objects
      if (Array.isArray(r.results)) {
        for (const item of r.results) {
          if (typeof item === 'string') {
            symbols.push({ name: item })
          } else if (typeof item === 'object') {
            const obj = item as Record<string, unknown>
            symbols.push({
              name: String(obj.name ?? obj.symbol ?? 'unknown'),
              file: obj.file?.toString() ?? obj.filePath?.toString(),
              type: obj.type?.toString(),
              edge: obj.edge?.toString(),
            })
          }
        }
      } else if (Array.isArray(results)) {
        for (const item of results) {
          if (typeof item === 'string') {
            symbols.push({ name: item })
          } else if (typeof item === 'object') {
            const obj = item as Record<string, unknown>
            symbols.push({ name: String(obj.name ?? 'unknown'), file: obj.filePath?.toString() })
          }
        }
      }
      if (symbols.length > 0) {
        groups.push({ depth: 1, label: 'Direct Impact', severity: 'critical', symbols })
      }
    }
  }

  return groups
}

function parseDirectRelations(results: TreeApiResult | null | undefined, filters: EdgeFilter[]): BranchRelation[] {
  const rows = results?.data?.results ?? []
  const deduped = new Map<string, BranchRelation>()

  for (const row of rows) {
    const segment = row.path?.[0]?.segments?.[0]
    if (!segment) continue
    const edge = segment.relationship?.type ?? 'DEPENDS_ON'
    if (!matchesEdgeFilter(edge, filters)) continue

    const rawName = segment.end?.properties?.name
    const name = typeof rawName === 'string' && rawName.trim() ? rawName : 'unknown'
    const type = segment.end?.labels?.[0] ?? 'Symbol'
    const key = `${name}:${type}:${edge}`
    if (!deduped.has(key)) deduped.set(key, { name, type, edge })
  }

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name) || a.edge.localeCompare(b.edge))
}

function parseTraceChains(
  results: TreeApiResult | null | undefined,
  symbolName: string,
  filters: EdgeFilter[],
): BranchChainNode[][] {
  const rows = results?.data?.results ?? []
  const chains = new Map<string, BranchChainNode[]>()

  for (const row of rows) {
    const segments = row.path?.[0]?.segments ?? []
    if (segments.length === 0) continue

    const chain: BranchChainNode[] = [{ name: symbolName, type: 'Symbol' }]
    let valid = true

    for (const segment of segments) {
      const edge = segment.relationship?.type ?? 'DEPENDS_ON'
      if (!matchesEdgeFilter(edge, filters)) {
        valid = false
        break
      }

      const rawName = segment.end?.properties?.name
      const name = typeof rawName === 'string' && rawName.trim() ? rawName : 'unknown'
      const type = segment.end?.labels?.[0] ?? 'Symbol'
      chain.push({ name, type, edge })
    }

    if (!valid || chain.length < 2) continue
    const key = chain.map((node) => `${node.edge ?? 'ROOT'}:${node.name}:${node.type}`).join('>')
    if (!chains.has(key)) chains.set(key, chain)
  }

  return Array.from(chains.values())
    .sort((a, b) => b.length - a.length || a.map((node) => node.name).join(' ').localeCompare(b.map((node) => node.name).join(' ')))
    .slice(0, 4)
}

function ImpactVisual({ target, direction, results, filters }: { target: string; direction: string; results: unknown; filters: EdgeFilter[] }) {
  const groups = useMemo(() => parseImpactResults(results), [results])
  const filteredGroups = useMemo(
    () => groups
      .map((group) => ({
        ...group,
        symbols: group.symbols.filter((symbol) => matchesEdgeFilter(symbol.edge, filters)),
      }))
      .filter((group) => group.symbols.length > 0),
    [filters, groups],
  )

  if (groups.length === 0) {
    return (
      <div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          No downstream impact found for <strong>{target}</strong>.
        </p>
        <pre className={styles.contextPre}>{typeof results === 'string' ? results : JSON.stringify(results, null, 2)}</pre>
      </div>
    )
  }

  const totalAffected = filteredGroups.reduce((sum, g) => sum + g.symbols.length, 0)

  return (
    <div>
      <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <strong>{totalAffected}</strong> symbols affected {direction === 'upstream' ? 'upstream' : 'downstream'} from <strong>{target}</strong>
      </div>

      {filteredGroups.length === 0 && (
        <div className={styles.contextEmpty}>No impacted symbols match the active edge filters.</div>
      )}
      {filteredGroups.map(group => (
        <div key={`depth-${group.depth}`} className={styles.impactDepthGroup}>
          <div className={styles.impactDepthHeader}>
            <span className={`${styles.impactDepthBadge} ${
              group.severity === 'critical' ? styles.depthDirect :
              group.severity === 'warning' ? styles.depthLikely :
              styles.depthMaybe
            }`}>
              {group.severity === 'critical' ? '⚠' : group.severity === 'warning' ? '⚡' : 'ℹ'} Depth {group.depth}
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {group.label} — {group.symbols.length} symbol{group.symbols.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.impactSymbolList}>
            {group.symbols.map((sym, i) => (
              <div key={`sym-${group.depth}-${i}`} className={styles.impactSymbol}>
                <span className={styles.impactSymbolName}>{sym.name}</span>
                {sym.type && <span className={styles.contextEntryType}>{sym.type}</span>}
                {sym.edge && <span className={`${styles.contextEntryEdge} ${styles.edgeDEFAULT}`}>{sym.edge}</span>}
                {sym.file && <span className={styles.impactSymbolFile}>{sym.file}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
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

function formatCypherOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const CYPHER_PRESETS = [
  {
    label: 'Top processes',
    query: `MATCH (p:Process)
RETURN p.label AS label, p.heuristicLabel AS heuristicLabel, p.stepCount AS steps
LIMIT 12`,
  },
  {
    label: 'Cluster nodes',
    query: `MATCH (c:Cluster)
RETURN c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion
LIMIT 12`,
  },
  {
    label: 'Step flow',
    query: `MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
RETURN p.label AS process, n.name AS stepName, n.filePath AS filePath, r.step AS step
ORDER BY process, step
LIMIT 30`,
  },
]


function DiscoveryCard({
  candidate,
  onLink,
  linking,
}: {
  candidate: IntelDiscoveryCandidate
  onLink: (candidate: IntelDiscoveryCandidate) => void
  linking: boolean
}) {
  return (
    <div className={`card ${styles.discoveryCard}`}>
      <div className={styles.discoveryHead}>
        <div>
          <h3 className={styles.discoveryTitle}>{candidate.name}</h3>
          <p className={styles.discoverySlug}>{candidate.slug}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => onLink(candidate)} disabled={linking}>
          {linking ? 'Linking…' : 'Link Project'}
        </button>
      </div>
      <div className={styles.discoveryTags}>
        {candidate.sourceKinds.map((source) => (
          <span key={source} className={styles.discoveryTag}>{source.replaceAll('_', ' ')}</span>
        ))}
      </div>
      <div className={styles.discoveryMeta}>
        {candidate.gitRepoUrl && <span>repo: {candidate.gitRepoUrl}</span>}
        {candidate.gitnexus && <span>{candidate.gitnexus.stats.symbols ?? 0} symbols</span>}
        {candidate.knowledge && <span>{candidate.knowledge.docs} knowledge docs</span>}
      </div>
    </div>
  )
}

function BranchDrilldownPanel({
  symbolName,
  loading,
  drilldown,
  onClose,
}: {
  symbolName: string | null
  loading: boolean
  drilldown: BranchTraceData | null
  onClose: () => void
}) {
  if (!symbolName && !loading) return null

  const renderColumn = (title: string, items: BranchRelation[] | undefined, keyPrefix: string) => (
    <div className={styles.drillColumn}>
      <div className={styles.drillColumnTitle}>{title}</div>
      {items && items.length > 0 ? items.map((item) => (
        <div key={`${keyPrefix}-${item.name}-${item.edge}`} className={styles.drillItem}>
          <span className={styles.drillItemName}>{item.name}</span>
          <span className={`${styles.contextEntryEdge} ${styles.edgeDEFAULT}`}>{item.edge}</span>
          <span className={styles.memberType}>{item.type}</span>
        </div>
      )) : <div className={styles.sidebarEmpty}>No matches.</div>}
    </div>
  )

  return (
    <div className={styles.drilldownPanel}>
      <div className={styles.drilldownHeader}>
        <div>
          <div className={styles.drilldownKicker}>Branch Drill-Down</div>
          <div className={styles.drilldownTitle}>{symbolName ?? 'Loading symbol...'}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
      </div>
      {loading ? (
        <div className={styles.sidebarEmpty}>Tracing upstream/downstream...</div>
      ) : (
        <div className={styles.drilldownGrid}>
          {renderColumn('Before / Upstream', drilldown?.upstream, 'up')}
          {renderColumn('After / Downstream', drilldown?.downstream, 'down')}
        </div>
      )}
    </div>
  )
}

export default function GraphPage() {
  const [graphMode, setGraphMode] = useState<GraphMode>('explorer')
  const [projectId, setProjectId] = useState('')
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null)
  const [processDetail, setProcessDetail] = useState<{
    process: {
      id: string
      name: string
      label: string | null
      heuristicLabel: string | null
      type: string | null
      steps: number
    }
    steps: IntelProcessStep[]
  } | null>(null)
  const [loadingProcess, setLoadingProcess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [cypherQuery, setCypherQuery] = useState(CYPHER_PRESETS[0]?.query ?? '')
  const [cypherResult, setCypherResult] = useState<string | null>(null)
  const [cypherError, setCypherError] = useState<string | null>(null)
  const [runningCypher, setRunningCypher] = useState(false)
  const [architectureLoaded, setArchitectureLoaded] = useState(false)

  const { data: projectsData, error: projectsError, mutate: mutateProjects } = useSWR(
    'intel-projects-resource',
    getIntelProjectsResource,
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )
  const { data: discoveryData, mutate: mutateDiscovery } = useSWR(
    'intel-project-discovery',
    getIntelProjectDiscovery,
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const projects = projectsData?.data.items ?? []
  const discoveryCandidates = discoveryData?.data.candidates ?? []

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      const first = projects[0]
      if (first) setProjectId(first.projectId)
    }
  }, [projectId, projects])

  useEffect(() => {
    setSelectedCluster(null)
    setSelectedProcess(null)
    setProcessDetail(null)
    setSymbolTree(null)
    setSymbolContext(null)
    setSymbolImpact(null)
    setSelectedSymbol(null)
    setSelectedBranchSymbol(null)
    setBranchDrilldown(null)
    setCypherResult(null)
    setCypherError(null)
  }, [projectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId) ?? null,
    [projectId, projects],
  )
  const selectedProjectNote = useMemo(
    () => projectStatusNote(selectedProject),
    [selectedProject],
  )

  const shouldLoadArchitecture = graphMode === 'architecture' && architectureLoaded

  const { data: contextData, error: contextError } = useSWR(
    projectId && shouldLoadArchitecture ? ['intel-project-context', projectId] : null,
    () => getIntelProjectContext(projectId),
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const { data: clustersData } = useSWR(
    projectId && shouldLoadArchitecture ? ['intel-project-clusters', projectId] : null,
    () => getIntelProjectClusters(projectId, 12),
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const { data: processesData } = useSWR(
    projectId && shouldLoadArchitecture ? ['intel-project-processes', projectId] : null,
    () => getIntelProjectProcesses(projectId, 12),
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const { data: crossLinksData } = useSWR(
    projectId && shouldLoadArchitecture ? ['intel-project-crosslinks', projectId] : null,
    () => getIntelProjectCrossLinks(projectId),
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [symbolTree, setSymbolTree] = useState<Record<string, unknown> | null>(null)
  const [symbolContext, setSymbolContext] = useState<{ name: string; raw: string } | null>(null)
  const [symbolImpact, setSymbolImpact] = useState<{ target: string; direction: string; results: unknown } | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingContext, setLoadingContext] = useState(false)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [treeDirection, setTreeDirection] = useState<'upstream' | 'downstream'>('downstream')
  const [focusMode, setFocusMode] = useState(true)
  const [edgeFilters, setEdgeFilters] = useState<EdgeFilter[]>([])
  const [activePreset, setActivePreset] = useState<GraphPreset>('overview')
  const [selectedBranchSymbol, setSelectedBranchSymbol] = useState<string | null>(null)
  const [branchDrilldown, setBranchDrilldown] = useState<BranchTraceData | null>(null)
  const [loadingBranchDrilldown, setLoadingBranchDrilldown] = useState(false)

  const { data: clusterMembersData } = useSWR(
    shouldLoadArchitecture && projectId && selectedCluster ? ['intel-project-cluster-members', projectId, selectedCluster] : null,
    () => getIntelProjectClusterMembers(projectId, selectedCluster ?? ''),
    { refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const context = contextData?.data
  const clusters = clustersData?.data.clusters ?? []
  const processes = processesData?.data.processes ?? []
  const crossLinks = crossLinksData?.data.crossLinks ?? []
  const selectedStaleness = context?.project.staleness ?? selectedProject?.staleness
  const freshnessTone = statusTone(selectedStaleness?.status)

  function handleLinkCandidate(candidate: IntelDiscoveryCandidate) {
    setLinkingKey(candidate.key)
    startTransition(async () => {
      try {
        const result = await linkDiscoveredProject({
          slug: candidate.slug,
          name: candidate.name,
          gitRepoUrl: candidate.gitRepoUrl,
          repoPath: candidate.repoPath,
        })

        await Promise.all([mutateProjects(), mutateDiscovery()])
        if (result.project?.id) {
          setProjectId(result.project.id)
        }
      } finally {
        setLinkingKey(null)
      }
    })
  }

  const handleViewProcess = async (processName: string) => {
    if (!projectId) return
    setSelectedCluster(null)
    setSelectedProcess(processName)
    setProcessDetail(null)
    setLoadingProcess(true)
    try {
      const data = await getIntelProjectProcessDetail(projectId, processName)
      if (data.success) {
        setProcessDetail({
          process: data.data.process,
          steps: data.data.steps,
        })
      }
    } catch (err) {
      console.error('Failed to load process detail:', err)
    } finally {
      setLoadingProcess(false)
    }
  }

  const handleViewTree = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setLoadingTree(true)
    try {
      const data = await getIntelProjectSymbolTree(projectId, symbolName, { depth: 3, direction: treeDirection, edgeTypes: edgeFilters })
      setSymbolTree(data)
    } catch (err) {
      console.error('Failed to load symbol tree:', err)
    } finally {
      setLoadingTree(false)
    }
  }

  const handleViewContext = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setSymbolContext(null)
    setLoadingContext(true)
    try {
      const data = await getIntelSymbolContext(projectId, symbolName)
      if (data.success && data.data.results.raw) {
        setSymbolContext({ name: symbolName, raw: data.data.results.raw })
      }
    } catch (err) {
      console.error('Failed to load symbol context:', err)
    } finally {
      setLoadingContext(false)
    }
  }

  const handleViewImpact = async (symbolName: string) => {
    if (!projectId) return
    setSelectedSymbol(symbolName)
    setSymbolImpact(null)
    setLoadingImpact(true)
    try {
      const data = await getIntelSymbolImpact(projectId, symbolName, 'downstream')
      if (data.success) {
        setSymbolImpact({ target: data.data.target, direction: data.data.direction, results: data.data.results })
      }
    } catch (err) {
      console.error('Failed to load impact analysis:', err)
    } finally {
      setLoadingImpact(false)
    }
  }

  const handleRunCypher = async () => {
    if (!projectId || !cypherQuery.trim()) return
    setRunningCypher(true)
    setCypherError(null)
    setCypherResult(null)
    try {
      const data = await runIntelCypherQuery(projectId, cypherQuery)
      setCypherResult(formatCypherOutput(data.data))
    } catch (err) {
      setCypherError(err instanceof Error ? err.message : 'Cypher query failed')
    } finally {
      setRunningCypher(false)
    }
  }

  const handleInspectBranch = async (symbolName: string) => {
    if (!projectId) return
    setSelectedBranchSymbol(symbolName)
    setLoadingBranchDrilldown(true)
    try {
      const [upstreamData, downstreamData] = await Promise.all([
        getIntelProjectSymbolTree(projectId, symbolName, { depth: 3, direction: 'upstream', edgeTypes: edgeFilters }),
        getIntelProjectSymbolTree(projectId, symbolName, { depth: 3, direction: 'downstream', edgeTypes: edgeFilters }),
      ])
      setBranchDrilldown({
        upstream: parseDirectRelations(upstreamData as TreeApiResult, edgeFilters),
        downstream: parseDirectRelations(downstreamData as TreeApiResult, edgeFilters),
        upstreamChains: parseTraceChains(upstreamData as TreeApiResult, symbolName, edgeFilters),
        downstreamChains: parseTraceChains(downstreamData as TreeApiResult, symbolName, edgeFilters),
      })
    } catch (err) {
      console.error('Failed to load branch drill-down:', err)
      setBranchDrilldown({ upstream: [], downstream: [], upstreamChains: [], downstreamChains: [] })
    } finally {
      setLoadingBranchDrilldown(false)
    }
  }

  const toggleEdgeFilter = (filter: EdgeFilter) => {
    setEdgeFilters((current) => (
      current.includes(filter)
        ? current.filter((value) => value !== filter)
        : [...current, filter]
    ))
    setActivePreset('overview')
  }

  const applyPreset = (presetKey: GraphPreset) => {
    const preset = GRAPH_PRESETS.find((entry) => entry.key === presetKey)
    if (!preset) return
    setActivePreset(preset.key)
    setFocusMode(preset.focusMode)
    setEdgeFilters(preset.filters)
  }

  const breadcrumbTrail = [
    selectedProject?.name ?? 'Project',
    selectedCluster ?? selectedProcess ?? null,
    selectedSymbol ?? null,
  ].filter(Boolean) as string[]

  return (
    <DashboardLayout title="Graph" subtitle="Project architecture explorer built from Cortex intel resources">
      <div className={styles.graphToolbar}>
        <div className={styles.projectControl}>
          <label className={styles.selectorLabel} htmlFor="graph-project-select">Project</label>
          <select
            id="graph-project-select"
            className={styles.selector}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name} ({project.slug}) - {projectKindLabel(project.classification.kind)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.toolbarMeta}>
          {selectedProject ? (
            <>
              <span>{projectKindLabel(selectedProject.classification.kind)}</span>
              <span>{selectedProject.branch ?? 'unknown branch'}</span>
              <span className={`badge badge-${freshnessTone}`}>{statusLabel(selectedStaleness?.status)}</span>
              {selectedProject.classification.hasAliasDrift && (
                <span className={styles.selectorWarning}>aliases {selectedProject.classification.aliasCount}</span>
              )}
            </>
          ) : (
            <span>No linked projects yet.</span>
          )}
        </div>

        <div className={styles.modeSwitch} aria-label="Graph view mode">
          <button
            className={`${styles.modeButton} ${graphMode === 'architecture' ? styles.modeButtonActive : ''}`}
            onClick={() => setGraphMode('architecture')}
          >
            Architecture
          </button>
          <button
            className={`${styles.modeButton} ${graphMode === 'explorer' ? styles.modeButtonActive : ''}`}
            onClick={() => setGraphMode('explorer')}
          >
            Explorer
          </button>
        </div>
      </div>

      {selectedProjectNote && (
        <div className={styles.projectNotice}>{selectedProjectNote}</div>
      )}

      {discoveryCandidates.length > 0 && (
        <div className={styles.discoverySection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Unlinked Project Candidates</h2>
            <p className={styles.sectionText}>
              Repos or knowledge spaces exist, but Cortex has not promoted them into first-class projects yet.
            </p>
          </div>
          <div className={styles.discoveryGrid}>
            {discoveryCandidates.map((candidate) => (
              <DiscoveryCard
                key={candidate.key}
                candidate={candidate}
                onLink={handleLinkCandidate}
                linking={linkingKey === candidate.key || isPending}
              />
            ))}
          </div>
        </div>
      )}

      {projectsError && (
        <div className={styles.errorBanner}>Failed to load linked projects.</div>
      )}

      {!projectsError && projects.length === 0 && (
        <div className={`card ${styles.emptyState}`}>
          No linked projects yet. Use the discovery cards above to promote repos or knowledge spaces into first-class Cortex projects.
        </div>
      )}

      {contextError && graphMode === 'architecture' && architectureLoaded && (
        <div className={styles.errorBanner}>Failed to load graph context for the selected project.</div>
      )}

      {selectedProject && graphMode === 'architecture' && !architectureLoaded && (
        <div className={`card ${styles.architecturePrompt}`}>
          <div>
            <h3 className={styles.cardTitle}>Architecture View</h3>
            <p className={styles.cardSub}>Load clusters, processes, cross-links, and context only when you need the high-level map.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setArchitectureLoaded(true)}>Load Architecture</button>
        </div>
      )}

      {selectedProject && graphMode === 'architecture' && architectureLoaded && !context && !contextError && (
        <div className={`card ${styles.architecturePrompt}`}>Loading architecture resources...</div>
      )}

      {selectedProject && graphMode === 'explorer' && (
        <GraphExplorer
          projectId={selectedProject.projectId}
          projectName={selectedProject.name}
          indexStatus={statusLabel(selectedStaleness?.status)}
        />
      )}

      {selectedProject && context && graphMode === 'architecture' && (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Indexed At" value={formatIndexedAt(context.project.indexedAt)} hint={context.project.staleness.basedOn} />
            <StatCard label="Symbols" value={context.stats.symbols ?? 0} hint={`GitNexus: ${context.project.gitnexus.stats.symbols ?? 0}`} />
            <StatCard label="Relationships" value={context.stats.relationships ?? 0} hint="graph edges" />
            <StatCard label="Knowledge" value={context.project.knowledge.docs} hint={`${context.project.knowledge.chunks} chunks`} />
          </div>

          {(selectedProject.classification.kind !== 'repository' || selectedProject.classification.hasAliasDrift) && (
            <div className={`card ${styles.projectHealthCard}`}>
              <div className={styles.projectHealthTitle}>Project Health</div>
              <div className={styles.projectHealthBody}>
                <span>kind: {projectKindLabel(selectedProject.classification.kind)}</span>
                <span>indexable: {selectedProject.classification.isIndexable ? 'yes' : 'no'}</span>
                {selectedProject.classification.hasAliasDrift && (
                  <span>aliases: {selectedProject.classification.aliases.join(', ')}</span>
                )}
              </div>
            </div>
          )}

          <div className={`card ${styles.graphControls}`}>
            <div className={styles.breadcrumbs}>
              {breadcrumbTrail.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className={styles.breadcrumbItem}>
                  {index > 0 && <span className={styles.breadcrumbSep}>›</span>}
                  <span>{crumb}</span>
                </span>
              ))}
            </div>
            <div className={styles.controlRow}>
              <button
                className={`btn btn-sm ${focusMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setActivePreset('overview')
                  setFocusMode((current) => !current)
                }}
              >
                {focusMode ? 'Focus Mode On' : 'Focus Mode Off'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setActivePreset('overview')
                  setEdgeFilters([])
                }}
                disabled={edgeFilters.length === 0}
              >
                Clear Filters
              </button>
            </div>
            <div className={styles.presetGrid}>
              {GRAPH_PRESETS.map((preset) => {
                const active = activePreset === preset.key
                return (
                  <button
                    key={preset.key}
                    className={`${styles.presetCard} ${active ? styles.presetCardActive : ''}`}
                    onClick={() => applyPreset(preset.key)}
                  >
                    <span className={styles.presetLabel}>{preset.label}</span>
                    <span className={styles.presetDescription}>{preset.description}</span>
                  </button>
                )
              })}
            </div>
            <div className={styles.filterChips}>
              {EDGE_FILTER_OPTIONS.map((filter) => {
                const active = edgeFilters.includes(filter)
                return (
                  <button
                    key={filter}
                    className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                    onClick={() => toggleEdgeFilter(filter)}
                  >
                    {filter}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={styles.graphWrapper}>
            <div className={styles.graphMain}>
              <ForceGraph
                projectName={selectedProject.name}
                clusters={clusters}
                processes={processes}
                knowledgeDocs={context.project.knowledge.docs}
                knowledgeChunks={context.project.knowledge.chunks}
                crossLinks={crossLinks}
                onNodeClick={(id, variant) => {
                  if (variant === 'cluster') {
                    setSelectedProcess(null)
                    setProcessDetail(null)
                    setSelectedBranchSymbol(null)
                    setBranchDrilldown(null)
                    setSelectedCluster(id === selectedCluster ? null : id)
                  }
                  if (variant === 'process') {
                    setSelectedBranchSymbol(null)
                    setBranchDrilldown(null)
                    void handleViewProcess(id)
                  }
                }}
                selectedClusterId={selectedCluster}
                selectedProcessName={selectedProcess}
                selectedBranchSymbol={selectedBranchSymbol}
                branchTrace={branchDrilldown}
                onTraceSymbolClick={(name) => {
                  void handleInspectBranch(name)
                }}
                focusMode={focusMode}
                clusterMembers={clusterMembersData?.data?.members}
                processSteps={processDetail?.steps.map((s, i) => ({ name: s.name, type: s.type ?? 'step', filePath: s.filePath ?? undefined, index: i + 1 }))}
              />
            </div>
            {selectedCluster && (
              <div className={styles.graphSidebar}>
                <div className={`card ${styles.sidebarCard}`}>
                  <div className={styles.sidebarHeader}>
                    <h3 className={styles.sidebarTitle}>{selectedCluster}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCluster(null)}>×</button>
                  </div>
                  <div className={styles.sidebarMeta}>
                    {clusterMembersData?.data?.members?.length ?? 0} members
                  </div>

                  {/* Direction toggle */}
                  <div className={styles.directionToggle}>
                    <span>Tree direction:</span>
                    <button
                      className={`btn btn-sm ${treeDirection === 'upstream' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTreeDirection('upstream')}
                    >↑ Up</button>
                    <button
                      className={`btn btn-sm ${treeDirection === 'downstream' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTreeDirection('downstream')}
                    >↓ Down</button>
                  </div>

                  {!clusterMembersData && <div className={styles.sidebarEmpty}>Loading members...</div>}
                  {clusterMembersData && clusterMembersData.data.members.length === 0 && (
                    <div className={styles.sidebarEmpty}>No members found.</div>
                  )}
                  {clusterMembersData && clusterMembersData.data.members.length > 0 && (
                    <div className={styles.sidebarMemberList}>
                      {clusterMembersData.data.members.map((member) => (
                        <div key={`${member.filePath ?? 'root'}-${member.name}`} className={styles.sidebarMember}>
                          <div className={styles.sidebarMemberHead}>
                            <span className={styles.memberName}>{member.name}</span>
                          </div>
                          <div className={styles.memberActions}>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => void handleInspectBranch(member.name)}
                            >
                              Trace
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewTree(member.name)}
                            >
                              Tree
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewContext(member.name)}
                            >
                              Context
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                              onClick={() => handleViewImpact(member.name)}
                            >
                              Impact
                            </button>
                          </div>
                          <span className={styles.memberType}>{member.type}</span>
                          {member.filePath && <span className={styles.memberFile}>{member.filePath}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <BranchDrilldownPanel
                    symbolName={selectedBranchSymbol}
                    loading={loadingBranchDrilldown}
                    drilldown={branchDrilldown}
                    onClose={() => {
                      setSelectedBranchSymbol(null)
                      setBranchDrilldown(null)
                    }}
                  />
                </div>
              </div>
            )}
            {!selectedCluster && selectedProcess && (
              <div className={styles.graphSidebar}>
                <div className={`card ${styles.sidebarCard}`}>
                  <div className={styles.sidebarHeader}>
                    <div>
                      <h3 className={styles.sidebarTitle}>{selectedProcess}</h3>
                      <div className={styles.sidebarMeta}>
                        {loadingProcess
                          ? 'Loading process detail...'
                          : `${processDetail?.steps.length ?? 0} steps${processDetail?.process.type ? ` · ${processDetail.process.type}` : ''}`}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setSelectedProcess(null)
                        setProcessDetail(null)
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {loadingProcess && <div className={styles.sidebarEmpty}>Loading process detail...</div>}
                  {!loadingProcess && !processDetail && (
                    <div className={styles.sidebarEmpty}>No process detail found for this process yet.</div>
                  )}
                  {!loadingProcess && processDetail && (
                    <>
                      <div className={styles.processMetaGrid}>
                        <div className={styles.processMetaItem}>
                          <span className={styles.processMetaLabel}>Type</span>
                          <span className={styles.processMetaValue}>{processDetail.process.type ?? 'unknown'}</span>
                        </div>
                        <div className={styles.processMetaItem}>
                          <span className={styles.processMetaLabel}>Steps</span>
                          <span className={styles.processMetaValue}>{processDetail.process.steps}</span>
                        </div>
                      </div>
                      <div className={styles.processSteps}>
                        {processDetail.steps.map((step) => (
                          <div key={`${processDetail.process.id}-${step.step}-${step.name}`} className={styles.processStep}>
                            <div className={styles.processStepHead}>
                              <span className={styles.processStepIndex}>Step {step.step}</span>
                              {step.type && <span className={styles.processStepType}>{step.type}</span>}
                            </div>
                            <span className={styles.processStepName}>{step.name}</span>
                            <div className={styles.memberActions}>
                              <button
                                className="btn btn-sm btn-secondary"
                                style={{ padding: '2px 6px', fontSize: '10px' }}
                                onClick={() => void handleInspectBranch(step.name)}
                              >
                                Trace
                              </button>
                              <button
                                className="btn btn-sm btn-secondary"
                                style={{ padding: '2px 6px', fontSize: '10px' }}
                                onClick={() => handleViewTree(step.name)}
                              >
                                Tree
                              </button>
                            </div>
                            {step.filePath && <span className={styles.processStepFile}>{step.filePath}</span>}
                          </div>
                        ))}
                      </div>
                      <BranchDrilldownPanel
                        symbolName={selectedBranchSymbol}
                        loading={loadingBranchDrilldown}
                        drilldown={branchDrilldown}
                        onClose={() => {
                          setSelectedBranchSymbol(null)
                          setBranchDrilldown(null)
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

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

          <div className={`card ${styles.playgroundCard}`}>
            <div className={styles.playgroundHeader}>
              <div>
                <h3 className={styles.cardTitle}>Cypher Playground</h3>
                <p className={styles.cardSub}>
                  Run read-only GitNexus graph queries against the selected project when the overview view is not enough.
                </p>
              </div>
              <div className={styles.playgroundPresets}>
                {CYPHER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="btn btn-secondary btn-sm"
                    onClick={() => setCypherQuery(preset.query)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className={styles.playgroundInput}
              value={cypherQuery}
              onChange={(event) => setCypherQuery(event.target.value)}
              spellCheck={false}
            />

            <div className={styles.playgroundActions}>
              <span className={styles.playgroundHint}>
                Scoped to project: {selectedProject.slug}
              </span>
              <button className="btn btn-primary btn-sm" onClick={handleRunCypher} disabled={runningCypher || !cypherQuery.trim()}>
                {runningCypher ? 'Running…' : 'Run Query'}
              </button>
            </div>

            {cypherError && <div className={styles.errorBanner}>{cypherError}</div>}
            {cypherResult && (
              <pre className={styles.playgroundOutput}>{cypherResult}</pre>
            )}
          </div>
        </>
      )}

      {selectedSymbol && (
        loadingTree ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading dependency tree for {selectedSymbol}…</div>
        ) : (
          <SymbolTreeViewer
            symbolName={selectedSymbol}
            treeData={symbolTree}
            onClose={() => {
              setSelectedSymbol(null)
              setSymbolTree(null)
            }}
          />
        )
      )}

      {/* Symbol Context Panel — 360° Visual */}
      {selectedSymbol && symbolContext && !loadingContext && (
        <div className={`card ${styles.contextPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>360° Symbol Context</span>
              <div className={styles.contextHeader}>
                <div className={styles.contextSymbolBadge}>
                  <span className={styles.contextSymbolName}>{symbolContext.name}</span>
                </div>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => { setSelectedSymbol(null); setSymbolContext(null) }}>Close</button>
          </div>
          <div className={styles.contextContent}>
            <ContextVisual raw={symbolContext.raw} filters={edgeFilters} />
          </div>
        </div>
      )}

      {selectedSymbol && loadingContext && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading context for {selectedSymbol}…</div>
      )}

      {/* Impact Analysis Panel — Visual Blast Radius */}
      {selectedSymbol && symbolImpact && !loadingImpact && (
        <div className={`card ${styles.impactPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelKicker}>Blast Radius Analysis</span>
              <h3 className={styles.panelTitle}>{symbolImpact.target}</h3>
              <span className={styles.panelSub}>Direction: {symbolImpact.direction}</span>
            </div>
            <button className="btn btn-ghost" onClick={() => { setSelectedSymbol(null); setSymbolImpact(null) }}>Close</button>
          </div>
          <div className={styles.impactContent}>
            <ImpactVisual target={symbolImpact.target} direction={symbolImpact.direction} results={symbolImpact.results} filters={edgeFilters} />
          </div>
        </div>
      )}

      {selectedSymbol && loadingImpact && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading impact analysis for {selectedSymbol}…</div>
      )}
    </DashboardLayout>
  )
}
