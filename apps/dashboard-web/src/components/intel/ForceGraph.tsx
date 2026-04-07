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

/* ── Helpers ── */

function truncateLabel(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value
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
    fx: 0,
    fy: -220,
  })

  /* Clusters */
  clusters.forEach((c, i) => {
    const nid = c.id ?? `cluster-${i}`
    nodes.push({
      id: nid,
      label: truncateLabel(c.name, 18),
      meta: `${c.symbols} sym`,
      variant: 'cluster',
    })
    links.push({ source: 'root', target: nid, linkType: 'hierarchy' })
  })

  /* Processes */
  processes.forEach((p, i) => {
    const nid = p.id ?? `process-${i}`
    nodes.push({
      id: nid,
      label: truncateLabel(p.name, 18),
      meta: `${p.steps} steps`,
      variant: 'process',
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
        nodes.push({
          id: mid,
          label: truncateLabel(m.name, 16),
          meta: m.type,
          variant: 'member',
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
        nodes.push({
          id: sid,
          label: truncateLabel(s.name, 16),
          meta: `Step ${s.index ?? i + 1}`,
          variant: 'step',
        })
        links.push({ source: processNode.id, target: sid, linkType: 'hierarchy' })
      })
    }
  }

  return { nodes, links }
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
      .force('center', d3.forceCenter(0, 20))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 8))
      .force('y', d3.forceY(-60).strength(0.15))

    /* Links */
    const link = svgSel
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(graphLinks)
      .join('line')
      .attr('class', (d) => `${styles.link} ${d.linkType === 'crosslink' ? styles.linkCrosslink : ''}`)
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
              d.fy = -220
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
      .attr('stroke', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return '#facc15'
        return VARIANT_STROKE[d.variant] ?? '#94a3b8'
      })
      .attr('stroke-width', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return 3
        return 1.5
      })
      .attr('stroke-opacity', 0.7)
      .attr('filter', (d) => {
        if (
          d.id === selectedClusterId ||
          d.label === selectedClusterId ||
          d.id === selectedProcessName ||
          d.label === selectedProcessName
        ) return 'url(#node-glow)'
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
      .text((d) => d.label)

    /* Node meta (below label) */
    nodeGroup
      .append('text')
      .attr('class', styles.nodeMeta ?? '')
      .attr('dy', '1.2em')
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('fill', 'rgba(226, 232, 240, 0.7)')
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
          d.label === selectedProcessName
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
  }, [graphNodes, graphLinks, selectedClusterId, selectedProcessName, onNodeClick, nodeRadius])

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
          <h3 className={styles.cardTitle}>Force-Directed Graph</h3>
          <p className={styles.cardSub}>
            Interactive force layout. Drag nodes to rearrange. Scroll to zoom. Click clusters or processes to expand.
          </p>
        </div>
      </div>
      <div ref={containerRef} className={styles.graphViewport}>
        <svg ref={svgRef} className={styles.graphSvg} role="img" aria-label="Project dependency graph" />
      </div>
    </div>
  )
}
