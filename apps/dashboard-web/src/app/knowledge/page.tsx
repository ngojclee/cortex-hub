'use client'

import { useState, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import ThemedSelect from '@/components/ui/ThemedSelect'
import useSWR from 'swr'
import {
  getKnowledgeDocuments,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeTags,
  getAllProjects,
  type KnowledgeDocument,
  type Project,
} from '@/lib/api'
import styles from './page.module.css'

// ── Create Dialog ──
function CreateDocumentDialog({
  projects,
  onSubmit,
  onCancel,
}: {
  projects: Project[]
  onSubmit: (data: { title: string; content: string; tags: string[]; projectId?: string }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [projectId, setProjectId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = title.trim().length > 0 && content.trim().length > 0

  async function handleSubmit() {
    setSubmitting(true)
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
    onSubmit({
      title: title.trim(),
      content: content.trim(),
      tags,
      projectId: projectId || undefined,
    })
  }

  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.dialogTitle}>New Knowledge Document</h3>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Project</label>
          <ThemedSelect
            className={styles.dialogInput}
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: '', label: 'Global (no project)' },
              ...projects.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Title</label>
          <input
            className={styles.dialogInput}
            placeholder="e.g. Deployment checklist for Cloudflare"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Content</label>
          <textarea
            className={styles.dialogTextarea}
            placeholder="Write the knowledge content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Tags (comma-separated)</label>
          <input
            className={styles.dialogInput}
            placeholder="e.g. typescript, deployment, patterns"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
        </div>

        <div className={styles.dialogActions}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? 'Creating...' : 'Create Document'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Document Card ──
function DocumentCard({
  doc,
  onDelete,
  showProject,
  projectName,
}: {
  doc: KnowledgeDocument
  onDelete: (id: string) => void
  showProject?: boolean
  projectName?: string
}) {
  const [confirming, setConfirming] = useState(false)
  let tags: string[] = []
  try { tags = JSON.parse(doc.tags) as string[] } catch { /* ignore */ }

  return (
    <div className={styles.docCard}>
      <div className={styles.docHeader}>
        <h4 className={styles.docTitle}>{doc.title}</h4>
        <div className={styles.docMeta}>
          {showProject && projectName && (
            <span className={styles.docProject}>{projectName}</span>
          )}
          <span className={styles.docSource}>{doc.source}</span>
          {doc.source_agent_id && (
            <span className={styles.docAgent}>{doc.source_agent_id}</span>
          )}
        </div>
      </div>

      {doc.content_preview && (
        <p className={styles.docPreview}>{doc.content_preview}</p>
      )}

      <div className={styles.docFooter}>
        <div className={styles.docTags}>
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>

        <div className={styles.docStats}>
          <span title="Chunks">{doc.chunk_count} chunks</span>
          <span title="Search hits">{doc.hit_count} hits</span>
          <span title="Created">{new Date(doc.created_at).toLocaleDateString()}</span>
        </div>

        <div className={styles.docActions}>
          {confirming ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--danger)', color: '#fff' }}
                onClick={() => onDelete(doc.id)}
              >
                Confirm Delete
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(true)}>Delete</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Project Section ──
function ProjectSection({
  projectName,
  projectId,
  docs,
  onDelete,
  defaultExpanded,
}: {
  projectName: string
  projectId: string | null
  docs: KnowledgeDocument[]
  onDelete: (id: string) => void
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={styles.projectSection}>
      <button className={styles.projectHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.projectToggle}>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className={styles.projectIcon}>{projectId ? '\uD83D\uDCC1' : '\uD83C\uDF10'}</span>
        <span className={styles.projectName}>{projectName}</span>
        <span className={styles.projectCount}>{docs.length} doc{docs.length !== 1 ? 's' : ''}</span>
      </button>

      {expanded && (
        <div className={styles.projectDocs}>
          {docs.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──
export default function KnowledgePage() {
  const [showCreate, setShowCreate] = useState(false)
  const [filterTag, setFilterTag] = useState('')
  const [filterProject, setFilterProject] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped')

  const { data, error, isLoading, mutate } = useSWR(
    `knowledge-${filterTag}-${filterProject}`,
    () => getKnowledgeDocuments({
      tag: filterTag || undefined,
      projectId: filterProject !== 'all' ? (filterProject === 'global' ? undefined : filterProject) : undefined,
    }),
    { refreshInterval: 15000 }
  )

  const { data: tagsData } = useSWR('knowledge-tags', getKnowledgeTags)
  const { data: projectsData } = useSWR('all-projects', getAllProjects)

  const projects = projectsData?.projects ?? []
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )
  const projectMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of sortedProjects) {
      map.set(p.id, p.name)
      map.set(p.slug, p.name)
    }
    return map
  }, [sortedProjects])

  // Group documents by project
  const grouped = useMemo(() => {
    const docs = data?.documents ?? []
    const groups = new Map<string, { name: string; projectId: string | null; docs: KnowledgeDocument[] }>()

    for (const doc of docs) {
      const pid = doc.project_id
      const key = pid ?? '__global__'

      if (!groups.has(key)) {
        groups.set(key, {
          name: pid ? (projectMap.get(pid) ?? pid) : 'Global Knowledge',
          projectId: pid,
          docs: [],
        })
      }
      groups.get(key)?.docs.push(doc)
    }

    // Sort: global first, then alphabetical
    const sorted = [...groups.values()].sort((a, b) => {
      if (!a.projectId) return -1
      if (!b.projectId) return 1
      return a.name.localeCompare(b.name)
    })

    return sorted
  }, [data?.documents, projectMap])

  // Flat list for flat view
  const allDocs = data?.documents ?? []

  // Stats per project
  const projectStats = useMemo(() => {
    return grouped.map(g => ({
      name: g.name,
      projectId: g.projectId,
      count: g.docs.length,
      chunks: g.docs.reduce((s, d) => s + d.chunk_count, 0),
      hits: g.docs.reduce((s, d) => s + d.hit_count, 0),
    }))
  }, [grouped])

  async function handleCreate(input: { title: string; content: string; tags: string[]; projectId?: string }) {
    try {
      await createKnowledgeDocument(input)
      setShowCreate(false)
      mutate()
    } catch (err) {
      alert(`Failed to create: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteKnowledgeDocument(id)
      mutate()
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const stats = data?.stats

  return (
    <DashboardLayout title="Knowledge Base" subtitle="Shared knowledge organized by project">
      {/* Stats Row */}
      {stats && (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.totalDocs}</span>
            <span className={styles.statLabel}>Documents</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.totalChunks}</span>
            <span className={styles.statLabel}>Chunks</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{stats.totalHits}</span>
            <span className={styles.statLabel}>Search Hits</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{grouped.length}</span>
            <span className={styles.statLabel}>Projects</span>
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className={styles.actionBar}>
        <div className={styles.filters}>
          {/* Project filter */}
          <ThemedSelect
            className={styles.filterSelect}
            value={filterProject}
            onChange={setFilterProject}
            options={[
              { value: 'all', label: 'All projects' },
              { value: 'global', label: 'Global only' },
              ...sortedProjects.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />

          {/* Tag filter */}
          <ThemedSelect
            className={styles.filterSelect}
            value={filterTag}
            onChange={setFilterTag}
            options={[
              { value: '', label: 'All tags' },
              ...(tagsData?.tags ?? []).map((tag) => ({ value: tag, label: tag })),
            ]}
          />

          {/* View mode toggle */}
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'grouped' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('grouped')}
              title="Group by project"
            >
              Grouped
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'flat' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('flat')}
              title="Flat list"
            >
              Flat
            </button>
          </div>
        </div>

        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          + New Document
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.errorBanner}>
          Failed to load knowledge documents. Is the API running?
        </div>
      )}

      {/* Loading */}
      {isLoading && !data && (
        <div className={styles.loading}>Loading knowledge base...</div>
      )}

      {/* Content */}
      {allDocs.length === 0 && !isLoading ? (
        <div className={styles.emptyState}>
          <p>No knowledge documents yet.</p>
          <p>
            Create one manually or use <code>cortex_knowledge_store</code> from an AI agent.
          </p>
        </div>
      ) : viewMode === 'grouped' ? (
        /* Grouped View */
        <div className={styles.groupedList}>
          {/* Project summary bar */}
          {projectStats.length > 1 && (
            <div className={styles.projectSummary}>
              {projectStats.map((ps) => (
                <button
                  key={ps.projectId ?? 'global'}
                  className={styles.projectPill}
                  onClick={() => setFilterProject(ps.projectId ?? 'global')}
                  title={`${ps.count} docs, ${ps.chunks} chunks, ${ps.hits} hits`}
                >
                  <span className={styles.pillIcon}>{ps.projectId ? '\uD83D\uDCC1' : '\uD83C\uDF10'}</span>
                  <span className={styles.pillName}>{ps.name}</span>
                  <span className={styles.pillCount}>{ps.count}</span>
                </button>
              ))}
            </div>
          )}

          {grouped.map((group) => (
            <ProjectSection
              key={group.projectId ?? '__global__'}
              projectName={group.name}
              projectId={group.projectId}
              docs={group.docs}
              onDelete={handleDelete}
              defaultExpanded={grouped.length <= 3}
            />
          ))}
        </div>
      ) : (
        /* Flat View */
        <div className={styles.docList}>
          {allDocs.map((doc: KnowledgeDocument) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onDelete={handleDelete}
              showProject
              projectName={doc.project_id ? (projectMap.get(doc.project_id) ?? doc.project_id) : 'Global'}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <CreateDocumentDialog
          projects={sortedProjects}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </DashboardLayout>
  )
}
