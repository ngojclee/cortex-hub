'use client'

import { useEffect, useRef, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import styles from './ForceGraph.module.css'

/* ── Types ── */

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  meta: string
  variant: 'root' | 'cluster' | 'process' | 'member' | 'step' | 'knowledge'
  anchorX?: number
  anchorY?: number
  fx?: number | null
  fy?: number | null
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
  linkType: 'hierarchy' | 'crosslink' | 'knowledge'
  weight?: number
}

interface ForceGraphProps {
  projectName: string
  clusters: Array<{ id: string | null; name: string; symbols: number }>
  processes: Array<{ id: string | null; name: string; steps: number }>
  knowledgeDocs: number
  knowledgeChunks: number
  crossLinks: Array<{ source: string; target: string; weight: number }>
  onNodeClick: (nodeId: string, variant: string) => void
  selectedClusterId: string | null
  selectedProcessName: string | null
  selectedBranchSymbol?: string | null
  branchTrace?: {
    upstream: Array<{ name: string; type: string; edge: string }>
    downstream: Array<{ name: string; type: string; edge: string }>
  } | null
  focusMode?: boolean
  clusterMembers?: Array<{ name: string; type: string; filePath?: string }>
  processSteps?: Array<{ name: string; type: string; filePath?: string; index?: number }>
}

/* ── Color palette ── */

const VARIANT_COLORS: Record<string, string> = {
  root: '#7c3aed',
  cluster: '#2563eb',
  process: '#22c55e',
  member: '#3b82f6',
  step: '#16a34a',
  knowledge: '#f59e0b',
}

const VARIANT_STROKE: Record<string, string> = {
  root: '#a78bfa',
  cluster: '#60a5fa',
  process: '#4ade80',
  member: '#93c5fd',
  step: '#86efac',
  knowledge: '#fbbf24',
}

const HUB_RING_RADIUS = 120
const CLUSTER_RING_RADIUS = 260
const PROCESS_RING_RADIUS = 320
const DETAIL_RING_RADIUS = 150

/* ── Helpers ── */

function truncateLabel(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value
}

function polarPosition(index: number, total: number, radius: number, startAngle = -Math.PI / 2) {
  const count = Math.max(total, 1)
  const angle = startAngle + (index / count) * Math.PI * 2
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function buildGraphData(
  projectName: string,
  clusters: ForceGraphProps['clusters'],
  processes: ForceGraphProps['processes'],
  knowledgeDocs: number,
  knowledgeChunks: number,
  crossLinks: ForceGraphProps['crossLinks'],
  selectedClusterId: string | null,
  selectedProcessName: string | null,
  clusterMembers?: ForceGraphProps['clusterMembers'],
  processSteps?: ForceGraphProps['processSteps'],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  /* Root */
  nodes.push({
    id: 'root',
    label: truncateLabel(projectName, 18),
    meta: `${clusters.length} clusters \u00B7 ${processes.length} processes`,
    variant: 'root',
    anchorX: 0,
    anchorY: 0,
    fx: 0,
    fy: 0,
  })

  /* Clusters */
  clusters.forEach((c, i) => {
    const nid = c.id ?? `cluster-${i}`
    const position = polarPosition(i, clusters.length, CLUSTER_RING_RADIUS, -Math.PI * 0.88)
    nodes.push({
      id: nid,
      label: truncateLabel(c.name, 18),
      meta: `${c.symbols} sym`,
      variant: 'cluster',
      anchorX: position.x,
      anchorY: position.y,
    })
    links.push({ source: 'root', target: nid, linkType: 'hierarchy' })
  })

  /* Processes */
  processes.forEach((p, i) => {
    const nid = p.id ?? `process-${i}`
    const position = polarPosition(i, processes.length, PROCESS_RING_RADIUS, -Math.PI * 0.1)
    nodes.push({
      id: nid,
      label: truncateLabel(p.name, 18),
      meta: `${p.steps} steps`,
      variant: 'process',
      anchorX: position.x,
      anchorY: position.y,
    })
    links.push({ source: 'root', target: nid, linkType: 'hierarchy' })
  })

  /* Knowledge */
  if (knowledgeDocs > 0 || knowledgeChunks > 0) {
    nodes.push({
      id: 'knowledge-node',
      label: 'Knowledge',
      meta: `${knowledgeDocs} docs`,
      variant: 'knowledge',
      anchorX: 0,
      anchorY: HUB_RING_RADIUS + 60,
    })
    links.push({ source: 'root', target: 'knowledge-node', linkType: 'knowledge' })
  }

  /* Cross-links between clusters */
  crossLinks.forEach(link => {
    const src = clusters.find(c => c.id === link.source || c.name === link.source)
    const tgt = clusters.find(c => c.id === link.target || c.name === link.target)
    if (src && tgt && (src.id ?? '') !== (tgt.id ?? '')) {
      links.push({
        source: src.id ?? `cluster-0`,
        target: tgt.id ?? `cluster-0`,
        linkType: 'crosslink',
        weight: link.weight,
      })
    }
  })

  /* Expanded cluster members */
  if (selectedClusterId && clusterMembers?.length) {
    const clusterNode = nodes.find(
      n => n.id === selectedClusterId || n.label === selectedClusterId,
    )
    if (clusterNode) {
      clusterMembers.slice(0, 12).forEach((m, i) => {
        const mid = `member-${selectedClusterId}-${i}`
        const orbit = polarPosition(i, Math.min(clusterMembers.length, 12), DETAIL_RING_RADIUS, -Math.PI / 1.8)
        nodes.push({
          id: mid,
          label: truncateLabel(m.name, 16),
          meta: m.type,
          variant: 'member',
          anchorX: (clusterNode.anchorX ?? 0) + orbit.x,
          anchorY: (clusterNode.anchorY ?? 0) + orbit.y,
        })
        links.push({ source: clusterNode.id, target: mid, linkType: 'hierarchy' })
      })
    }
  }

  /* Expanded process steps */
  if (selectedProcessName && processSteps?.length) {
    const processNode = nodes.find(
      n => n.variant === 'process' && (n.id === selectedProcessName || n.label === selectedProcessName),
    )
    if (processNode) {
      processSteps.slice(0, 12).forEach((s, i) => {
        const sid = `step-${processNode.id}-${i}`
        const orbit = polarPosition(i, Math.min(processSteps.length, 12), DETAIL_RING_RADIUS, Math.PI / 5)
        nodes.push({
          id: sid,
          label: truncateLabel(s.name, 16),
          meta: `Step ${s.index ?? i + 1}`,
          variant: 'step',
          anchorX: (processNode.anchorX ?? 0) + orbit.x,
          anchorY: (processNode.anchorY ?? 0) + orbit.y,
        })
        links.push({ source: processNode.id, target: sid, linkType: 'hierarchy' })
      })
    }
  }

  return { nodes, links }
}

function buildFocusSets(
  graphNodes: GraphNode[],
  graphLinks: GraphLink[],
  selectedClusterId: string | null,
  selectedProcessName: string | null,
  selectedBranchSymbol: string | null | undefined,
) {
  const nodeIds = new Set<string>()
  const linkKeys = new Set<string>()

  const selectedId = selectedClusterId ?? selectedProcessName
  const selectedVariant = selectedClusterId ? 'cluster' : selectedProcessName ? 'process' : null

  if (!selectedId || !selectedVariant) {
    graphNodes.forEach((node) => nodeIds.add(node.id))
    graphLinks.forEach((link) => {
      const src = typeof link.source === 'string' ? link.source : link.source.id
      const tgt = typeof link.target === 'string' ? link.target : link.target.id
      linkKeys.add(`${src}->${tgt}`)
    })
    return { nodeIds, linkKeys }
  }

  nodeIds.add('root')

  const selectedNode = graphNodes.find((node) => node.id === selectedId || node.label === selectedId)
  if (!selectedNode) return { nodeIds, linkKeys }
  nodeIds.add(selectedNode.id)

  graphLinks.forEach((link) => {
    const src = typeof link.source === 'string' ? link.source : link.source.id
    const tgt = typeof link.target === 'string' ? link.target : link.target.id
    const key = `${src}->${tgt}`

    const touchesSelected = src === selectedNode.id || tgt === selectedNode.id
    const touchesRoot = src === 'root' || tgt === 'root'
    const touchesChild = src.startsWith(selectedVariant === 'cluster' ? 'member-' : 'step-') || tgt.startsWith(selectedVariant === 'cluster' ? 'member-' : 'step-')

    if (touchesSelected || (touchesRoot && (src === selectedNode.id || tgt === selectedNode.id)) || touchesChild) {
      linkKeys.add(key)
      nodeIds.add(src)
      nodeIds.add(tgt)
    }

    if (selectedVariant === 'cluster' && link.linkType === 'crosslink' && (src === selectedNode.id || tgt === selectedNode.id)) {
      linkKeys.add(key)
      nodeIds.add(src)
      nodeIds.add(tgt)
    }
  })

  if (selectedBranchSymbol) {
    const branchNode = graphNodes.find((node) => node.label === selectedBranchSymbol)
    if (branchNode) {
      nodeIds.add(branchNode.id)
      graphLinks.forEach((link) => {
        const src = typeof link.source === 'string' ? link.source : link.source.id
        const tgt = typeof link.target === 'string' ? link.target : link.target.id
        if (src === branchNode.id || tgt === branchNode.id) {
          linkKeys.add(`${src}->${tgt}`)
          nodeIds.add(src)
          nodeIds.add(tgt)
        }
      })
    }
  }

  return { nodeIds, linkKeys }
}

function MiniMap({
  nodes,
  selectedClusterId,
  selectedProcessName,
  selectedBranchSymbol,
}: {
  nodes: GraphNode[]
  selectedClusterId: string | null
  selectedProcessName: string | null
  selectedBranchSymbol?: string | null
}) {
  const width = 180
  const height = 140
  const points = nodes
    .filter((node) => node.variant !== 'member' && node.variant !== 'step')
    .map((node) => ({ ...node, x: node.anchorX ?? 0, y: node.anchorY ?? 0 }))

  const xValues = points.map((point) => point.x)
  const yValues = points.map((point) => point.y)
  const minX = Math.min(...xValues, -40)
  const maxX = Math.max(...xValues, 40)
  const minY = Math.min(...yValues, -40)
  const maxY = Math.max(...yValues, 40)
  const xSpan = Math.max(maxX - minX, 1)
  const ySpan = Math.max(maxY - minY, 1)

  const mapX = (value: number) => 16 + ((value - minX) / xSpan) * (width - 32)
  const mapY = (value: number) => 16 + ((value - minY) / ySpan) * (height - 32)

  return (
    <div className={styles.miniMap}>
      <div className={styles.miniMapTitle}>Map</div>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.miniMapSvg} aria-hidden="true">
        {points.map((point) => {
          const isSelected =
            point.id === selectedClusterId ||
            point.label === selectedClusterId ||
            point.id === selectedProcessName ||
            point.label === selectedProcessName ||
            point.label === selectedBranchSymbol
          return (
            <circle
              key={`minimap-${point.id}`}
              cx={mapX(point.x)}
              cy={mapY(point.y)}
              r={point.variant === 'root' ? 7 : point.variant === 'knowledge' ? 4 : 5}
              fill={isSelected ? '#facc15' : VARIANT_COLORS[point.variant] ?? '#64748b'}
              opacity={isSelected ? 1 : 0.78}
            />
          )
        })}
      </svg>
    </div>
  )
}

/* ── Component ── */

export default function ForceGraph({
  projectName,
  clusters,
  processes,
  knowledgeDocs,
  knowledgeChunks,
  crossLinks,
  onNodeClick,
  selectedClusterId,
  selectedProcessName,
  selectedBranchSymbol,
  branchTrace,
  focusMode = false,
  clusterMembers,
  processSteps,
}: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { nodes: graphNodes, links: graphLinks } = useMemo(
    () =>
      buildGraphData(
        projectName,
        clusters,
        processes,
        knowledgeDocs,
        knowledgeChunks,
        crossLinks,
        selectedClusterId,
        selectedProcessName,
        clusterMembers,
        processSteps,
      ),
    [projectName, clusters, processes, knowledgeDocs, knowledgeChunks, crossLinks, selectedClusterId, selectedProcessName, clusterMembers, processSteps],
  )

  const focusSets = useMemo(
    () => buildFocusSets(graphNodes, graphLinks, selectedClusterId, selectedProcessName, selectedBranchSymbol),
    [graphNodes, graphLinks, selectedClusterId, selectedProcessName, selectedBranchSymbol],
  )

  const nodeRadius = useCallback((d: GraphNode) => {
    switch (d.variant) {
      case 'root': return 38
      case 'cluster':
      case 'process': return 28
      case 'knowledge': return 24
      default: return 18
    }
  }, [])

  const renderGraph = useCallback(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container) return

    const width = container.clientWidth
    const height = Math.max(540, container.clientHeight)

    d3.select(svg).selectAll('*').remove()

    const svgSel = d3
      .select(svg)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`)

    /* Defs: gradients, filters */
    const defs = svgSel.append('defs')

    /* Glow filter for selected nodes */
    const glowFilter = defs.append('filter').attr('id', 'node-glow')
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur')
    glowFilter.append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', (d) => d)

    /* Background gradient */
    const bgGrad = defs.append('radialGradient').attr('id', 'graph-bg').attr('cx', '50%').attr('cy', '40%').attr('r', '60%')
    bgGrad.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(124, 58, 237, 0.06)')
    bgGrad.append('stop').attr('offset', '100%').attr('stop-color', 'transparent')

    svgSel.append('rect')
      .attr('x', -width / 2).attr('y', -height / 2)
      .attr('width', width).attr('height', height)
      .attr('fill', 'url(#graph-bg)')
      .attr('rx', 24)

    const guideGroup = svgSel.append('g').attr('class', 'guides')
    ;[HUB_RING_RADIUS, CLUSTER_RING_RADIUS, PROCESS_RING_RADIUS].forEach((radius, index) => {
      guideGroup
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', radius)
        .attr('fill', 'none')
        .attr('stroke', index === 0 ? 'rgba(250, 204, 21, 0.08)' : 'rgba(96, 165, 250, 0.08)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', index === 0 ? '2 8' : '4 10')
    })

    /* Simulation */
    const simulation = d3
      .forceSimulation<GraphNode>(graphNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(graphLinks)
          .id((d) => d.id)
          .distance((d) => {
            if (d.linkType === 'crosslink') return 180
            return 100
          })
          .strength((d) => {
            if (d.linkType === 'crosslink') return 0.15
            return 0.6
          }),
      )
      .force('charge', d3.forceManyBody().strength((d) => {
        const n = d as GraphNode
        if (n.variant === 'root') return -800
        if (n.variant === 'cluster' || n.variant === 'process') return -400
        return -200
      }))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 8))
      .force('x', d3.forceX<GraphNode>((d) => d.anchorX ?? 0).strength((d) => d.variant === 'root' ? 1 : 0.28))
      .force('y', d3.forceY<GraphNode>((d) => d.anchorY ?? 0).strength((d) => d.variant === 'root' ? 1 : 0.28))

    /* Links */
    const link = svgSel
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(graphLinks)
      .join('line')
      .attr('class', (d) => `${styles.link} ${d.linkType === 'crosslink' ? styles.linkCrosslink : ''}`)
      .attr('stroke-opacity', (d) => {
        if (!focusMode || (!selectedClusterId && !selectedProcessName)) return 0.8
        const src = typeof d.source === 'string' ? d.source : d.source.id
        const tgt = typeof d.target === 'string' ? d.target : d.target.id
        return focusSets.linkKeys.has(`${src}->${tgt}`) ? 0.95 : 0.08
      })
      .attr('stroke-width', (d) => {
        if (d.linkType === 'crosslink') return Math.min((d.weight ?? 1) + 0.5, 4)
        return 1.5
      })

    /* Node groups */
    const nodeGroup = svgSel
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(graphNodes)
      .join('g')
      .attr('class', (d) => {
        const interactive = d.variant === 'cluster' || d.variant === 'process' ? styles.nodeInteractive : ''
        return `${styles.node} ${interactive}`
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            if (d.variant === 'root') {
              d.fx = 0
              d.fy = 0
            } else {
              d.fx = null
              d.fy = null
            }
          }),
      )

    /* Node circles */
    nodeGroup
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => VARIANT_COLORS[d.variant] ?? '#64748b')
      .attr('fill-opacity', (d) => {
        if (!focusMode || (!selectedClusterId && !selectedProcessName)) return 1
        return focusSets.nodeIds.has(d.id) ? 1 : 0.14
      })
      .attr('stroke', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return '#facc15'
        if (selectedBranchSymbol && d.label === selectedBranchSymbol) return '#fb7185'
        return VARIANT_STROKE[d.variant] ?? '#94a3b8'
      })
      .attr('stroke-width', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return 3
        if (selectedBranchSymbol && d.label === selectedBranchSymbol) return 3.5
        return 1.5
      })
      .attr('stroke-opacity', (d) => {
        if (!focusMode || (!selectedClusterId && !selectedProcessName)) return 0.7
        return focusSets.nodeIds.has(d.id) ? 0.9 : 0.15
      })
      .attr('filter', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return 'url(#node-glow)'
        if (selectedBranchSymbol && d.label === selectedBranchSymbol) return 'url(#node-glow)'
        return 'none'
      })

    /* Node labels */
    nodeGroup
      .append('text')
      .attr('class', styles.nodeLabel ?? '')
      .attr('dy', (d) => (d.variant === 'root' ? '-0.2em' : '-0.1em'))
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => {
        if (d.variant === 'root') return '13px'
        if (d.variant === 'member' || d.variant === 'step') return '10px'
        return '11px'
      })
      .attr('font-weight', (d) => (d.variant === 'root' ? 700 : 600))
      .attr('fill', '#f8fafc')
      .attr('fill-opacity', (d) => {
        if (!focusMode || (!selectedClusterId && !selectedProcessName)) return 1
        return focusSets.nodeIds.has(d.id) ? 1 : 0.2
      })
      .text((d) => d.label)

    /* Node meta (below label) */
    nodeGroup
      .append('text')
      .attr('class', styles.nodeMeta ?? '')
      .attr('dy', '1.2em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', 'rgba(226, 232, 240, 0.7)')
      .attr('fill-opacity', (d) => {
        if (!focusMode || (!selectedClusterId && !selectedProcessName)) return 1
        return focusSets.nodeIds.has(d.id) ? 1 : 0.18
      })
      .text((d) => d.meta)

    /* Click handler */
    nodeGroup.on('click', (_event, d) => {
      if (d.variant === 'cluster' || d.variant === 'process') {
        onNodeClick(d.label, d.variant)
      }
    })

    /* Hover effects */
    nodeGroup
      .on('mouseenter', function () {
        d3.select(this).select('circle')
          .transition().duration(200)
          .attr('stroke-opacity', 1)
          .attr('stroke-width', 3)
      })
      .on('mouseleave', function (_event, d) {
        const isSelected =
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName ||
          d.label === selectedBranchSymbol
        d3.select(this).select('circle')
          .transition().duration(200)
          .attr('stroke-opacity', 0.7)
          .attr('stroke-width', isSelected ? 3 : 1.5)
      })

    /* Tooltip */
    nodeGroup.append('title').text((d) => `${d.label}\n${d.meta}\n(${d.variant})`)

    /* Tick */
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0)

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`)
    })

    /* Zoom */
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        svgSel.select('g.nodes').attr('transform', event.transform)
        svgSel.select('g.links').attr('transform', event.transform)
      })

    svgSel.call(zoom)

    return () => {
      simulation.stop()
    }
  }, [focusMode, focusSets.linkKeys, focusSets.nodeIds, graphNodes, graphLinks, selectedBranchSymbol, selectedClusterId, selectedProcessName, onNodeClick, nodeRadius])

  useEffect(() => {
    const cleanup = renderGraph()
    return () => cleanup?.()
  }, [renderGraph])

  /* Resize handler */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      renderGraph()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [renderGraph])

  return (
    <div className={`card ${styles.graphCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Architecture Constellation</h3>
          <p className={styles.cardSub}>
            The app stays at the hub while clusters, processes, and knowledge radiate outward. Drag to inspect, scroll to zoom, and click a branch to open its deeper structure.
          </p>
        </div>
      </div>
      <div ref={containerRef} className={styles.graphViewport}>
        <svg ref={svgRef} className={styles.graphSvg} role="img" aria-label="Project dependency graph" />
        {selectedBranchSymbol && branchTrace && (
          <div className={styles.traceOverlay}>
            <div className={styles.traceHeader}>
              <span className={styles.traceKicker}>Canvas Trace</span>
              <span className={styles.traceSymbol}>{selectedBranchSymbol}</span>
            </div>
            <div className={styles.traceGrid}>
              <div className={styles.traceColumn}>
                <div className={styles.traceColumnTitle}>Before</div>
                <div className={styles.traceStack}>
                  {branchTrace.upstream.length > 0 ? branchTrace.upstream.slice(0, 4).map((item) => (
                    <div key={`trace-up-${item.name}-${item.edge}`} className={styles.traceNode}>
                      <span className={styles.traceNodeName}>{item.name}</span>
                      <span className={styles.traceEdge}>{item.edge}</span>
                      <span className={styles.traceType}>{item.type}</span>
                    </div>
                  )) : <div className={styles.traceEmpty}>No upstream matches</div>}
                </div>
              </div>
              <div className={styles.traceCore}>
                <div className={styles.traceConnector} />
                <div className={`${styles.traceNode} ${styles.traceNodeActive}`}>
                  <span className={styles.traceNodeName}>{selectedBranchSymbol}</span>
                  <span className={styles.traceType}>Current symbol</span>
                </div>
                <div className={styles.traceConnector} />
              </div>
              <div className={styles.traceColumn}>
                <div className={styles.traceColumnTitle}>After</div>
                <div className={styles.traceStack}>
                  {branchTrace.downstream.length > 0 ? branchTrace.downstream.slice(0, 4).map((item) => (
                    <div key={`trace-down-${item.name}-${item.edge}`} className={styles.traceNode}>
                      <span className={styles.traceNodeName}>{item.name}</span>
                      <span className={styles.traceEdge}>{item.edge}</span>
                      <span className={styles.traceType}>{item.type}</span>
                    </div>
                  )) : <div className={styles.traceEmpty}>No downstream matches</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        <MiniMap
          nodes={graphNodes}
          selectedClusterId={selectedClusterId}
          selectedProcessName={selectedProcessName}
          selectedBranchSymbol={selectedBranchSymbol}
        />
      </div>
    </div>
  )
}
