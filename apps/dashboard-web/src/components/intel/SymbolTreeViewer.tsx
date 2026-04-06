'use client'

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

export default function SymbolTreeViewer({ symbolName, treeData, onClose }: SymbolTreeViewerProps) {
  const paths = treeData?.data?.results || []

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.titleInfo}>
            <span className={styles.kicker}>Symbol Dependency</span>
            <h2 className={styles.title}>{symbolName}</h2>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className={styles.content}>
          {paths.length === 0 ? (
            <div className={styles.empty}>No dependencies found for this symbol at current depth.</div>
          ) : (
            <div className={styles.treeGrid}>
              {paths.map((pathObj: TreePath, pIdx: number) => {
                const segments = pathObj.path?.[0]?.segments || []
                return (
                  <div key={`path-${pIdx}`} className={styles.pathRow}>
                    <div className={styles.pathDots}>
                      {segments.map((seg: PathSegment, sIdx: number) => (
                        <div key={`seg-${sIdx}`} className={styles.segment}>
                          <div className={styles.node}>
                            <span className={styles.nodeName}>{(seg?.start?.properties?.name as string) ?? 'unknown'}</span>
                            <span className={styles.nodeType}>{seg?.start?.labels?.[0] ?? 'Symbol'}</span>
                          </div>
                          <div className={styles.edge}>
                            <span className={styles.edgeType}>{seg?.relationship?.type ?? 'DEPENDS_ON'}</span>
                            <div className={styles.edgeLine} />
                          </div>
                          {sIdx === segments.length - 1 && (
                            <div className={styles.node}>
                              <span className={styles.nodeName}>{(seg?.end?.properties?.name as string) ?? 'unknown'}</span>
                              <span className={styles.nodeType}>{seg?.end?.labels?.[0] ?? 'Symbol'}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
