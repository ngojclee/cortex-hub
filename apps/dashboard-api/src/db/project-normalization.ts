import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

type OrgRow = {
  id: string
  name: string
  slug: string
  description: string | null
}

type ProjectRow = {
  id: string
  org_id: string
  name: string
  slug: string
  description: string | null
  git_repo_url: string | null
}

type SessionRow = {
  id: string
  project: string
  project_id: string | null
  context: string | null
  shared_metadata: string | null
}

type QualityReportRow = {
  id: string
  project_id: string | null
  session_id: string | null
  shared_metadata: string | null
}

type QueryLogRow = {
  id: number
  project_id: string | null
  shared_metadata: string | null
}

type TableInfo = {
  name: string
  sql: string | null
}

type ForeignKeyRow = {
  table: string
  from: string
  to: string
}

type IndexInfo = {
  table: string
  name: string
  unique: boolean
  origin: string
  partial: boolean
  columns: string[]
}

type ProjectResolution = {
  projectId: string
  slug: string
  reason: string
}

type ProjectCandidate = {
  raw: string
  strength: 'strong' | 'medium'
  label: string
}

type ProjectCreationPlan = {
  id: string
  orgId: string
  name: string
  slug: string
  gitRepoUrl: string | null
  reason: string
}

type ProjectRelinkPlan = {
  projectId: string
  fromOrgId: string | null
  toOrgId: string
}

type SessionAction =
  | {
    id: string
    action: 'delete'
    reason: string
    originalProjectId: string | null
  }
  | {
    id: string
    action: 'update'
    reason: string
    resolvedProjectId: string
    originalProjectId: string | null
    nextContext: string | null
    nextSharedMetadata: string | null
  }
  | {
    id: string
    action: 'noop'
    reason: string
    resolvedProjectId: string
  }

type QualityReportAction =
  | {
    id: string
    action: 'update'
    reason: string
    originalProjectId: string | null
    resolvedProjectId: string | null
    originalSessionId: string | null
    nextSessionId: string | null
    nextSharedMetadata: string | null
  }
  | {
    id: string
    action: 'noop'
    reason: string
    resolvedProjectId: string | null
  }

type QueryLogAction =
  | {
    id: number
    action: 'update'
    reason: string
    originalProjectId: string | null
    resolvedProjectId: string
    nextSharedMetadata: string | null
  }
  | {
    id: number
    action: 'noop'
    reason: string
    resolvedProjectId: string | null
  }

type DuplicateIndexPlan = {
  keep: string
  drop: string[]
}

type SchemaAudit = {
  tables: TableInfo[]
  foreignKeys: Map<string, ForeignKeyRow[]>
  orphanTables: string[]
  indexes: IndexInfo[]
  duplicateIndexes: DuplicateIndexPlan[]
  integrityCheck: string[]
  foreignKeyCheck: Array<Record<string, unknown>>
}

type DataAudit = {
  organizationCount: number
  projectCount: number
  sessions: {
    total: number
    missingProjectId: number
    invalidProjectId: number
  }
  reports: {
    total: number
    missingProjectId: number
    invalidProjectId: number
    brokenSessionLink: number
  }
  logs: {
    total: number
    missingProjectId: number
    invalidProjectId: number
  }
}

type NormalizationPlan = {
  defaultOrg: {
    created: boolean
    org: OrgRow
  }
  createdProjects: ProjectCreationPlan[]
  projectRelinks: ProjectRelinkPlan[]
  sessionActions: SessionAction[]
  qualityActions: QualityReportAction[]
  queryLogActions: QueryLogAction[]
  recommendedIndexesMissing: string[]
  duplicateIndexes: DuplicateIndexPlan[]
  unresolvedReports: string[]
  unresolvedLogs: number[]
}

type MutableParsedObject = Record<string, unknown>

const RECOMMENDED_INDEXES = [
  {
    name: 'idx_projects_slug',
    table: 'projects',
    sql: 'CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)',
  },
  {
    name: 'idx_projects_git_repo_url',
    table: 'projects',
    sql: 'CREATE INDEX IF NOT EXISTS idx_projects_git_repo_url ON projects(git_repo_url)',
  },
  {
    name: 'idx_query_logs_project_created',
    table: 'query_logs',
    sql: 'CREATE INDEX IF NOT EXISTS idx_query_logs_project_created ON query_logs(project_id, created_at DESC)',
  },
  {
    name: 'idx_query_logs_agent_created',
    table: 'query_logs',
    sql: 'CREATE INDEX IF NOT EXISTS idx_query_logs_agent_created ON query_logs(agent_id, created_at DESC)',
  },
  {
    name: 'idx_session_handoffs_project_created',
    table: 'session_handoffs',
    sql: 'CREATE INDEX IF NOT EXISTS idx_session_handoffs_project_created ON session_handoffs(project_id, created_at DESC)',
  },
  {
    name: 'idx_session_handoffs_status_created',
    table: 'session_handoffs',
    sql: 'CREATE INDEX IF NOT EXISTS idx_session_handoffs_status_created ON session_handoffs(status, created_at DESC)',
  },
  {
    name: 'idx_session_handoffs_agent_status_created',
    table: 'session_handoffs',
    sql: 'CREATE INDEX IF NOT EXISTS idx_session_handoffs_agent_status_created ON session_handoffs(from_agent, status, created_at DESC)',
  },
]

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function looksLikeRepo(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.includes(':')
}

function normalizeRepoUrl(value: string | null | undefined): string | null {
  const raw = asNonEmptyString(value)
  if (!raw) return null

  const normalized = raw
    .replace(/\\/g, '/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase()

  return normalized || null
}

function toSlug(value: string | null | undefined): string | null {
  const raw = asNonEmptyString(value)
  if (!raw) return null

  const base = looksLikeRepo(raw)
    ? basename(raw.replace(/\\/g, '/').replace(/\/+$/g, '')).replace(/\.git$/i, '')
    : raw

  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || null
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function safeParseObject(raw: string | null | undefined): MutableParsedObject | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as MutableParsedObject
      : null
  } catch {
    return null
  }
}

function stringifyIfChanged(
  original: string | null | undefined,
  parsed: MutableParsedObject | null,
): string | null {
  if (!parsed) return original ?? null
  const next = JSON.stringify(parsed)
  return next === (original ?? null) ? (original ?? null) : next
}

function ensureMetadataProjectId(raw: string | null, projectId: string | null): string | null {
  const parsed = safeParseObject(raw)
  if (!parsed || !projectId) return raw

  if (parsed.projectId === projectId && !('project_id' in parsed)) return raw

  parsed.projectId = projectId
  delete parsed.project_id
  return stringifyIfChanged(raw, parsed)
}

function ensureContextProjectId(raw: string | null, projectId: string | null): string | null {
  const parsed = safeParseObject(raw)
  if (!parsed || !projectId) return raw

  if (parsed.projectId === projectId) return raw

  parsed.projectId = projectId
  return stringifyIfChanged(raw, parsed)
}

function resolveDbPath(explicitPath: string | undefined): string {
  const candidates = [
    explicitPath ?? null,
    process.env.DATABASE_PATH ?? null,
    '/home/Docker/cortex-hub/api-data/cortex.db',
    join(process.cwd(), 'data', 'cortex.db'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const existing = candidates.find((candidate) => existsSync(candidate))
  return existing ?? candidates[0]!
}

class ProjectDirectory {
  private readonly orgById = new Map<string, OrgRow>()
  private readonly projectById = new Map<string, ProjectRow>()
  private readonly projectBySlug = new Map<string, ProjectRow>()
  private readonly projectByRepo = new Map<string, ProjectRow>()
  private defaultOrg: OrgRow | null = null

  constructor(orgs: OrgRow[], projects: ProjectRow[]) {
    for (const org of orgs) {
      this.orgById.set(org.id, org)
      const slug = org.slug.toLowerCase()
      if (!this.defaultOrg && (slug === 'default' || slug === 'personal' || org.id === 'org-default')) {
        this.defaultOrg = org
      }
    }

    for (const project of projects) {
      this.addProject(project)
    }

    if (!this.defaultOrg && orgs.length > 0) {
      this.defaultOrg = orgs[0]!
    }
  }

  getOrganizations(): OrgRow[] {
    return Array.from(this.orgById.values())
  }

  getProjects(): ProjectRow[] {
    return Array.from(this.projectById.values())
  }

  getDefaultOrg(): { created: boolean; org: OrgRow } {
    if (this.defaultOrg) {
      return { created: false, org: this.defaultOrg }
    }

    const org: OrgRow = {
      id: 'org-default',
      name: 'Default',
      slug: 'default',
      description: 'Auto-created during project normalization',
    }
    this.orgById.set(org.id, org)
    this.defaultOrg = org
    return { created: true, org }
  }

  getOrg(id: string | null | undefined): OrgRow | null {
    if (!id) return null
    return this.orgById.get(id) ?? null
  }

  addProject(project: ProjectRow): void {
    this.projectById.set(project.id, project)
    this.projectBySlug.set(project.slug.toLowerCase(), project)

    const repo = normalizeRepoUrl(project.git_repo_url)
    if (repo) {
      this.projectByRepo.set(repo, project)
    }
  }

  resolve(raw: string | null | undefined): ProjectResolution | null {
    const value = asNonEmptyString(raw)
    if (!value) return null

    const byId = this.projectById.get(value)
    if (byId) {
      return { projectId: byId.id, slug: byId.slug, reason: 'project id' }
    }

    const slug = toSlug(value)
    if (slug) {
      const bySlug = this.projectBySlug.get(slug)
      if (bySlug) {
        return { projectId: bySlug.id, slug: bySlug.slug, reason: 'project slug' }
      }
    }

    const repo = normalizeRepoUrl(value)
    if (repo) {
      const byRepo = this.projectByRepo.get(repo)
      if (byRepo) {
        return { projectId: byRepo.id, slug: byRepo.slug, reason: 'git repo url' }
      }
    }

    return null
  }

  planProjectCreation(raw: string, reason: string): ProjectCreationPlan | null {
    const slug = toSlug(raw)
    if (!slug) return null

    const existing = this.projectBySlug.get(slug)
    if (existing) {
      return null
    }

    const { org } = this.getDefaultOrg()
    const normalizedRepo = looksLikeRepo(raw) ? normalizeRepoUrl(raw) : null

    const plan: ProjectCreationPlan = {
      id: `proj-${randomUUID().slice(0, 8)}`,
      orgId: org.id,
      name: humanizeSlug(slug),
      slug,
      gitRepoUrl: normalizedRepo,
      reason,
    }

    this.addProject({
      id: plan.id,
      org_id: plan.orgId,
      name: plan.name,
      slug: plan.slug,
      description: null,
      git_repo_url: plan.gitRepoUrl,
    })

    return plan
  }
}

function getTables(db: Database.Database): TableInfo[] {
  return db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as TableInfo[]
}

function getForeignKeys(db: Database.Database, table: string): ForeignKeyRow[] {
  return db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all() as ForeignKeyRow[]
}

function getIndexes(db: Database.Database, table: string): IndexInfo[] {
  const list = db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all() as Array<{
    name: string
    unique: number
    origin: string
    partial: number
  }>

  return list.map((entry) => {
    const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(entry.name)})`).all() as Array<{
      name: string
    }>

    return {
      table,
      name: entry.name,
      unique: entry.unique === 1,
      origin: entry.origin,
      partial: entry.partial === 1,
      columns: columns.map((column) => column.name),
    }
  })
}

function buildDuplicateIndexPlans(indexes: IndexInfo[]): DuplicateIndexPlan[] {
  const grouped = new Map<string, IndexInfo[]>()

  for (const index of indexes) {
    if (index.origin !== 'c') continue
    const signature = [
      index.table,
      index.unique ? 'unique' : 'nonunique',
      index.partial ? 'partial' : 'full',
      index.columns.join(','),
    ].join('|')

    const existing = grouped.get(signature) ?? []
    existing.push(index)
    grouped.set(signature, existing)
  }

  const plans: DuplicateIndexPlan[] = []

  for (const group of grouped.values()) {
    if (group.length < 2) continue

    const sorted = [...group].sort((left, right) => left.name.localeCompare(right.name))
    plans.push({
      keep: sorted[0]!.name,
      drop: sorted.slice(1).map((entry) => entry.name),
    })
  }

  return plans
}

function auditSchema(db: Database.Database): SchemaAudit {
  const tables = getTables(db)
  const foreignKeys = new Map<string, ForeignKeyRow[]>()
  const inboundCounts = new Map<string, number>()
  const indexes: IndexInfo[] = []

  for (const table of tables) {
    const rows = getForeignKeys(db, table.name)
    foreignKeys.set(table.name, rows)
    indexes.push(...getIndexes(db, table.name))

    for (const row of rows) {
      inboundCounts.set(row.table, (inboundCounts.get(row.table) ?? 0) + 1)
    }
  }

  const orphanTables = tables
    .filter((table) => (foreignKeys.get(table.name)?.length ?? 0) === 0 && (inboundCounts.get(table.name) ?? 0) === 0)
    .map((table) => table.name)

  const integrityCheck = (db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>)
    .map((row) => row.integrity_check)

  const foreignKeyCheck = db.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>

  return {
    tables,
    foreignKeys,
    orphanTables,
    indexes,
    duplicateIndexes: buildDuplicateIndexPlans(indexes),
    integrityCheck,
    foreignKeyCheck,
  }
}

function loadOrganizations(db: Database.Database): OrgRow[] {
  return db.prepare('SELECT id, name, slug, description FROM organizations ORDER BY created_at ASC').all() as OrgRow[]
}

function loadProjects(db: Database.Database): ProjectRow[] {
  return db.prepare(`
    SELECT id, org_id, name, slug, description, git_repo_url
    FROM projects
    ORDER BY created_at ASC
  `).all() as ProjectRow[]
}

function auditData(
  db: Database.Database,
  projectDirectory: ProjectDirectory,
): DataAudit {
  const organizationCount = (db.prepare('SELECT COUNT(*) AS count FROM organizations').get() as { count: number }).count
  const projectCount = (db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }).count
  const sessions = db.prepare(`
    SELECT id, project_id
    FROM session_handoffs
  `).all() as Array<{ id: string; project_id: string | null }>

  const reports = db.prepare(`
    SELECT qr.id, qr.project_id, qr.session_id
    FROM quality_reports qr
    LEFT JOIN session_handoffs sh ON sh.id = qr.session_id
  `).all() as Array<{ id: string; project_id: string | null; session_id: string | null }>

  const reportBrokenLinks = db.prepare(`
    SELECT COUNT(*) AS count
    FROM quality_reports qr
    LEFT JOIN session_handoffs sh ON sh.id = qr.session_id
    WHERE qr.session_id IS NOT NULL AND sh.id IS NULL
  `).get() as { count: number }

  const logs = db.prepare(`
    SELECT id, project_id
    FROM query_logs
  `).all() as Array<{ id: number; project_id: string | null }>

  const countInvalid = (rows: Array<{ project_id: string | null }>): { missing: number; invalid: number } => {
    let missing = 0
    let invalid = 0

    for (const row of rows) {
      const raw = asNonEmptyString(row.project_id)
      if (!raw) {
        missing += 1
        continue
      }

      if (!projectDirectory.resolve(raw)) {
        invalid += 1
      }
    }

    return { missing, invalid }
  }

  const sessionCounts = countInvalid(sessions)
  const reportCounts = countInvalid(reports)
  const logCounts = countInvalid(logs)

  return {
    organizationCount,
    projectCount,
    sessions: {
      total: sessions.length,
      missingProjectId: sessionCounts.missing,
      invalidProjectId: sessionCounts.invalid,
    },
    reports: {
      total: reports.length,
      missingProjectId: reportCounts.missing,
      invalidProjectId: reportCounts.invalid,
      brokenSessionLink: reportBrokenLinks.count,
    },
    logs: {
      total: logs.length,
      missingProjectId: logCounts.missing,
      invalidProjectId: logCounts.invalid,
    },
  }
}

function pickBestResolution(
  candidates: ProjectCandidate[],
  projectDirectory: ProjectDirectory,
): ProjectResolution | null {
  const ranked: Array<{ strength: number; resolution: ProjectResolution; label: string }> = []

  for (const candidate of candidates) {
    const resolution = projectDirectory.resolve(candidate.raw)
    if (!resolution) continue

    ranked.push({
      strength: candidate.strength === 'strong' ? 2 : 1,
      resolution,
      label: candidate.label,
    })
  }

  if (ranked.length === 0) return null

  ranked.sort((left, right) => right.strength - left.strength)
  return {
    ...ranked[0]!.resolution,
    reason: `${ranked[0]!.label} -> ${ranked[0]!.resolution.reason}`,
  }
}

function buildSessionCandidates(session: SessionRow): ProjectCandidate[] {
  const context = safeParseObject(session.context)
  const sharedMetadata = safeParseObject(session.shared_metadata)
  const candidates: ProjectCandidate[] = []

  const push = (raw: string | null | undefined, strength: 'strong' | 'medium', label: string) => {
    const value = asNonEmptyString(raw)
    if (!value) return
    candidates.push({ raw: value, strength, label })
  }

  push(session.project, 'strong', 'session.project')
  push(asNonEmptyString(context?.repo), 'strong', 'context.repo')
  push(session.project_id, 'medium', 'session.project_id')
  push(asNonEmptyString(context?.projectId), 'medium', 'context.projectId')
  push(asNonEmptyString(sharedMetadata?.projectId), 'medium', 'shared_metadata.projectId')
  push(asNonEmptyString(sharedMetadata?.project_id), 'medium', 'shared_metadata.project_id')

  return candidates
}

function maybeCreateProjectForSession(
  session: SessionRow,
  projectDirectory: ProjectDirectory,
): ProjectCreationPlan | null {
  const context = safeParseObject(session.context)
  const rawProject = asNonEmptyString(session.project)
  const rawRepo = asNonEmptyString(context?.repo)
  const rawProjectId = asNonEmptyString(session.project_id)

  const firstStrong = rawProject && rawProject !== 'unknown'
    ? rawProject
    : (rawRepo && rawRepo !== 'unknown' ? rawRepo : null)

  if (firstStrong) {
    return projectDirectory.planProjectCreation(firstStrong, `session ${session.id}`)
  }

  if (rawProjectId && rawProjectId !== 'unknown') {
    return projectDirectory.planProjectCreation(rawProjectId, `session ${session.id}`)
  }

  return null
}

function planSessionActions(
  db: Database.Database,
  projectDirectory: ProjectDirectory,
): {
  createdProjects: ProjectCreationPlan[]
  actions: SessionAction[]
  resolvedProjectIds: Map<string, string>
  deletedSessionIds: Set<string>
} {
  const sessions = db.prepare(`
    SELECT id, project, project_id, context, shared_metadata
    FROM session_handoffs
    ORDER BY created_at ASC
  `).all() as SessionRow[]

  const createdProjects: ProjectCreationPlan[] = []
  const actions: SessionAction[] = []
  const resolvedProjectIds = new Map<string, string>()
  const deletedSessionIds = new Set<string>()

  for (const session of sessions) {
    let resolution = pickBestResolution(buildSessionCandidates(session), projectDirectory)
    if (!resolution) {
      const created = maybeCreateProjectForSession(session, projectDirectory)
      if (created) {
        createdProjects.push(created)
        resolution = projectDirectory.resolve(created.id)
      }
    }

    if (!resolution) {
      actions.push({
        id: session.id,
        action: 'delete',
        reason: 'no valid project could be inferred from session.project, context, or shared_metadata',
        originalProjectId: session.project_id,
      })
      deletedSessionIds.add(session.id)
      continue
    }

    resolvedProjectIds.set(session.id, resolution.projectId)
    const nextSharedMetadata = ensureMetadataProjectId(session.shared_metadata, resolution.projectId)
    const nextContext = ensureContextProjectId(session.context, resolution.projectId)
    const currentProjectId = asNonEmptyString(session.project_id)
    const needsProjectIdUpdate = currentProjectId !== resolution.projectId
    const needsSharedMetadataUpdate = nextSharedMetadata !== session.shared_metadata
    const needsContextUpdate = nextContext !== session.context

    if (needsProjectIdUpdate || needsSharedMetadataUpdate || needsContextUpdate) {
      actions.push({
        id: session.id,
        action: 'update',
        reason: resolution.reason,
        resolvedProjectId: resolution.projectId,
        originalProjectId: session.project_id,
        nextContext,
        nextSharedMetadata,
      })
      continue
    }

    actions.push({
      id: session.id,
      action: 'noop',
      reason: resolution.reason,
      resolvedProjectId: resolution.projectId,
    })
  }

  return { createdProjects, actions, resolvedProjectIds, deletedSessionIds }
}

function buildQualityCandidates(report: QualityReportRow): ProjectCandidate[] {
  const sharedMetadata = safeParseObject(report.shared_metadata)
  const candidates: ProjectCandidate[] = []

  const push = (raw: string | null | undefined, strength: 'strong' | 'medium', label: string) => {
    const value = asNonEmptyString(raw)
    if (!value) return
    candidates.push({ raw: value, strength, label })
  }

  push(report.project_id, 'medium', 'quality_reports.project_id')
  push(asNonEmptyString(sharedMetadata?.projectId), 'medium', 'shared_metadata.projectId')
  push(asNonEmptyString(sharedMetadata?.project_id), 'medium', 'shared_metadata.project_id')
  return candidates
}

function planQualityActions(
  db: Database.Database,
  projectDirectory: ProjectDirectory,
  resolvedSessionProjects: Map<string, string>,
  deletedSessionIds: Set<string>,
): {
  actions: QualityReportAction[]
  unresolved: string[]
} {
  const reports = db.prepare(`
    SELECT id, project_id, session_id, shared_metadata
    FROM quality_reports
    ORDER BY created_at ASC
  `).all() as QualityReportRow[]

  const actions: QualityReportAction[] = []
  const unresolved: string[] = []

  for (const report of reports) {
    const referencedSessionId = asNonEmptyString(report.session_id)
    const sessionProjectId = referencedSessionId ? (resolvedSessionProjects.get(referencedSessionId) ?? null) : null
    const brokenSessionLink = referencedSessionId !== null && !resolvedSessionProjects.has(referencedSessionId)
    const resolution = sessionProjectId
      ? {
        projectId: sessionProjectId,
        slug: projectDirectory.resolve(sessionProjectId)?.slug ?? sessionProjectId,
        reason: 'session_id -> session_handoffs.project_id',
      }
      : pickBestResolution(buildQualityCandidates(report), projectDirectory)

    const nextSessionId = brokenSessionLink || (referencedSessionId && deletedSessionIds.has(referencedSessionId))
      ? null
      : referencedSessionId

    const nextSharedMetadata = ensureMetadataProjectId(report.shared_metadata, resolution?.projectId ?? null)
    const currentProjectId = asNonEmptyString(report.project_id)
    const nextProjectId = resolution?.projectId ?? null

    if (!resolution) {
      unresolved.push(report.id)
    }

    const needsProjectUpdate = currentProjectId !== nextProjectId
    const needsSessionUpdate = report.session_id !== nextSessionId
    const needsMetadataUpdate = nextSharedMetadata !== report.shared_metadata

    if (needsProjectUpdate || needsSessionUpdate || needsMetadataUpdate) {
      actions.push({
        id: report.id,
        action: 'update',
        reason: resolution?.reason ?? 'could not infer project; only clearing broken session linkage',
        originalProjectId: report.project_id,
        resolvedProjectId: nextProjectId,
        originalSessionId: report.session_id,
        nextSessionId,
        nextSharedMetadata,
      })
      continue
    }

    actions.push({
      id: report.id,
      action: 'noop',
      reason: resolution?.reason ?? 'no project inference available',
      resolvedProjectId: nextProjectId,
    })
  }

  return { actions, unresolved }
}

function buildQueryLogCandidates(log: QueryLogRow): ProjectCandidate[] {
  const sharedMetadata = safeParseObject(log.shared_metadata)
  const candidates: ProjectCandidate[] = []

  const push = (raw: string | null | undefined, label: string) => {
    const value = asNonEmptyString(raw)
    if (!value) return
    candidates.push({ raw: value, strength: 'medium', label })
  }

  push(log.project_id, 'query_logs.project_id')
  push(asNonEmptyString(sharedMetadata?.projectId), 'shared_metadata.projectId')
  push(asNonEmptyString(sharedMetadata?.project_id), 'shared_metadata.project_id')
  return candidates
}

function planQueryLogActions(
  db: Database.Database,
  projectDirectory: ProjectDirectory,
): {
  actions: QueryLogAction[]
  unresolved: number[]
} {
  const logs = db.prepare(`
    SELECT id, project_id, shared_metadata
    FROM query_logs
    ORDER BY id ASC
  `).all() as QueryLogRow[]

  const actions: QueryLogAction[] = []
  const unresolved: number[] = []

  for (const log of logs) {
    const resolution = pickBestResolution(buildQueryLogCandidates(log), projectDirectory)
    if (!resolution) {
      unresolved.push(log.id)
      actions.push({
        id: log.id,
        action: 'noop',
        reason: 'no project inference available',
        resolvedProjectId: null,
      })
      continue
    }

    const nextSharedMetadata = ensureMetadataProjectId(log.shared_metadata, resolution.projectId)
    const currentProjectId = asNonEmptyString(log.project_id)
    const needsProjectUpdate = currentProjectId !== resolution.projectId
    const needsMetadataUpdate = nextSharedMetadata !== log.shared_metadata

    if (needsProjectUpdate || needsMetadataUpdate) {
      actions.push({
        id: log.id,
        action: 'update',
        reason: resolution.reason,
        originalProjectId: log.project_id,
        resolvedProjectId: resolution.projectId,
        nextSharedMetadata,
      })
      continue
    }

    actions.push({
      id: log.id,
      action: 'noop',
      reason: resolution.reason,
      resolvedProjectId: resolution.projectId,
    })
  }

  return { actions, unresolved }
}

function planProjectRelinks(projectDirectory: ProjectDirectory): ProjectRelinkPlan[] {
  const defaultOrg = projectDirectory.getDefaultOrg().org
  const relinks: ProjectRelinkPlan[] = []

  for (const project of projectDirectory.getProjects()) {
    if (projectDirectory.getOrg(project.org_id)) continue
    relinks.push({
      projectId: project.id,
      fromOrgId: project.org_id,
      toOrgId: defaultOrg.id,
    })
    project.org_id = defaultOrg.id
  }

  return relinks
}

function buildNormalizationPlan(
  db: Database.Database,
  schemaAudit: SchemaAudit,
): {
  projectDirectory: ProjectDirectory
  plan: NormalizationPlan
} {
  const projectDirectory = new ProjectDirectory(loadOrganizations(db), loadProjects(db))
  const defaultOrg = projectDirectory.getDefaultOrg()
  const projectRelinks = planProjectRelinks(projectDirectory)
  const sessionPlan = planSessionActions(db, projectDirectory)
  const qualityPlan = planQualityActions(db, projectDirectory, sessionPlan.resolvedProjectIds, sessionPlan.deletedSessionIds)
  const queryLogPlan = planQueryLogActions(db, projectDirectory)
  const existingIndexNames = new Set(schemaAudit.indexes.map((index) => index.name))
  const recommendedIndexesMissing = RECOMMENDED_INDEXES
    .filter((index) => !existingIndexNames.has(index.name))
    .map((index) => index.name)

  return {
    projectDirectory,
    plan: {
      defaultOrg,
      createdProjects: sessionPlan.createdProjects,
      projectRelinks,
      sessionActions: sessionPlan.actions,
      qualityActions: qualityPlan.actions,
      queryLogActions: queryLogPlan.actions,
      recommendedIndexesMissing,
      duplicateIndexes: schemaAudit.duplicateIndexes,
      unresolvedReports: qualityPlan.unresolved,
      unresolvedLogs: queryLogPlan.unresolved,
    },
  }
}

function createBackup(db: Database.Database, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDir, `cortex-backup-${stamp}.db`)
  db.pragma('wal_checkpoint(FULL)')
  db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`)
  return backupPath
}

function applyNormalizationPlan(
  db: Database.Database,
  plan: NormalizationPlan,
): void {
  const run = db.transaction(() => {
    if (plan.defaultOrg.created) {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        plan.defaultOrg.org.id,
        plan.defaultOrg.org.name,
        plan.defaultOrg.org.slug,
        plan.defaultOrg.org.description,
      )
    }

    for (const createdProject of plan.createdProjects) {
      db.prepare(`
        INSERT OR IGNORE INTO projects (
          id, org_id, name, slug, description, git_repo_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        createdProject.id,
        createdProject.orgId,
        createdProject.name,
        createdProject.slug,
        `Auto-created during project normalization (${createdProject.reason})`,
        createdProject.gitRepoUrl,
      )
    }

    for (const relink of plan.projectRelinks) {
      db.prepare(`
        UPDATE projects
        SET org_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(relink.toOrgId, relink.projectId)
    }

    for (const action of plan.sessionActions) {
      if (action.action !== 'update') continue
      db.prepare(`
        UPDATE session_handoffs
        SET project_id = ?, context = ?, shared_metadata = ?
        WHERE id = ?
      `).run(
        action.resolvedProjectId,
        action.nextContext,
        action.nextSharedMetadata,
        action.id,
      )
    }

    for (const action of plan.qualityActions) {
      if (action.action !== 'update') continue
      db.prepare(`
        UPDATE quality_reports
        SET project_id = ?, session_id = ?, shared_metadata = ?
        WHERE id = ?
      `).run(
        action.resolvedProjectId,
        action.nextSessionId,
        action.nextSharedMetadata,
        action.id,
      )
    }

    for (const action of plan.queryLogActions) {
      if (action.action !== 'update') continue
      db.prepare(`
        UPDATE query_logs
        SET project_id = ?, shared_metadata = ?
        WHERE id = ?
      `).run(
        action.resolvedProjectId,
        action.nextSharedMetadata,
        action.id,
      )
    }

    for (const action of plan.sessionActions) {
      if (action.action !== 'delete') continue
      db.prepare('DELETE FROM session_handoffs WHERE id = ?').run(action.id)
    }

    for (const index of RECOMMENDED_INDEXES) {
      db.exec(index.sql)
    }

    for (const duplicate of plan.duplicateIndexes) {
      for (const indexName of duplicate.drop) {
        db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`)
      }
    }
  })

  run()
}

function printSchemaAudit(schemaAudit: SchemaAudit): void {
  console.log('\n== Schema ==')
  console.log(`Tables (${schemaAudit.tables.length}): ${schemaAudit.tables.map((table) => table.name).join(', ')}`)

  for (const table of schemaAudit.tables) {
    console.log(`\n[${table.name}]`)
    console.log(table.sql ?? '(no schema sql)')

    const foreignKeys = schemaAudit.foreignKeys.get(table.name) ?? []
    if (foreignKeys.length === 0) {
      console.log('Foreign keys: none')
    } else {
      for (const foreignKey of foreignKeys) {
        console.log(`Foreign key: ${foreignKey.from} -> ${foreignKey.table}.${foreignKey.to}`)
      }
    }
  }

  console.log(`\nTables without inbound/outbound foreign keys: ${schemaAudit.orphanTables.length > 0 ? schemaAudit.orphanTables.join(', ') : 'none'}`)
  console.log(`Integrity check: ${schemaAudit.integrityCheck.join(', ')}`)
  console.log(`Foreign key check rows: ${schemaAudit.foreignKeyCheck.length}`)
}

function printDataAudit(dataAudit: DataAudit): void {
  console.log('\n== Data Audit ==')
  console.log(`Organizations: ${dataAudit.organizationCount}`)
  console.log(`Projects: ${dataAudit.projectCount}`)
  console.log(`Sessions: total=${dataAudit.sessions.total}, missing project_id=${dataAudit.sessions.missingProjectId}, invalid project_id=${dataAudit.sessions.invalidProjectId}`)
  console.log(`Quality reports: total=${dataAudit.reports.total}, missing project_id=${dataAudit.reports.missingProjectId}, invalid project_id=${dataAudit.reports.invalidProjectId}, broken session_id=${dataAudit.reports.brokenSessionLink}`)
  console.log(`Query logs: total=${dataAudit.logs.total}, missing project_id=${dataAudit.logs.missingProjectId}, invalid project_id=${dataAudit.logs.invalidProjectId}`)
}

function countActions<T extends { action: string }>(actions: T[], action: string): number {
  return actions.filter((entry) => entry.action === action).length
}

function printNormalizationPlan(plan: NormalizationPlan): void {
  console.log('\n== Normalization Plan ==')
  console.log(`Default org: ${plan.defaultOrg.org.slug} (${plan.defaultOrg.org.id})${plan.defaultOrg.created ? ' [create]' : ''}`)
  console.log(`Projects to create: ${plan.createdProjects.length}`)
  for (const project of plan.createdProjects) {
    console.log(`  - ${project.slug} (${project.id}) from ${project.reason}${project.gitRepoUrl ? ` -> ${project.gitRepoUrl}` : ''}`)
  }

  console.log(`Projects with broken org links: ${plan.projectRelinks.length}`)
  for (const relink of plan.projectRelinks) {
    console.log(`  - ${relink.projectId}: ${relink.fromOrgId ?? 'null'} -> ${relink.toOrgId}`)
  }

  console.log(`Sessions: update=${countActions(plan.sessionActions, 'update')}, delete=${countActions(plan.sessionActions, 'delete')}, unchanged=${countActions(plan.sessionActions, 'noop')}`)
  for (const action of plan.sessionActions.filter((entry) => entry.action !== 'noop').slice(0, 20)) {
    if (action.action === 'delete') {
      console.log(`  - delete session ${action.id}: ${action.reason}`)
      continue
    }
    console.log(`  - update session ${action.id}: ${action.originalProjectId ?? 'null'} -> ${action.resolvedProjectId} (${action.reason})`)
  }

  console.log(`Quality reports: update=${countActions(plan.qualityActions, 'update')}, unchanged=${countActions(plan.qualityActions, 'noop')}`)
  for (const action of plan.qualityActions.filter((entry) => entry.action === 'update').slice(0, 20)) {
    console.log(`  - update report ${action.id}: project ${action.originalProjectId ?? 'null'} -> ${action.resolvedProjectId ?? 'null'}, session ${action.originalSessionId ?? 'null'} -> ${action.nextSessionId ?? 'null'} (${action.reason})`)
  }

  console.log(`Query logs: update=${countActions(plan.queryLogActions, 'update')}, unchanged=${countActions(plan.queryLogActions, 'noop')}`)
  for (const action of plan.queryLogActions.filter((entry) => entry.action === 'update').slice(0, 20)) {
    console.log(`  - update log ${action.id}: ${action.originalProjectId ?? 'null'} -> ${action.resolvedProjectId} (${action.reason})`)
  }

  console.log(`Missing recommended indexes: ${plan.recommendedIndexesMissing.length > 0 ? plan.recommendedIndexesMissing.join(', ') : 'none'}`)
  if (plan.duplicateIndexes.length > 0) {
    console.log('Duplicate indexes to drop:')
    for (const duplicate of plan.duplicateIndexes) {
      console.log(`  - keep ${duplicate.keep}; drop ${duplicate.drop.join(', ')}`)
    }
  } else {
    console.log('Duplicate indexes to drop: none')
  }

  console.log(`Unresolved quality reports after normalization: ${plan.unresolvedReports.length}`)
  console.log(`Unresolved query logs after normalization: ${plan.unresolvedLogs.length}`)
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm --filter @cortex/dashboard-api exec tsx src/db/project-normalization.ts [--db <path>] [--apply] [--backup-dir <dir>]

Options:
  --db <path>         Explicit SQLite file path.
  --apply             Apply UPDATE/DELETE/CREATE INDEX statements. Dry-run by default.
  --backup-dir <dir>  Directory for backup file when --apply is used.
  --help              Show this message.
`.trim())
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      apply: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      'backup-dir': { type: 'string' },
    },
    allowPositionals: false,
  })

  if (values.help) {
    printUsage()
    return
  }

  const dbPath = resolveDbPath(values.db)
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Pass --db with the live cortex.db path.`)
  }

  const apply = values.apply ?? false
  const backupDir = values['backup-dir'] ?? join(dirname(dbPath), 'backups')
  const db = new Database(dbPath)

  try {
    db.pragma('foreign_keys = ON')

    console.log(`Database: ${dbPath}`)
    console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`)

    const schemaAuditBefore = auditSchema(db)
    const { projectDirectory, plan } = buildNormalizationPlan(db, schemaAuditBefore)
    const dataAuditBefore = auditData(db, projectDirectory)

    printSchemaAudit(schemaAuditBefore)
    printDataAudit(dataAuditBefore)
    printNormalizationPlan(plan)

    if (!apply) {
      console.log('\nDry-run complete. Re-run with --apply to create a backup and execute the plan.')
      return
    }

    const backupPath = createBackup(db, backupDir)
    console.log(`\nBackup created: ${backupPath}`)

    applyNormalizationPlan(db, plan)

    const schemaAuditAfter = auditSchema(db)
    const dataAuditAfter = auditData(db, new ProjectDirectory(loadOrganizations(db), loadProjects(db)))

    console.log('\n== Post-Apply Audit ==')
    printDataAudit(dataAuditAfter)
    console.log(`Integrity check: ${schemaAuditAfter.integrityCheck.join(', ')}`)
    console.log(`Foreign key check rows: ${schemaAuditAfter.foreignKeyCheck.length}`)
  } finally {
    db.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
