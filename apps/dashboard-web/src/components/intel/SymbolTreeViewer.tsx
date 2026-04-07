'use client'

import { useMemo } from 'react'
import styles from './SymbolTreeViewer.module.css'

interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

interface GraphRelationship {
  type: string
  id: string
  properties: Record<string, unknown>
}

interface PathSegment {
  start: GraphNode
  end: GraphNode
  relationship: GraphRelationship
}

interface TreePath {
  path?: Array<{ segments: PathSegment[] }>
}

interface SymbolTreeData {
  success?: boolean
  data?: {
    uri?: string
    results?: TreePath[]
  }
}

interface SymbolTreeViewerProps {
  symbolName: string
  treeData: SymbolTreeData | null
  onClose: () => void
}

interface TreeLeaf {
  key: string
  name: string
  type: string
  edgeType: string | null
  children: TreeLeaf[]
}

function getNodeName(node: GraphNode | undefined): string {
  const value = node?.properties?.name
  return typeof value === 'string' && value.trim() ? value : 'unknown'
}

function getNodeType(node: GraphNode | undefined): string {
  const value = node?.labels?.[0]
  return typeof value === 'string' && value.trim() ? value : 'Symbol'
}

function buildTree(paths: TreePath[], symbolName: string): { root: TreeLeaf; totalNodes: number; totalBranches: number; maxDepth: number } {
  const root: TreeLeaf = {
    key: `root:${symbolName}`,
    name: symbolName,
    type: 'Symbol',
    edgeType: null,
    children: [],
  }

  const childMaps = new Map<string, Map<string, TreeLeaf>>()
  childMaps.set(root.key, new Map())

  let totalNodes = 1
  let totalBranches = 0
  let maxDepth = 0

  for (const pathObj of paths) {
    const segments = pathObj.path?.[0]?.segments ?? []
    if (segments.length === 0) continue

    let parent = root
    let depth = 0

    for (const segment of segments) {
      const childName = getNodeName(segment.end)
      const childType = getNodeType(segment.end)
      const edgeType = segment.relationship?.type ?? 'DEPENDS_ON'
      const childKey = `${parent.key}->${edgeType}:${childName}:${childType}`
      let childMap = childMaps.get(parent.key)

      if (!childMap) {
        childMap = new Map()
        childMaps.set(parent.key, childMap)
      }

      let child = childMap.get(childKey)
      if (!child) {
        child = {
          key: childKey,
          name: childName,
          type: childType,
          edgeType,
          children: [],
        }
        childMap.set(childKey, child)
        parent.children.push(child)
        childMaps.set(child.key, new Map())
        totalNodes += 1
        totalBranches += 1
      }

      parent = child
      depth += 1
      if (depth > maxDepth) maxDepth = depth
    }
  }

  const sortTree = (node: TreeLeaf) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))
    node.children.forEach(sortTree)
  }

  sortTree(root)

  return { root, totalNodes, totalBranches, maxDepth }
}

function TreeBranch({ node }: { node: TreeLeaf }) {
  return (
    <li className={styles.branchItem}>
      <div className={styles.branchRow}>
        {node.edgeType && (
          <div className={styles.branchConnector}>
            <span className={styles.edgeType}>{node.edgeType}</span>
            <div className={styles.edgeLine} />
          </div>
        )}
        <div className={styles.node}>
          <span className={styles.nodeName}>{node.name}</span>
          <span className={styles.nodeType}>{node.type}</span>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className={styles.branchList}>
          {node.children.map((child) => (
            <TreeBranch key={child.key} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function SymbolTreeViewer({ symbolName, treeData, onClose }: SymbolTreeViewerProps) {
  const paths = treeData?.data?.results || []
  const tree = useMemo(() => buildTree(paths, symbolName), [paths, symbolName])

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.titleInfo}>
            <span className={styles.kicker}>Symbol Dependency</span>
            <h2 className={styles.title}>{symbolName}</h2>
            {paths.length > 0 && (
              <div className={styles.summary}>
                <span>{tree.totalNodes} nodes</span>
                <span>{tree.totalBranches} branches</span>
                <span>depth {tree.maxDepth}</span>
              </div>
            )}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className={styles.content}>
          {paths.length === 0 ? (
            <div className={styles.empty}>No dependencies found for this symbol at current depth.</div>
          ) : (
            <div className={styles.treePanel}>
              <div className={styles.rootRow}>
                <div className={`${styles.node} ${styles.rootNode}`}>
                  <span className={styles.nodeName}>{tree.root.name}</span>
                  <span className={styles.nodeType}>{tree.root.type}</span>
                </div>
              </div>
              <ul className={styles.branchList}>
                {tree.root.children.map((child) => (
                  <TreeBranch key={child.key} node={child} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
