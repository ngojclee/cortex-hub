'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

import DashboardLayout from '@/components/layout/DashboardLayout'
import { deleteMemory, getAllProjects, getMemories } from '@/lib/api'
import type { AgentMemory, Project } from '@/lib/api'
import styles from './Memories.module.css'

type NormalizedMemory = {
  id: string
  text: string
  agentId: string
  userId: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string | null
  metadata: Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function extractMessagePreview(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const content = asString((message as { content?: unknown }).content)
    if (content) return content
  }

  return null
}

function normalizeMemory(record: AgentMemory): NormalizedMemory {
  const payload = record.payload ?? {}
  const metadata = payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata
    : {}

  const userId = asString(payload.userId) ?? asString(payload.user_id)
  const derivedProjectId = userId?.startsWith('project-') ? userId.slice('project-'.length) : null

  return {
    id: record.id,
    text:
      asString(payload.memory) ??
      asString(payload.content) ??
      extractMessagePreview(payload.messages) ??
      '[No memory text]',
    agentId: asString(payload.agentId) ?? asString(payload.agent_id) ?? 'AI Agent',
    userId,
    projectId:
      asString(payload.project_id) ??
      asString(metadata.project_id) ??
      derivedProjectId ??
      null,
    createdAt: asString(payload.createdAt) ?? asString(payload.created_at) ?? '',
    updatedAt: asString(payload.updatedAt) ?? asString(payload.updated_at),
    metadata,
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return date.toLocaleString()
}

function needsExpansion(text: string): boolean {
  return text.length > 220 || text.split('\n').length > 4
}

export default function MemoriesPage() {
  const [search, setSearch] = useState('')
  const [selectedProject, setSelectedProject] = useState('all')
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const projectFilter = selectedProject !== 'all' ? selectedProject : undefined

  const { data, error, mutate, isLoading } = useSWR(
    ['memories', projectFilter],
    ([, projectId]) => getMemories(projectId, 100),
    { refreshInterval: 5000 },
  )

  const { data: projectsData } = useSWR('projects', getAllProjects)

  const projects = projectsData?.projects ?? []

  const projectNameById = useMemo(() => {
    return new Map(projects.map((project: Project) => [project.id, project.name]))
  }, [projects])

  const normalizedMemories = useMemo(
    () => (data?.memories ?? []).map(normalizeMemory),
    [data],
  )

  const filteredMemories = useMemo(() => {
    const query = search.trim().toLowerCase()

    return normalizedMemories.filter((memory) => {
      if (selectedProject !== 'all' && memory.projectId !== selectedProject) {
        return false
      }

      if (!query) return true

      const haystack = [
        memory.text,
        memory.agentId,
        memory.userId,
        memory.projectId,
        projectNameById.get(memory.projectId ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [normalizedMemories, projectNameById, search, selectedProject])

  const stats = useMemo(() => {
    const projectIds = new Set(filteredMemories.map((memory) => memory.projectId).filter(Boolean))
    const agentIds = new Set(filteredMemories.map((memory) => memory.agentId).filter(Boolean))

    return {
      total: normalizedMemories.length,
      visible: filteredMemories.length,
      projects: projectIds.size,
      agents: agentIds.size,
    }
  }, [filteredMemories, normalizedMemories.length])

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

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }, [])

  return (
    <DashboardLayout
      title="Memories"
      subtitle="Long-lived facts, preferences, and project context extracted for AI agents"
    >
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>Loaded</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.visible}</span>
          <span className={styles.statLabel}>Visible</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.projects}</span>
          <span className={styles.statLabel}>Projects</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.agents}</span>
          <span className={styles.statLabel}>Agents</span>
        </div>
      </div>

      <div className={styles.actionBar}>
        <div className={styles.filters}>
          <select
            className={styles.filterSelect}
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              type="text"
              placeholder="Search memory text, agent, user, project..."
              className={styles.searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className={styles.resultsHint}>
          Showing the latest {normalizedMemories.length} memory records
        </div>
      </div>

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
      ) : filteredMemories.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🧠</div>
          <h3>No Memories Found</h3>
          <p>
            No memory matches this filter yet. Once agents store facts and preferences, they will show up here.
          </p>
        </div>
      ) : (
        <div className={styles.memoryList}>
          {filteredMemories.map((memory) => {
            const isExpanded = Boolean(expanded[memory.id])
            const showExpand = needsExpansion(memory.text)
            const projectName = memory.projectId ? projectNameById.get(memory.projectId) : null

            return (
              <article key={memory.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTags}>
                    <span className={styles.agentTag}>{memory.agentId}</span>
                    {memory.projectId && (
                      <span className={styles.projectTag}>
                        {projectName ?? memory.projectId}
                      </span>
                    )}
                  </div>
                  <span className={styles.date}>{formatDate(memory.createdAt)}</span>
                </div>

                <p className={isExpanded ? styles.contentExpanded : styles.content}>
                  {memory.text}
                </p>

                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Project</span>
                    <span className={styles.metaValue}>{memory.projectId ?? 'Global'}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>User Scope</span>
                    <span className={styles.metaValue}>{memory.userId ?? 'Unknown'}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Updated</span>
                    <span className={styles.metaValue}>{formatDate(memory.updatedAt)}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Memory ID</span>
                    <span className={styles.metaValue} title={memory.id}>{memory.id.slice(0, 8)}...</span>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <div className={styles.cardActions}>
                    {showExpand && (
                      <button
                        type="button"
                        className={styles.expandBtn}
                        onClick={() => toggleExpanded(memory.id)}
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>

                  <button
                    className={`${styles.deleteBtn} ${isDeleting === memory.id ? styles.deleting : ''}`}
                    onClick={() => handleDelete(memory.id)}
                    disabled={isDeleting === memory.id}
                    title="Delete memory"
                  >
                    <span className={styles.deleteIcon}>🗑</span>
                    Delete
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
