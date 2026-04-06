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
  type IntelClusterResource,
  type IntelDiscoveryCandidate,
  type IntelProcessResource,
  type IntelProcessStep,
  type IntelCrossLink,
} from '@/lib/api'
import styles from './page.module.css'
import SymbolTreeViewer from '@/components/intel/SymbolTreeViewer'

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

function truncateLabel(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
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

function ContextVisual({ raw }: { raw: string }) {
  const parsed = useMemo(() => parseGitNexusContext(raw), [raw])

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
      {parsed.sections.map(section => (
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

function ImpactVisual({ target, direction, results }: { target: string; direction: string; results: unknown }) {
  const groups = useMemo(() => parseImpactResults(results), [results])

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

  const totalAffected = groups.reduce((sum, g) => sum + g.symbols.length, 0)

  return (
    <div>
      <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        <strong>{totalAffected}</strong> symbols affected {direction === 'upstream' ? 'upstream' : 'downstream'} from <strong>{target}</strong>
      </div>

      {groups.map(group => (
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

type OrbitNode = {
  id: string
  title: string
  meta: string
  x: number
  y: number
  w: number
  h: number
  variant: 'cluster' | 'process' | 'summary' | 'knowledge'
}

function layoutRow(
  items: Array<{ id: string; title: string; meta: string }>,
  startX: number,
  endX: number,
  y: number,
  variant: 'cluster' | 'process' | 'knowledge',
  nodeW = 152,
  nodeH = 52,
): OrbitNode[] {
  const maxVisible = 6
  const visible = items.slice(0, maxVisible)
  const remaining = items.length - visible.length
  const count = visible.length + (remaining > 0 ? 1 : 0)

  const positioned: OrbitNode[] = visible.map((item, index) => ({
    id: item.id,
    title: truncateLabel(item.title, 18),
    meta: item.meta,
    x: count <= 1 ? (startX + endX) / 2 : startX + (endX - startX) * index / (count - 1),
    y,
    w: nodeW,
    h: nodeH,
    variant: variant as OrbitNode['variant'],
  }))

  if (remaining > 0) {
    positioned.push({
      id: `${variant}-overflow`,
      title: `+${remaining}`,
      meta: 'more',
      x: count <= 1 ? (startX + endX) / 2 : startX + (endX - startX) * visible.length / (count - 1),
      y,
      w: 64,
      h: nodeH,
      variant: 'summary',
    })
  }

  return positioned
}

function treePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = (fromY + toY) / 2
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`
}

function GraphCanvas({
  projectName,
  clusters,
  processes,
  knowledgeDocs,
  knowledgeChunks,
  crossLinks,
  onNodeClick,
  selectedClusterId,
  clusterMembers,
  processSteps,
}: {
  projectName: string
  clusters: IntelClusterResource[]
  processes: IntelProcessResource[]
  knowledgeDocs: number
  knowledgeChunks: number
  crossLinks: IntelCrossLink[]
  onNodeClick: (nodeId: string, nodeVariant: string) => void
  selectedClusterId: string | null
  clusterMembers: Array<{ name: string; type: string; filePath?: string }> | undefined
  processSteps: Array<{ name: string; type: string; filePath?: string; index?: number }> | undefined
}) {
  const width = 1080
  const svgH = 640
  const rootX = width / 2
  const rootY = 52
  const LEVEL1 = 180
  const LEVEL2 = 330
  const LEVEL3 = 470

  /* ── Level 1: clusters (left) + processes (right) ── */
  const clusterNodes = layoutRow(
    clusters.map((c, i) => ({ id: c.id ?? `cluster-${i}`, title: c.name, meta: `${c.symbols} sym` })),
    90, 440, LEVEL1, 'cluster',
  )
  const processNodes = layoutRow(
    processes.map((p, i) => ({ id: p.id ?? `process-${i}`, title: p.name, meta: `${p.steps} steps` })),
    640, 990, LEVEL1, 'process',
  )

  /* ── Level 2: expanded cluster symbols ── */
  const selectedClusterNode = clusterNodes.find(n => selectedClusterId === n.id || selectedClusterId === n.title)
  const memberNodes: OrbitNode[] = useMemo(() => {
    if (!selectedClusterNode || !clusterMembers?.length) return []
    const max = 8
    const items = clusterMembers.slice(0, max).map((m, i) => ({
      id: `member-${i}`,
      title: m.name,
      meta: m.type,
    }))
    const cx = selectedClusterNode.x
    return layoutRow(items, cx - 160, cx + 160, LEVEL2, 'cluster', 120, 36)
  }, [selectedClusterNode, clusterMembers])

  /* ── Level 2: expanded process steps ── */
  const stepNodes: OrbitNode[] = useMemo(() => {
    if (!processSteps?.length || !selectedClusterId) return []
    const firstProcess = processNodes[0]
    if (!firstProcess) return []
    const max = 8
    const items = processSteps.slice(0, max).map((s, i) => ({
      id: `step-${i}`,
      title: s.name,
      meta: `Step ${s.index ?? i + 1}`,
    }))
    const cx = firstProcess.x
    return layoutRow(items, cx - 160, cx + 160, LEVEL2, 'process', 120, 36)
  }, [processSteps, selectedClusterId, processNodes])

  /* ── Knowledge node ── */
  const knowledgeNode: OrbitNode | null = knowledgeDocs > 0 || knowledgeChunks > 0
    ? { id: 'knowledge-node', title: 'Knowledge', meta: `${knowledgeDocs} docs`, x: rootX, y: LEVEL3, w: 160, h: 48, variant: 'knowledge' }
    : null

  const allNodes = [...clusterNodes, ...processNodes, ...memberNodes, ...stepNodes, ...(knowledgeNode ? [knowledgeNode] : [])]

  /* ── Colors ── */
  const fillFor = (v: string) =>
    v === 'cluster' ? 'url(#clusterNode)' :
    v === 'process' ? 'url(#processNode)' :
    v === 'knowledge' ? 'url(#knowledgeNode)' :
    'url(#summaryNode)'

  return (
    <div className={`card ${styles.graphCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Context Tree</h3>
          <p className={styles.cardSub}>
            Hierarchical tree: project → clusters &amp; processes → symbols &amp; steps. Click a node to expand its children.
          </p>
        </div>
      </div>

      <div className={styles.graphViewport}>
        <svg viewBox={`0 0 ${width} ${svgH}`} className={styles.graphSvg} role="img" aria-label="Project tree">
          <defs>
            <linearGradient id="graphLine" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(96,165,250,0.25)" />
              <stop offset="100%" stopColor="rgba(192,132,252,0.45)" />
            </linearGradient>
            <radialGradient id="graphGlow" cx="50%" cy="30%" r="55%">
              <stop offset="0%" stopColor="rgba(124,58,237,0.12)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <linearGradient id="clusterNode" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0f2d52" /><stop offset="100%" stopColor="#2563eb" /></linearGradient>
            <linearGradient id="processNode" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#143826" /><stop offset="100%" stopColor="#22c55e" /></linearGradient>
            <linearGradient id="summaryNode" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#2e2552" /><stop offset="100%" stopColor="#7c3aed" /></linearGradient>
            <linearGradient id="knowledgeNode" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#4a2c10" /><stop offset="100%" stopColor="#f59e0b" /></linearGradient>
            <linearGradient id="projectNode" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#1f0d34" /><stop offset="100%" stopColor="#6d28d9" /></linearGradient>
          </defs>

          {/* Background */}
          <rect x="14" y="14" width={width - 28} height={svgH - 28} rx="32" className={styles.graphFrame} />
          <ellipse cx={rootX} cy={LEVEL1} rx="460" ry="260" fill="url(#graphGlow)" />

          {/* ── Edges: Root → Level 1 ── */}
          {[...clusterNodes, ...processNodes].map(n => (
            <path key={`e-${n.id}`} d={treePath(rootX, rootY + 26, n.x, n.y - n.h / 2)} stroke="url(#graphLine)" strokeWidth="1.8" fill="none" className={styles.graphEdge} />
          ))}

          {/* ── Edges: Level 1 → Level 2 (expanded cluster members) ── */}
          {selectedClusterNode && memberNodes.map(m => (
            <path key={`em-${m.id}`} d={treePath(selectedClusterNode.x, selectedClusterNode.y + selectedClusterNode.h / 2, m.x, m.y - m.h / 2)} stroke="rgba(96,165,250,0.35)" strokeWidth="1.4" fill="none" />
          ))}

          {/* ── Edges: Level 1 → Level 2 (expanded process steps) ── */}
          {selectedClusterId && stepNodes.length > 0 && processNodes[0] && stepNodes.map(s => {
            const pn = processNodes[0]!
            return <path key={`es-${s.id}`} d={treePath(pn.x, pn.y + pn.h / 2, s.x, s.y - s.h / 2)} stroke="rgba(34,197,94,0.35)" strokeWidth="1.4" fill="none" />
          })}

          {/* ── Edge: Root → Knowledge ── */}
          {knowledgeNode && (
            <path d={treePath(rootX, rootY + 26, knowledgeNode.x, knowledgeNode.y - knowledgeNode.h / 2)} stroke="url(#graphLine)" strokeWidth="1.8" fill="none" className={styles.graphEdge} />
          )}

          {/* ── Cross-links between clusters ── */}
          {crossLinks.map(link => {
            const src = clusterNodes.find(n => n.id === link.source || n.title === link.source)
            const tgt = clusterNodes.find(n => n.id === link.target || n.title === link.target)
            if (!src || !tgt || src.id === tgt.id) return null
            const arcY = Math.max(src.y, tgt.y) + 50
            return (
              <path key={`x-${link.source}-${link.target}`}
                d={`M ${src.x} ${src.y + src.h / 2} Q ${(src.x + tgt.x) / 2} ${arcY} ${tgt.x} ${tgt.y + tgt.h / 2}`}
                stroke="rgba(192,132,252,0.4)" strokeWidth={Math.min(link.weight + 1, 5)} fill="none"
                strokeDasharray="4 4"
                opacity={selectedClusterId && src.id !== selectedClusterId && tgt.id !== selectedClusterId ? 0.12 : 0.75}
              >
                <title>{link.weight} shared process(es): {link.processes.join(', ')}</title>
              </path>
            )
          })}

          {/* ── Root Node ── */}
          <g transform={`translate(${rootX - 118}, ${rootY - 24})`}>
            <rect width="236" height="48" rx="24" fill="url(#projectNode)" className={styles.graphCore} />
            <text x="20" y="20" className={styles.graphCoreTitle}>{truncateLabel(projectName, 20)}</text>
            <text x="20" y="38" className={styles.graphCoreSmall}>{clusters.length} clusters · {processes.length} processes</text>
          </g>

          {/* ── Level 1 & 2 Nodes ── */}
          {allNodes.map(node => {
            const isExpanded = selectedClusterNode?.id === node.id
            const isSelected = selectedClusterId === node.id || selectedClusterId === node.title
            const stroke = isExpanded ? 'rgba(250,204,21,0.8)' : isSelected ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.06)'
            const isL2 = node.id.startsWith('member-') || node.id.startsWith('step-')
            const nodeW = node.w
            const nodeH = node.h

            return (
              <g key={node.id}
                transform={`translate(${node.x - nodeW / 2}, ${node.y - nodeH / 2})`}
                className={!isL2 && (node.variant === 'cluster' || node.variant === 'process') ? styles.graphNodeInteractive : ''}
                onClick={() => {
                  if (node.variant === 'cluster' || node.variant === 'process') onNodeClick(node.title, node.variant)
                }}
              >
                <rect width={nodeW} height={nodeH} rx={isL2 ? 10 : 16} fill={fillFor(node.variant)}
                  className={isL2 ? '' : styles.graphNode}
                  style={{ stroke, strokeWidth: isExpanded || isSelected ? 2 : 1 }}
                />
                <text x={isL2 ? 10 : 16} y={nodeH / 2 - 4} className={isL2 ? styles.graphNodeMeta : styles.graphNodeTitle}
                  style={isL2 ? { fontSize: '11px' } : undefined}
                >{node.title}</text>
                <text x={isL2 ? 10 : 16} y={nodeH / 2 + 12} className={styles.graphNodeMeta}
                  style={isL2 ? { fontSize: '9px' } : undefined}
                >{node.meta}</text>
                {/* expand indicator for selected cluster */}
                {isExpanded && (
                  <text x={nodeW - 14} y={nodeH / 2 + 4} fill="rgba(250,204,21,0.8)" fontSize="12" fontWeight="700">▾</text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

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

export default function GraphPage() {
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

  const { data: projectsData, error: projectsError, mutate: mutateProjects } = useSWR(
    'intel-projects-resource',
    getIntelProjectsResource,
    { refreshInterval: 30000 },
  )
  const { data: discoveryData, mutate: mutateDiscovery } = useSWR(
    'intel-project-discovery',
    getIntelProjectDiscovery,
    { refreshInterval: 30000 },
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
    setCypherResult(null)
    setCypherError(null)
  }, [projectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === projectId) ?? null,
    [projectId, projects],
  )

  const { data: contextData, error: contextError } = useSWR(
    projectId ? ['intel-project-context', projectId] : null,
    () => getIntelProjectContext(projectId),
    { refreshInterval: 30000 },
  )

  const { data: clustersData } = useSWR(
    projectId ? ['intel-project-clusters', projectId] : null,
    () => getIntelProjectClusters(projectId, 12),
    { refreshInterval: 30000 },
  )

  const { data: processesData } = useSWR(
    projectId ? ['intel-project-processes', projectId] : null,
    () => getIntelProjectProcesses(projectId, 12),
    { refreshInterval: 30000 },
  )

  const { data: crossLinksData } = useSWR(
    projectId ? ['intel-project-crosslinks', projectId] : null,
    () => getIntelProjectCrossLinks(projectId),
    { refreshInterval: 60000 },
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

  const { data: clusterMembersData } = useSWR(
    projectId && selectedCluster ? ['intel-project-cluster-members', projectId, selectedCluster] : null,
    () => getIntelProjectClusterMembers(projectId, selectedCluster ?? ''),
    { refreshInterval: 60000 },
  )

  const context = contextData?.data
  const clusters = clustersData?.data.clusters ?? []
  const processes = processesData?.data.processes ?? []
  const crossLinks = crossLinksData?.data.crossLinks ?? []
  const freshnessTone = statusTone(context?.project.staleness.status)

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
      const data = await getIntelProjectSymbolTree(projectId, symbolName, { depth: 2, direction: treeDirection })
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

  return (
    <DashboardLayout title="Graph" subtitle="Project architecture explorer built from Cortex intel resources">
      <div className={styles.hero}>
        <div className={styles.heroIntro}>
          <span className={styles.kicker}>Graph Explorer</span>
          <h2 className={styles.heroTitle}>Link orphan repos, surface knowledge-aware projects, and inspect architecture without raw Cypher.</h2>
          <p className={styles.heroText}>
            Cortex now needs to do more than show already-linked projects. This view is meant to expose missing project candidates and give you a graph that still reads when branches grow.
          </p>
        </div>

        <div className={`card ${styles.selectorCard}`}>
          <label className={styles.selectorLabel} htmlFor="graph-project-select">Project</label>
          <select
            id="graph-project-select"
            className={styles.selector}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name} ({project.slug})
              </option>
            ))}
          </select>
          <div className={styles.selectorMeta}>
            {selectedProject ? (
              <>
                <span>branch: {selectedProject.branch ?? 'unknown'}</span>
                <span className={`badge badge-${freshnessTone}`}>{statusLabel(context?.project.staleness.status)}</span>
              </>
            ) : (
              <span>No linked projects yet.</span>
            )}
          </div>
        </div>
      </div>

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

      {contextError && (
        <div className={styles.errorBanner}>Failed to load graph context for the selected project.</div>
      )}

      {selectedProject && context && (
        <>
          <div className={styles.statsGrid}>
            <StatCard label="Indexed At" value={formatIndexedAt(context.project.indexedAt)} hint={context.project.staleness.basedOn} />
            <StatCard label="Symbols" value={context.stats.symbols ?? 0} hint={`GitNexus: ${context.project.gitnexus.stats.symbols ?? 0}`} />
            <StatCard label="Relationships" value={context.stats.relationships ?? 0} hint="graph edges" />
            <StatCard label="Knowledge" value={context.project.knowledge.docs} hint={`${context.project.knowledge.chunks} chunks`} />
          </div>

          <div className={styles.graphWrapper}>
            <div className={styles.graphMain}>
              <GraphCanvas
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
                    setSelectedCluster(id === selectedCluster ? null : id)
                  }
                  if (variant === 'process') {
                    void handleViewProcess(id)
                  }
                }}
                selectedClusterId={selectedCluster}
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
                            {step.filePath && <span className={styles.processStepFile}>{step.filePath}</span>}
                          </div>
                        ))}
                      </div>
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
            <ContextVisual raw={symbolContext.raw} />
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
            <ImpactVisual target={symbolImpact.target} direction={symbolImpact.direction} results={symbolImpact.results} />
          </div>
        </div>
      )}

      {selectedSymbol && loadingImpact && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>Loading impact analysis for {selectedSymbol}…</div>
      )}
    </DashboardLayout>
  )
}
