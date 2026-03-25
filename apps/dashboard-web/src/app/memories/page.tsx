'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { getMemories, deleteMemory } from '@/lib/api'
import type { AgentMemory } from '@/lib/api'
import styles from './Memories.module.css'

export default function MemoriesPage() {
  const [projectId, setProjectId] = useState('')
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  const { data, error, mutate, isLoading } = useSWR(
    ['memories', projectId],
    ([_, pid]) => getMemories(pid, 100),
    { refreshInterval: 5000 }
  )

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this memory? It cannot be undone.')) return

    setIsDeleting(id)
    try {
      await deleteMemory(id)
      await mutate()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete memory')
    } finally {
      setIsDeleting(null)
    }
  }, [mutate])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown'
    const date = new Date(dateStr)
    return date.toLocaleString()
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Semantic Memories</h1>
          <p className={styles.subtitle}>
            Browse conversational context and patterns stored by AI agents.
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder="Filter by Project ID (exact slug)"
              className={styles.searchInput}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
          </div>
        </div>
      </header>

      {error ? (
        <div className="panel error">
          Failed to load memories: {error.message}
        </div>
      ) : isLoading && !data ? (
        <div className="panel">
          <div className="loading-spinner"></div>
          <p style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--text-dim)' }}>
            Loading memories...
          </p>
        </div>
      ) : data?.memories.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🧠</div>
          <h3>No Memories Found</h3>
          <p>AI agents have not stored any semantic memories yet.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {data?.memories.map((memory: AgentMemory) => (
            <div key={memory.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.agentTag}>
                  <span className={styles.agentIcon}>🤖</span>
                  {memory.payload.agentId || 'AI Agent'}
                </div>
                {memory.payload.project_id && (
                  <div className={styles.projectTag}>
                    {memory.payload.project_id}
                  </div>
                )}
              </div>
              
              <div className={styles.cardBody}>
                <p className={styles.content}>{memory.payload.content}</p>
              </div>

              <div className={styles.cardFooter}>
                <span className={styles.date}>
                  {formatDate(memory.payload.createdAt)}
                </span>
                <button
                  className={`${styles.deleteBtn} ${isDeleting === memory.id ? styles.deleting : ''}`}
                  onClick={() => handleDelete(memory.id)}
                  disabled={isDeleting === memory.id}
                  title="Delete memory"
                >
                  <span className={styles.deleteIcon}>🗑</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
