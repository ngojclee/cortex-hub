import { Hono } from 'hono'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { createLogger } from '@cortex/shared-utils'
import { Embedder } from '@cortex/shared-mem9'
import { db } from '../db/client.js'
import { resolveEmbeddingConfig } from '../services/embedding-config.js'

const logger = createLogger('intel')

export const intelRouter = new Hono()

const GITNEXUS_URL = () => process.env.GITNEXUS_URL ?? 'http://gitnexus:4848'
const QDRANT_URL = process.env.QDRANT_URL ?? 'http://qdrant:6333'
const REPOS_DIR = process.env.REPOS_DIR ?? '/app/data/repos'

/** Max file size for code_read (512KB) */
const MAX_READ_SIZE = 512 * 1024

/**
 * Call GitNexus eval-server HTTP API.
 */
async function callGitNexus(
  tool: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const url = `${GITNEXUS_URL()}/tool/${tool}`
  logger.info(`GitNexus ${tool}: ${JSON.stringify(params)}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(text || `GitNexus ${tool} failed: ${res.status}`)
  }

  // GitNexus may return JSON or plain text
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.trim() }
  }
}

/**
 * Resolve a projectId to GitNexus-compatible repo name candidates.
 * Returns ordered list of names to try — GitNexus may register repos by:
 *   1. slug (e.g., 'yulgangproject')
 *   2. git URL basename (e.g., 'YulgangProject')
 *   3. projectId folder name (e.g., 'proj-abc123')
 * All candidates are returned for fallback-based querying.
 */
function resolveRepoNames(projectId: string): string[] {
  const candidates: string[] = []

  // If it doesn't look like an internal ID, try as-is first
  if (!projectId.startsWith('proj-')) {
    candidates.push(projectId)
  }

  try {
    const project = db.prepare(
      'SELECT id, slug, git_repo_url FROM projects WHERE id = ? OR slug = ?'
    ).get(projectId, projectId) as { id?: string; slug?: string; git_repo_url?: string } | undefined

    if (project) {
      // Strategy 1: Use slug
      if (project.slug && !candidates.includes(project.slug)) {
        candidates.push(project.slug)
      }

      // Strategy 2: Extract repo name from git URL
      if (project.git_repo_url) {
        const repoName = project.git_repo_url
          .replace(/\.git$/, '')
          .split('/')
          .pop()
        if (repoName && !candidates.includes(repoName)) {
          candidates.push(repoName)
        }
      }

      // Strategy 3: Use project ID (folder name in /app/data/repos/)
      if (project.id && !candidates.includes(project.id)) {
        candidates.push(project.id)
      }
    }
  } catch (error) {
    logger.warn(`resolveRepoNames: DB lookup failed: ${error}`)
  }

  // Last resort: use input directly
  if (candidates.length === 0) {
    candidates.push(projectId)
  }

  return candidates
}

/**
 * Legacy single-result resolver for backward compatibility.
 */
function resolveRepoName(projectId: string): string {
  const names = resolveRepoNames(projectId)
  return names[0] ?? projectId
}

type GitNexusRepoSummary = {
  name: string
  path: string | null
  indexedAt: string | null
  stats: {
    symbols: number | null
    relationships: number | null
    processes: number | null
  }
}

type ProjectResourceRecord = {
  id: string
  org_id: string
  name: string
  slug: string
  description: string | null
  git_repo_url: string | null
  indexed_at: string | null
  indexed_symbols: number | null
  created_at: string
  updated_at: string
  org_name?: string
  org_slug?: string
}

type ProjectIndexJobRecord = {
  id: string
  branch: string | null
  status: string | null
  progress: number | null
  started_at: string | null
  completed_at: string | null
  commit_hash: string | null
  commit_message: string | null
  mem9_status: string | null
  docs_knowledge_status: string | null
}

type ResourceContext = {
  project: ProjectResourceRecord
  repoCandidates: string[]
  gitnexusRepo: GitNexusRepoSummary | null
  latestJob: ProjectIndexJobRecord | null
  branch: string | null
  staleness: {
    status: 'fresh' | 'aging' | 'stale' | 'not_indexed' | 'indexing' | 'unknown'
    basedOn: 'gitnexus.indexedAt' | 'cortex.indexed_at' | 'cortex.index_jobs'
    indexedAt: string | null
    ageHours: number | null
    latestJobStatus: string | null
  }
}

const GITNEXUS_RESOURCE_TOOLS = [
  'cortex_code_search',
  'cortex_code_context',
  'cortex_code_impact',
  'cortex_detect_changes',
  'cortex_cypher',
  'cortex_list_repos',
  'cortex_code_read',
] as const

function buildResourceUris(projectId: string): string[] {
  return [
    'cortex://projects',
    `cortex://project/${projectId}/context`,
    `cortex://project/${projectId}/clusters`,
    `cortex://project/${projectId}/processes`,
    `cortex://project/${projectId}/schema`,
    `cortex://project/${projectId}/cluster/{clusterName}`,
    `cortex://project/${projectId}/process/{processName}`,
  ]
}

const GITNEXUS_GRAPH_SCHEMA = `# GitNexus Graph Schema

nodes:
  - File: Source code files
  - Folder: Directory containers
  - Function: Functions and arrow functions
  - Class: Class definitions
  - Interface: Interface/type definitions
  - Method: Class methods
  - CodeElement: Catch-all for other code elements
  - Community: Auto-detected functional area (Leiden algorithm)
  - Process: Execution flow trace

additional_node_types: "Multi-language: Struct, Enum, Macro, Typedef, Union, Namespace, Trait, Impl, TypeAlias, Const, Static, Property, Record, Delegate, Annotation, Constructor, Template, Module (use backticks in queries: \`Struct\`, \`Enum\`, etc.)"

node_properties:
  common: "name (STRING), filePath (STRING), startLine (INT32), endLine (INT32)"
  Method: "parameterCount (INT32), returnType (STRING), isVariadic (BOOL)"
  Function: "parameterCount (INT32), returnType (STRING), isVariadic (BOOL)"
  Property: "declaredType (STRING) - the field's type annotation (e.g., 'Address', 'City'). Used for field-access chain resolution."
  Constructor: "parameterCount (INT32)"
  Community: "heuristicLabel (STRING), cohesion (DOUBLE), symbolCount (INT32), keywords (STRING[]), description (STRING), enrichedBy (STRING)"
  Process: "heuristicLabel (STRING), processType (STRING - 'intra_community' or 'cross_community'), stepCount (INT32), communities (STRING[]), entryPointId (STRING), terminalId (STRING)"

relationships:
  - CONTAINS: File/Folder contains child
  - DEFINES: File defines a symbol
  - CALLS: Function/method invocation
  - IMPORTS: Module imports
  - EXTENDS: Class inheritance
  - IMPLEMENTS: Interface implementation
  - HAS_METHOD: Class/Struct/Interface owns a Method
  - HAS_PROPERTY: Class/Struct/Interface owns a Property (field)
  - ACCESSES: Function/Method reads or writes a Property (reason: 'read' or 'write')
  - OVERRIDES: Method overrides another Method (MRO)
  - MEMBER_OF: Symbol belongs to community
  - STEP_IN_PROCESS: Symbol is step N in process

relationship_table: "All relationships use a single CodeRelation table with a 'type' property. Properties: type (STRING), confidence (DOUBLE), reason (STRING), step (INT32)"
`

function normalizeStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null
  return trimmed
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.replaceAll(',', '').trim()
  if (!cleaned || cleaned === '?' || cleaned === 'undefined' || cleaned === 'null') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function getRawText(result: unknown): string {
  if (typeof result === 'string') return result.trim()
  if (result && typeof result === 'object' && 'raw' in result) {
    const raw = (result as { raw?: unknown }).raw
    if (typeof raw === 'string') return raw.trim()
  }
  return JSON.stringify(result, null, 2)
}

function parseGitNexusListRepos(result: unknown): GitNexusRepoSummary[] {
  if (Array.isArray(result)) {
    return result.map((repo) => {
      const row = repo as Record<string, unknown>
      const statsRow = row.stats && typeof row.stats === 'object'
        ? row.stats as Record<string, unknown>
        : {}

      return {
        name: normalizeStringValue(row.name) ?? 'unknown',
        path: normalizeStringValue(row.path),
        indexedAt: normalizeStringValue(row.indexedAt),
        stats: {
          symbols: parseNumberLike(statsRow.nodes ?? row.symbols),
          relationships: parseNumberLike(statsRow.edges ?? row.relationships),
          processes: parseNumberLike(statsRow.processes ?? row.processes),
        },
      }
    })
  }

  const raw = getRawText(result)
  if (!raw || raw.includes('No indexed repositories')) return []

  const repos: GitNexusRepoSummary[] = []
  let current: GitNexusRepoSummary | null = null

  for (const line of raw.split('\n')) {
    const repoMatch = line.match(/^\s{2}(.+?)\s+[—-]\s+(.+?) symbols,\s+(.+?) relationships,\s+(.+?) flows$/)
    if (repoMatch) {
      current = {
        name: repoMatch[1]!.trim(),
        path: null,
        indexedAt: null,
        stats: {
          symbols: parseNumberLike(repoMatch[2]),
          relationships: parseNumberLike(repoMatch[3]),
          processes: parseNumberLike(repoMatch[4]),
        },
      }
      repos.push(current)
      continue
    }

    if (!current) continue

    const pathMatch = line.match(/^\s{4}Path:\s+(.+)$/)
    if (pathMatch) {
      current.path = pathMatch[1]!.trim()
      continue
    }

    const indexedMatch = line.match(/^\s{4}Indexed:\s+(.+)$/)
    if (indexedMatch) {
      current.indexedAt = indexedMatch[1]!.trim()
    }
  }

  return repos
}

async function listGitNexusRepos(): Promise<GitNexusRepoSummary[]> {
  try {
    return parseGitNexusListRepos(await callGitNexus('list_repos', {}))
  } catch (error) {
    logger.warn(`listGitNexusRepos failed: ${String(error)}`)
    return []
  }
}

function findGitNexusRepo(
  candidates: string[],
  repos: GitNexusRepoSummary[],
): GitNexusRepoSummary | null {
  const byName = new Map(repos.map((repo) => [repo.name.toLowerCase(), repo]))

  for (const candidate of candidates) {
    const match = byName.get(candidate.toLowerCase())
    if (match) return match
  }

  return null
}

async function callGitNexusStrictWithFallback(
  tool: string,
  params: Record<string, unknown>,
  projectId: string,
): Promise<{ repo: string; result: unknown }> {
  const candidates = resolveRepoNames(projectId)
  logger.info(`GitNexus strict fallback: trying candidates ${JSON.stringify(candidates)} for ${tool}`)

  let lastError: unknown = null

  for (const candidate of candidates) {
    try {
      const result = await callGitNexus(tool, { ...params, repo: candidate })
      logger.info(`GitNexus strict fallback: success with repo "${candidate}" for ${tool}`)
      return { repo: candidate, result }
    } catch (error) {
      lastError = error
      logger.info(`GitNexus strict fallback: "${candidate}" failed for ${tool}`)
    }
  }

  throw lastError ?? new Error(`GitNexus ${tool} failed for project ${projectId}`)
}

function parseCypherRows(result: unknown): Array<Record<string, string | number | null>> {
  const raw = getRawText(result)
  if (!raw || raw === 'Query returned 0 rows.') return []
  if (raw.startsWith('Error:')) {
    throw new Error(raw.replace(/^Error:\s*/, ''))
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^\d+\s+row\(s\):/.test(line))
    .map((line) => {
      const row: Record<string, string | number | null> = {}
      const parts = line.split(' | ')

      for (const part of parts) {
        const separatorIndex = part.indexOf(': ')
        if (separatorIndex === -1) continue

        const key = part.slice(0, separatorIndex).trim()
        const rawValue = part.slice(separatorIndex + 2).trim()
        if (!key) continue

        row[key] = parseNumberLike(rawValue) ?? normalizeStringValue(rawValue)
      }

      return row
    })
    .filter((row) => Object.keys(row).length > 0)
}

function escapeCypherString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getProjectResourceRecord(projectId: string): ProjectResourceRecord | null {
  return db.prepare(
    `SELECT p.*, o.name AS org_name, o.slug AS org_slug
     FROM projects p
     JOIN organizations o ON o.id = p.org_id
     WHERE p.id = ? OR p.slug = ?`
  ).get(projectId, projectId) as ProjectResourceRecord | undefined ?? null
}

function getLatestIndexJob(projectId: string): ProjectIndexJobRecord | null {
  return db.prepare(
    `SELECT id, branch, status, progress, started_at, completed_at,
            commit_hash, commit_message, mem9_status, docs_knowledge_status
     FROM index_jobs
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId) as ProjectIndexJobRecord | undefined ?? null
}

function buildStaleness(
  project: ProjectResourceRecord,
  latestJob: ProjectIndexJobRecord | null,
  gitnexusRepo: GitNexusRepoSummary | null,
): ResourceContext['staleness'] {
  const activeStatuses = new Set(['pending', 'cloning', 'analyzing', 'ingesting'])
  if (latestJob?.status && activeStatuses.has(latestJob.status)) {
    return {
      status: 'indexing',
      basedOn: 'cortex.index_jobs',
      indexedAt: project.indexed_at ?? gitnexusRepo?.indexedAt ?? latestJob.completed_at,
      ageHours: null,
      latestJobStatus: latestJob.status,
    }
  }

  const indexedAt = gitnexusRepo?.indexedAt ?? project.indexed_at ?? latestJob?.completed_at ?? null
  if (!indexedAt) {
    return {
      status: 'not_indexed',
      basedOn: gitnexusRepo?.indexedAt ? 'gitnexus.indexedAt' : 'cortex.indexed_at',
      indexedAt: null,
      ageHours: null,
      latestJobStatus: latestJob?.status ?? null,
    }
  }

  const ageMs = Date.now() - Date.parse(indexedAt)
  if (!Number.isFinite(ageMs)) {
    return {
      status: 'unknown',
      basedOn: gitnexusRepo?.indexedAt ? 'gitnexus.indexedAt' : 'cortex.indexed_at',
      indexedAt,
      ageHours: null,
      latestJobStatus: latestJob?.status ?? null,
    }
  }

  const ageHours = Math.round((ageMs / 36e5) * 10) / 10
  let status: ResourceContext['staleness']['status'] = 'fresh'
  if (ageHours >= 24 * 7) status = 'stale'
  else if (ageHours >= 24) status = 'aging'

  return {
    status,
    basedOn: gitnexusRepo?.indexedAt ? 'gitnexus.indexedAt' : 'cortex.indexed_at',
    indexedAt,
    ageHours,
    latestJobStatus: latestJob?.status ?? null,
  }
}

async function resolveResourceContext(projectId: string): Promise<ResourceContext | null> {
  const project = getProjectResourceRecord(projectId)
  if (!project) return null

  const repoCandidates = resolveRepoNames(project.id)
  const gitnexusRepos = await listGitNexusRepos()
  const gitnexusRepo = findGitNexusRepo(repoCandidates, gitnexusRepos)
  const latestJob = getLatestIndexJob(project.id)

  return {
    project,
    repoCandidates,
    gitnexusRepo,
    latestJob,
    branch: latestJob?.branch ?? null,
    staleness: buildStaleness(project, latestJob, gitnexusRepo),
  }
}

function buildProjectResourceSummary(context: ResourceContext) {
  return {
    projectId: context.project.id,
    slug: context.project.slug,
    name: context.project.name,
    description: context.project.description,
    organization: {
      id: context.project.org_id,
      name: context.project.org_name ?? null,
      slug: context.project.org_slug ?? null,
    },
    gitRepoUrl: context.project.git_repo_url,
    repoPath: join(REPOS_DIR, context.project.id).replace(/\\/g, '/'),
    repoCandidates: context.repoCandidates,
    branch: context.branch,
    indexedAt: context.project.indexed_at ?? context.gitnexusRepo?.indexedAt ?? context.latestJob?.completed_at ?? null,
    symbols: context.project.indexed_symbols ?? context.gitnexusRepo?.stats.symbols ?? null,
    staleness: context.staleness,
    gitnexus: context.gitnexusRepo
      ? {
          registered: true,
          repoName: context.gitnexusRepo.name,
          path: context.gitnexusRepo.path,
          indexedAt: context.gitnexusRepo.indexedAt,
          stats: context.gitnexusRepo.stats,
        }
      : {
          registered: false,
          repoName: null,
          path: null,
          indexedAt: null,
          stats: {
            symbols: null,
            relationships: null,
            processes: null,
          },
        },
    latestIndexJob: context.latestJob
      ? {
          id: context.latestJob.id,
          branch: context.latestJob.branch,
          status: context.latestJob.status,
          progress: context.latestJob.progress,
          startedAt: context.latestJob.started_at,
          completedAt: context.latestJob.completed_at,
          commitHash: context.latestJob.commit_hash,
          commitMessage: context.latestJob.commit_message,
          mem9Status: context.latestJob.mem9_status,
          docsKnowledgeStatus: context.latestJob.docs_knowledge_status,
        }
      : null,
  }
}

async function queryProjectCypherRows(
  projectId: string,
  query: string,
): Promise<{ repo: string; rows: Array<Record<string, string | number | null>> }> {
  const { repo, result } = await callGitNexusStrictWithFallback('cypher', { query }, projectId)
  return { repo, rows: parseCypherRows(result) }
}

function normalizeClusterRows(rows: Array<Record<string, string | number | null>>) {
  const aggregated = new Map<string, {
    id: string | null
    label: string | null
    heuristicLabel: string | null
    symbols: number
    weightedCohesion: number
    subCommunities: number
  }>()

  for (const row of rows) {
    const label = normalizeStringValue(row.label)
    const heuristicLabel = normalizeStringValue(row.heuristicLabel)
    const id = normalizeStringValue(row.id)
    const key = (heuristicLabel ?? label ?? id ?? 'unknown').toLowerCase()
    const symbolCount = parseNumberLike(row.symbolCount) ?? 0
    const cohesion = parseNumberLike(row.cohesion) ?? 0

    const existing = aggregated.get(key) ?? {
      id,
      label,
      heuristicLabel,
      symbols: 0,
      weightedCohesion: 0,
      subCommunities: 0,
    }

    existing.symbols += symbolCount
    existing.weightedCohesion += cohesion * symbolCount
    existing.subCommunities += 1
    aggregated.set(key, existing)
  }

  return Array.from(aggregated.values())
    .map((cluster) => ({
      id: cluster.id,
      name: cluster.heuristicLabel ?? cluster.label ?? cluster.id ?? 'unknown',
      label: cluster.label,
      heuristicLabel: cluster.heuristicLabel,
      symbols: cluster.symbols,
      cohesion: cluster.symbols > 0 ? Math.round((cluster.weightedCohesion / cluster.symbols) * 1000) / 1000 : null,
      subCommunities: cluster.subCommunities,
    }))
    .sort((a, b) => b.symbols - a.symbols)
}


/**
 * Call GitNexus with multi-candidate repo fallback.
 * Tries each repo name candidate until one succeeds, then falls back to no-repo mode.
 */
async function callGitNexusWithFallback(
  tool: string,
  params: Record<string, unknown>,
  projectId?: string,
): Promise<unknown> {
  if (!projectId) {
    return callGitNexus(tool, params)
  }

  const candidates = resolveRepoNames(projectId)
  logger.info(`GitNexus fallback: trying candidates ${JSON.stringify(candidates)} for ${tool}`)

  let lastError: unknown = null

  for (const candidate of candidates) {
    try {
      const result = await callGitNexus(tool, { ...params, repo: candidate })
      logger.info(`GitNexus fallback: success with repo "${candidate}" for ${tool}`)
      return result
    } catch (err) {
      lastError = err
      logger.info(`GitNexus fallback: "${candidate}" failed for ${tool}, trying next...`)
    }
  }

  // Final fallback: try without repo filter
  try {
    logger.info(`GitNexus fallback: all candidates failed, trying ${tool} without repo filter`)
    return await callGitNexus(tool, params)
  } catch {
    throw lastError
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GitNexusResult = Record<string, any>

/**
 * Post-process GitNexus raw text to replace CLI hints with MCP tool references.
 */
function rewriteGitNexusHints(text: string): string {
  return text
    .replace(/gitnexus-context/g, 'cortex_code_context')
    .replace(/gitnexus-impact/g, 'cortex_code_impact')
    .replace(/gitnexus-query/g, 'cortex_code_search')
    .replace(
      /Next: Pick a symbol above and run gitnexus-context .*/g,
      'Next: Use cortex_code_context "<symbol>" to explore callers/callees, or cortex_code_impact "<symbol>" for blast radius.',
    )
    .replace(
      /Next: To check what breaks if you change this, run .*/g,
      'Next: Use cortex_code_impact "<name>" to check blast radius, or cortex_code_search for related logic.',
    )
    .replace(
      /Re-run: gitnexus-context .*/g,
      'Tip: Use cortex_code_context with file parameter to disambiguate.',
    )
    .replace(/Read the source with cat /g, 'Examine the source at ')
}

/**
 * Format GitNexus query results into a readable report for agents.
 * Handles the process-grouped search format that GitNexus returns.
 */
function formatSearchResults(query: string, data: unknown): string {
  const result = data as GitNexusResult

  // Handle raw text response
  if (result?.raw) {
    return `🔍 Search: "${query}"\n\n${rewriteGitNexusHints(result.raw)}`
  }

  // Handle structured response with processes
  const lines: string[] = [`🔍 Search: "${query}"\n`]

  // Extract processes if available
  const processes = result?.processes ?? result?.results?.processes ?? []
  const definitions = result?.definitions ?? result?.results?.definitions ?? []
  const files = result?.files ?? result?.results?.files ?? []

  if (Array.isArray(processes) && processes.length > 0) {
    lines.push(`📦 **Execution Flows** (${processes.length} found)\n`)
    for (const proc of processes.slice(0, 10)) {
      const name = proc.summary ?? proc.name ?? 'Unknown'
      const type = proc.process_type ?? ''
      const steps = proc.step_count ?? proc.symbol_count ?? 0
      lines.push(`  ▸ **${name}** (${steps} steps${type ? `, ${type}` : ''})`)

      // Show symbols in this process
      const symbols = proc.process_symbols ?? proc.symbols ?? []
      for (const sym of symbols.slice(0, 5)) {
        const symType = sym.type ?? sym.kind ?? ''
        const filePath = sym.filePath ?? sym.file ?? ''
        lines.push(`    → ${sym.name} (${symType}) — ${filePath}`)
      }
      lines.push('')
    }
  }

  if (Array.isArray(definitions) && definitions.length > 0) {
    lines.push(`📖 **Definitions** (${definitions.length})\n`)
    for (const def of definitions.slice(0, 10)) {
      const defType = def.type ?? def.kind ?? ''
      const filePath = def.filePath ?? def.file ?? ''
      lines.push(`  → ${def.name} (${defType}) — ${filePath}`)
    }
    lines.push('')
  }

  if (Array.isArray(files) && files.length > 0) {
    lines.push(`📁 **Files** (${files.length})\n`)
    for (const f of files.slice(0, 10)) {
      const filePath = typeof f === 'string' ? f : (f.path ?? f.filePath ?? '')
      lines.push(`  → ${filePath}`)
    }
    lines.push('')
  }

  // If nothing structured was found, include raw JSON
  if (processes.length === 0 && definitions.length === 0 && files.length === 0) {
    // Check if result has any meaningful content
    const hasContent = result && typeof result === 'object' && Object.keys(result).length > 0
    if (hasContent) {
      lines.push('📄 **Raw Results:**\n')
      lines.push('```json')
      lines.push(JSON.stringify(result, null, 2))
      lines.push('```')
    } else {
      lines.push('⚠️ No matching results found.\n')
      lines.push('**Suggestions:**')
      lines.push('• Try broader query terms (e.g., "auth" instead of "authentication middleware")')
      lines.push('• Try specific symbol names (e.g., "handleLogin", "UserService")')
      lines.push('• Check if the repository has been indexed: use `cortex_health` to verify GitNexus status')
      lines.push('• Ensure the project has been indexed with code indexing enabled')
    }
  }

  return lines.join('\n')
}

// ── Search: query codebase via GitNexus knowledge graph ──
intelRouter.post('/search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, limit, projectId, branch } = body as {
      query: string
      limit?: number
      projectId?: string
      branch?: string
    }

    if (!query) return c.json({ error: 'Query is required' }, 400)

    const params: Record<string, unknown> = {
      query,
      limit: limit ?? 5,
      content: true,
    }

    // Smart repo name resolution with multi-candidate fallback
    const repoCandidates: string[] = projectId ? resolveRepoNames(projectId) : []
    if (projectId) {
      params.repo = repoCandidates[0]
      logger.info(`Code search: trying candidates ${JSON.stringify(repoCandidates)} from "${projectId}"`)
    }

    if (branch) {
      params.branch = branch
    }

    let results: unknown
    let lastError: unknown = null

    // Try each candidate repo name until one works
    if (repoCandidates.length > 0) {
      for (const candidate of repoCandidates) {
        try {
          params.repo = candidate
          results = await callGitNexus('query', params)
          logger.info(`Code search: success with repo "${candidate}"`)
          lastError = null
          break
        } catch (err) {
          lastError = err
          logger.info(`Code search: "${candidate}" failed, trying next...`)
        }
      }

      // Final fallback: try without repo filter (search all repos)
      if (lastError) {
        logger.info('Code search: all candidates failed, trying without repo filter')
        delete params.repo
        try {
          results = await callGitNexus('query', params)
          lastError = null
        } catch (err) {
          lastError = err
        }
      }

      if (lastError) throw lastError
    } else {
      // No projectId — search across all repos
      results = await callGitNexus('query', params)
    }

    // Format results as readable report
    const formatted = formatSearchResults(query, results)

    return c.json({
      success: true,
      data: {
        query,
        limit: limit ?? 5,
        source: 'gitnexus',
        formatted,
        results,
      },
    })
  } catch (error) {
    logger.error(`Code search failed: ${String(error)}`)
    return c.json(
      {
        success: false,
        error: String(error),
        hint: 'Make sure GitNexus service is running and the repository has been indexed.',
        suggestions: [
          'Try calling cortex_health to check GitNexus status',
          'Ensure the project has been indexed via Code Indexing in the dashboard',
          'Try a broader search query',
        ],
      },
      500,
    )
  }
})

// ── Impact: blast radius analysis ──
intelRouter.post('/impact', async (c) => {
  try {
    const body = await c.req.json()
    const { target, direction, projectId } = body as {
      target: string
      direction?: string
      projectId?: string
    }
    if (!target) return c.json({ error: 'Target is required' }, 400)

    const params: Record<string, unknown> = {
      target,
      direction: direction ?? 'downstream',
    }

    const results = await callGitNexusWithFallback('impact', params, projectId)

    return c.json({
      success: true,
      data: { target, direction: direction ?? 'downstream', results },
    })
  } catch (error) {
    logger.error(`Impact analysis failed: ${String(error)}`)
    return c.json(
      {
        success: false,
        error: String(error),
        hint: 'Ensure the target symbol exists in an indexed repository.',
      },
      500,
    )
  }
})

// ── Context: 360° symbol view ──
intelRouter.post('/context', async (c) => {
  try {
    const body = await c.req.json()
    const { name, projectId, file } = body as {
      name: string
      projectId?: string
      file?: string
    }
    if (!name) return c.json({ error: 'Symbol name is required' }, 400)

    const params: Record<string, unknown> = { name, content: true }
    if (file) params.file = file

    let results = await callGitNexusWithFallback('context', params, projectId) as { raw?: string }

    // Post-process CLI hints
    if (results?.raw) {
      results.raw = rewriteGitNexusHints(results.raw)
    }

    // ── Auto-resolve disambiguation when file param provided ──
    // GitNexus may return "Multiple symbols named 'X'. Disambiguate with file path:"
    // even when file param is set. Auto-resolve by matching file against disambiguation list.
    if (file && results?.raw?.includes('Disambiguate with file path')) {
      const lines = results.raw.split('\n')
      // Find the line matching the provided file path
      // Pattern: "  undefined HandleAttack → GameServer/Logic/NpcAttackLogic.cs:885  (uid: Method:...)"
      const normalizedFile = file.replace(/\\/g, '/')
      const matchingLine = lines.find((line) => {
        // Match against full path or basename
        const pathMatch = line.match(/→\s+(\S+\.(?:cs|ts|js|py|go|rs|java)):/)
        return pathMatch && (
          pathMatch[1] === normalizedFile ||
          pathMatch[1]?.endsWith(normalizedFile) ||
          normalizedFile.endsWith(pathMatch[1] ?? '')
        )
      })

      if (matchingLine) {
        // Extract UID: (uid: Method:GameServer/Logic/NpcAttackLogic.cs:HandleAttack)
        const uidMatch = matchingLine.match(/\(uid:\s+(\S+)\)/)
        if (uidMatch?.[1]) {
          logger.info(`Context auto-disambiguate: resolved "${name}" + file "${file}" → uid "${uidMatch[1]}"`)
          try {
            const retryParams: Record<string, unknown> = { name: uidMatch[1], content: true }
            const retryResults = await callGitNexusWithFallback('context', retryParams, projectId) as { raw?: string }
            if (retryResults?.raw && !retryResults.raw.includes('not found')) {
              retryResults.raw = rewriteGitNexusHints(retryResults.raw)
              results = retryResults
            }
          } catch {
            // Keep original disambiguation result
            logger.warn(`Context auto-disambiguate retry failed for uid "${uidMatch[1]}"`)
          }
        }
      }
    }

    return c.json({
      success: true,
      data: { name, results },
    })
  } catch (error) {
    logger.error(`Context lookup failed: ${String(error)}`)
    return c.json(
      {
        success: false,
        error: String(error),
        hint: 'Ensure the symbol exists in an indexed repository.',
      },
      500,
    )
  }
})

// ── Resource: list Cortex projects with GitNexus mapping ──
intelRouter.get('/resources/projects', async (c) => {
  try {
    const gitnexusRepos = await listGitNexusRepos()
    const projects = db.prepare(
      `SELECT p.*, o.name AS org_name, o.slug AS org_slug
       FROM projects p
       JOIN organizations o ON o.id = p.org_id
       ORDER BY p.updated_at DESC, p.created_at DESC`
    ).all() as ProjectResourceRecord[]

    const items = projects.map((project) => {
      const repoCandidates = resolveRepoNames(project.id)
      const gitnexusRepo = findGitNexusRepo(repoCandidates, gitnexusRepos)
      const latestJob = getLatestIndexJob(project.id)
      const summaryContext: ResourceContext = {
        project,
        repoCandidates,
        gitnexusRepo,
        latestJob,
        branch: latestJob?.branch ?? null,
        staleness: buildStaleness(project, latestJob, gitnexusRepo),
      }

      return {
        ...buildProjectResourceSummary(summaryContext),
        resourcesAvailable: buildResourceUris(project.id),
      }
    })

    return c.json({
      success: true,
      data: {
        uri: 'cortex://projects',
        total: items.length,
        indexed: items.filter((item) => item.gitnexus.registered).length,
        items,
      },
    })
  } catch (error) {
    logger.error(`Project resources failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: project context overview ──
intelRouter.get('/resources/project/:projectId/context', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    let fileCount: number | null = null
    if (context.gitnexusRepo) {
      try {
        const { rows } = await queryProjectCypherRows(
          context.project.id,
          'MATCH (f:File) RETURN COUNT(f) AS files',
        )
        fileCount = parseNumberLike(rows[0]?.files) ?? null
      } catch (error) {
        logger.warn(`Project context file count failed for ${context.project.id}: ${String(error)}`)
      }
    }

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/context`,
        project: buildProjectResourceSummary(context),
        stats: {
          files: fileCount,
          symbols: context.project.indexed_symbols ?? context.gitnexusRepo?.stats.symbols ?? null,
          relationships: context.gitnexusRepo?.stats.relationships ?? null,
          processes: context.gitnexusRepo?.stats.processes ?? null,
        },
        toolsAvailable: GITNEXUS_RESOURCE_TOOLS,
        resourcesAvailable: buildResourceUris(context.project.id),
        hint: context.gitnexusRepo
          ? null
          : 'Project exists in Cortex but is not yet registered in GitNexus. Run indexing/register first to unlock clusters and processes.',
      },
    })
  } catch (error) {
    logger.error(`Project context resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: project clusters ──
intelRouter.get('/resources/project/:projectId/clusters', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 20

    if (!context.gitnexusRepo) {
      return c.json({
        success: true,
        data: {
          uri: `cortex://project/${context.project.id}/clusters`,
          project: buildProjectResourceSummary(context),
          total: 0,
          clusters: [],
          hint: 'No GitNexus index found for this project yet.',
        },
      })
    }

    const { repo, rows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (c:Community)
       RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel,
              c.cohesion AS cohesion, c.symbolCount AS symbolCount
       ORDER BY c.symbolCount DESC
       LIMIT ${Math.max(limit * 5, 50)}`,
    )
    const clusters = normalizeClusterRows(rows).slice(0, limit)

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/clusters`,
        repo,
        project: buildProjectResourceSummary(context),
        total: clusters.length,
        clusters,
      },
    })
  } catch (error) {
    logger.error(`Project clusters resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: cluster detail ──
intelRouter.get('/resources/project/:projectId/cluster/:clusterName', async (c) => {
  try {
    const { projectId, clusterName } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    if (!context.gitnexusRepo) {
      return c.json({
        success: false,
        error: 'Project is not yet indexed in GitNexus',
        hint: 'Run indexing/register before requesting cluster detail.',
      }, 409)
    }

    const decodedClusterName = decodeURIComponent(clusterName)
    const safeClusterName = escapeCypherString(decodedClusterName)

    const { repo, rows: clusterRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (c:Community)
       WHERE c.label = "${safeClusterName}" OR c.heuristicLabel = "${safeClusterName}"
       RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel,
              c.cohesion AS cohesion, c.symbolCount AS symbolCount
       ORDER BY c.symbolCount DESC`,
    )

    if (clusterRows.length === 0) {
      return c.json({ success: false, error: `Cluster not found: ${decodedClusterName}` }, 404)
    }

    const { rows: memberRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
       WHERE c.label = "${safeClusterName}" OR c.heuristicLabel = "${safeClusterName}"
       RETURN DISTINCT n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
       LIMIT 30`,
    )

    const cluster = normalizeClusterRows(clusterRows)[0] ?? null
    const members = memberRows.map((row) => ({
      name: normalizeStringValue(row.name) ?? 'unknown',
      type: normalizeStringValue(row.type),
      filePath: normalizeStringValue(row.filePath),
    }))

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/cluster/${encodeURIComponent(decodedClusterName)}`,
        repo,
        project: buildProjectResourceSummary(context),
        cluster,
        members,
      },
    })
  } catch (error) {
    logger.error(`Cluster detail resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: project processes ──
intelRouter.get('/resources/project/:projectId/processes', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 20

    if (!context.gitnexusRepo) {
      return c.json({
        success: true,
        data: {
          uri: `cortex://project/${context.project.id}/processes`,
          project: buildProjectResourceSummary(context),
          total: 0,
          processes: [],
          hint: 'No GitNexus index found for this project yet.',
        },
      })
    }

    const { repo, rows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (p:Process)
       RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel,
              p.processType AS processType, p.stepCount AS stepCount
       ORDER BY p.stepCount DESC
       LIMIT ${limit}`,
    )
    const processes = rows.map((row) => ({
      id: normalizeStringValue(row.id),
      name: normalizeStringValue(row.heuristicLabel) ?? normalizeStringValue(row.label) ?? normalizeStringValue(row.id) ?? 'unknown',
      label: normalizeStringValue(row.label),
      heuristicLabel: normalizeStringValue(row.heuristicLabel),
      type: normalizeStringValue(row.processType),
      steps: parseNumberLike(row.stepCount) ?? 0,
    }))

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/processes`,
        repo,
        project: buildProjectResourceSummary(context),
        total: processes.length,
        processes,
      },
    })
  } catch (error) {
    logger.error(`Project processes resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: process detail ──
intelRouter.get('/resources/project/:projectId/process/:processName', async (c) => {
  try {
    const { projectId, processName } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    if (!context.gitnexusRepo) {
      return c.json({
        success: false,
        error: 'Project is not yet indexed in GitNexus',
        hint: 'Run indexing/register before requesting process detail.',
      }, 409)
    }

    const decodedProcessName = decodeURIComponent(processName)
    const safeProcessName = escapeCypherString(decodedProcessName)

    const { repo, rows: processRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (p:Process)
       WHERE p.label = "${safeProcessName}" OR p.heuristicLabel = "${safeProcessName}"
       RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel,
              p.processType AS processType, p.stepCount AS stepCount
       LIMIT 1`,
    )

    const processRow = processRows[0]
    if (!processRow) {
      return c.json({ success: false, error: `Process not found: ${decodedProcessName}` }, 404)
    }

    const processIdValue = normalizeStringValue(processRow.id)
    if (!processIdValue) {
      return c.json({ success: false, error: `Process id missing for ${decodedProcessName}` }, 500)
    }

    const safeProcessId = escapeCypherString(processIdValue)
    const { rows: stepRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
       WHERE p.id = "${safeProcessId}"
       RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
       ORDER BY r.step`,
    )

    const steps = stepRows.map((row) => ({
      step: parseNumberLike(row.step) ?? 0,
      name: normalizeStringValue(row.name) ?? 'unknown',
      type: normalizeStringValue(row.type),
      filePath: normalizeStringValue(row.filePath),
    }))

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/process/${encodeURIComponent(decodedProcessName)}`,
        repo,
        project: buildProjectResourceSummary(context),
        process: {
          id: processIdValue,
          name: normalizeStringValue(processRow.heuristicLabel) ?? normalizeStringValue(processRow.label) ?? decodedProcessName,
          label: normalizeStringValue(processRow.label),
          heuristicLabel: normalizeStringValue(processRow.heuristicLabel),
          type: normalizeStringValue(processRow.processType),
          steps: parseNumberLike(processRow.stepCount) ?? steps.length,
        },
        steps,
      },
    })
  } catch (error) {
    logger.error(`Process detail resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: schema reference ──
intelRouter.get('/resources/project/:projectId/schema', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/schema`,
        project: buildProjectResourceSummary(context),
        schema: GITNEXUS_GRAPH_SCHEMA,
        toolsAvailable: GITNEXUS_RESOURCE_TOOLS,
        resourcesAvailable: buildResourceUris(context.project.id),
      },
    })
  } catch (error) {
    logger.error(`Schema resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── List Repos: discover indexed repositories with project mapping ──
intelRouter.get('/repos', async (c) => {
  try {
    const gitNexusRepos = await listGitNexusRepos()

    // Enrich with project DB data for project ID mapping
    const projects = db.prepare(
      'SELECT id, slug, name, git_repo_url, indexed_symbols FROM projects'
    ).all() as Array<{ id: string; slug: string; name: string; git_repo_url: string | null; indexed_symbols: number | null }>

    // Build a lookup for matching by slug or repo URL basename
    const projectBySlug = new Map<string, typeof projects[0]>()
    const projectById = new Map<string, typeof projects[0]>()
    for (const p of projects) {
      projectBySlug.set(p.slug?.toLowerCase(), p)
      projectById.set(p.id, p)
      // Also map by git URL basename (e.g., "cortex-hub" from github.com/ngojclee/cortex-hub.git)
      if (p.git_repo_url) {
        const basename = p.git_repo_url.replace(/\.git$/, '').split('/').pop()?.toLowerCase()
        if (basename && !projectBySlug.has(basename)) {
          projectBySlug.set(basename, p)
        }
      }
    }

    const repos = gitNexusRepos.map((repo) => {
      const match = projectBySlug.get(repo.name.toLowerCase()) ?? projectById.get(repo.name)
      return {
        name: repo.name,
        projectId: match?.id ?? '',
        slug: match?.slug ?? repo.name,
        symbols: repo.stats.symbols ?? match?.indexed_symbols ?? '?',
        processes: repo.stats.processes ?? '?',
        indexedAt: repo.indexedAt,
        gitUrl: match?.git_repo_url ?? '',
      }
    })

    return c.json({ success: true, data: repos })
  } catch (error) {
    logger.error(`List repos failed: ${String(error)}`)
    return c.json(
      { success: false, error: String(error) },
      500,
    )
  }
})

// ── Detect Changes: pre-commit risk analysis ──
intelRouter.post('/detect-changes', async (c) => {
  try {
    const body = await c.req.json()
    const { scope, projectId } = body as {
      scope?: string
      projectId?: string
    }

    const params: Record<string, unknown> = {
      scope: scope ?? 'all',
    }

    const results = await callGitNexusWithFallback('detect_changes', params, projectId)
    return c.json({ success: true, data: results })
  } catch (error) {
    logger.error(`Detect changes failed: ${String(error)}`)
    return c.json(
      { success: false, error: String(error) },
      500,
    )
  }
})

// ── Cypher: direct graph queries ──
intelRouter.post('/cypher', async (c) => {
  try {
    const body = await c.req.json()
    const { query: cypherQuery, projectId } = body as {
      query: string
      projectId?: string
    }

    if (!cypherQuery) return c.json({ error: 'Cypher query is required' }, 400)

    const params: Record<string, unknown> = { query: cypherQuery }

    const results = await callGitNexusWithFallback('cypher', params, projectId)
    return c.json({ success: true, data: results })
  } catch (error) {
    logger.error(`Cypher query failed: ${String(error)}`)
    return c.json(
      { success: false, error: String(error) },
      500,
    )
  }
})

// ── Register: trigger GitNexus analyze on a cloned repo ──
intelRouter.post('/register', async (c) => {
  try {
    const body = await c.req.json()
    const { projectId } = body as { projectId: string }

    if (!projectId) return c.json({ error: 'projectId is required' }, 400)

    // Look up project to get repo path and slug
    const project = db.prepare(
      'SELECT id, slug, git_repo_url FROM projects WHERE id = ?'
    ).get(projectId) as { id: string; slug?: string; git_repo_url?: string } | undefined

    if (!project) return c.json({ error: 'Project not found' }, 404)

    const repoDir = `/app/data/repos/${projectId}`
    const repoName = project.slug || projectId

    logger.info(`Register: analyzing ${repoName} at ${repoDir}`)

    // Call GitNexus eval-server to analyze the repo
    // The eval-server and cortex-api share /app/data volume
    try {
      const analyzeRes = await fetch(`${GITNEXUS_URL()}/tool/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: repoDir, name: repoName }),
        signal: AbortSignal.timeout(120000), // 2 min for analysis
      })

      if (analyzeRes.ok) {
        const result = await analyzeRes.text()
        logger.info(`Register: GitNexus analyze success for ${repoName}`)
        return c.json({ success: true, data: { repoName, result: result.trim() } })
      }

      // If eval-server doesn't have /tool/analyze, the repo needs to be
      // analyzed via CLI in the gitnexus container
      logger.warn(`Register: eval-server analyze returned ${analyzeRes.status}, repo may need manual registration`)
    } catch (err) {
      logger.warn(`Register: eval-server analyze call failed: ${err}`)
    }

    // Fallback: return info about what needs to be done
    return c.json({
      success: false,
      data: {
        repoName,
        repoDir,
        message: 'GitNexus eval-server does not have an analyze endpoint. '
          + 'Run `gitnexus analyze` in the repo directory inside the gitnexus container, '
          + 'or restart the gitnexus container to trigger auto-discovery.',
        hint: 'docker exec cortex-gitnexus sh -c "cd ' + repoDir + ' && gitnexus analyze --force"',
      },
    })
  } catch (error) {
    logger.error(`Register failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Sync: register all cloned repos with GitNexus ──
intelRouter.post('/sync-repos', async (c) => {
  try {
    // Get all projects that have been indexed
    const projects = db.prepare(
      'SELECT id, slug, git_repo_url, indexed_symbols FROM projects WHERE indexed_at IS NOT NULL'
    ).all() as Array<{ id: string; slug?: string; git_repo_url?: string; indexed_symbols?: number }>

    const results: Array<{ projectId: string; slug: string; status: string; error?: string }> = []

    for (const project of projects) {
      const repoName = project.slug || project.id
      const repoDir = `/app/data/repos/${project.id}`

      try {
        // Try to call GitNexus query to check if already registered
        const checkRes = await fetch(`${GITNEXUS_URL()}/tool/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test', repo: repoName, limit: 1 }),
          signal: AbortSignal.timeout(5000),
        })

        if (checkRes.ok) {
          results.push({ projectId: project.id, slug: repoName, status: 'already_registered' })
          continue
        }

        const errorText = await checkRes.text()
        if (errorText.includes('not found')) {
          // Not registered — try to analyze
          const analyzeRes = await fetch(`${GITNEXUS_URL()}/tool/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: repoDir, name: repoName }),
            signal: AbortSignal.timeout(120000),
          })

          if (analyzeRes.ok) {
            results.push({ projectId: project.id, slug: repoName, status: 'analyzed' })
          } else {
            results.push({
              projectId: project.id,
              slug: repoName,
              status: 'needs_manual',
              error: `Analyze returned ${analyzeRes.status}`,
            })
          }
        }
      } catch (err) {
        results.push({
          projectId: project.id,
          slug: repoName,
          status: 'error',
          error: String(err),
        })
      }
    }

    return c.json({
      success: true,
      data: {
        total: projects.length,
        results,
        hint: 'To manually register repos, restart the gitnexus container: docker restart cortex-gitnexus',
      },
    })
  } catch (error) {
    logger.error(`Sync repos failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Code Search (Qdrant semantic): search embedded source code ──
intelRouter.post('/code-search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, projectId, branch, limit, file } = body as {
      query: string
      projectId?: string
      branch?: string
      limit?: number
      file?: string
    }

    if (!query) return c.json({ error: 'query is required' }, 400)
    if (!projectId) return c.json({ error: 'projectId is required for code search' }, 400)

    // Resolve collection name
    const collectionName = `cortex-project-${projectId}`

    // Embed the query
    const { config, chain } = resolveEmbeddingConfig()
    const embedder = new Embedder(config, chain, { maxRetries: 2, retryDelayMs: 1000 })
    const vector = await embedder.embed(query)

    // Build Qdrant filter
    const must: Array<Record<string, unknown>> = []
    if (branch) {
      must.push({ key: 'branch', match: { value: branch } })
    }
    if (file) {
      must.push({ key: 'file_path', match: { text: file } })
    }

    const searchLimit = limit ?? 10

    const res = await fetch(`${QDRANT_URL}/collections/${collectionName}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit: searchLimit,
        with_payload: true,
        filter: must.length > 0 ? { must } : undefined,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const errText = await res.text()
      // Collection may not exist (project not embedded yet)
      if (errText.includes('Not found') || errText.includes('doesn\'t exist')) {
        return c.json({
          success: true,
          data: {
            query,
            results: [],
            message: `No embedded code found for project ${projectId}. Run Mem9 embedding first via the dashboard.`,
          },
        })
      }
      return c.json({ error: `Qdrant search failed: ${errText}` }, 500)
    }

    const data = (await res.json()) as {
      result?: Array<{ id: string; score: number; payload?: Record<string, unknown> }>
    }

    const results = (data.result ?? []).map((hit) => ({
      score: hit.score,
      filePath: hit.payload?.file_path as string | undefined,
      chunkIndex: hit.payload?.chunk_index as number | undefined,
      content: hit.payload?.content as string | undefined,
      branch: hit.payload?.branch as string | undefined,
    }))

    return c.json({
      success: true,
      data: { query, projectId, results },
    })
  } catch (error) {
    logger.error(`Code search (Qdrant) failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── File Content: read raw source file from cloned repo ──
intelRouter.post('/file-content', async (c) => {
  try {
    const body = await c.req.json()
    const { projectId, file, startLine, endLine } = body as {
      projectId: string
      file: string
      startLine?: number
      endLine?: number
    }

    if (!projectId) return c.json({ error: 'projectId is required' }, 400)
    if (!file) return c.json({ error: 'file path is required' }, 400)

    // Security: prevent path traversal
    const normalized = file.replace(/\\/g, '/').replace(/\.\.\/|\.\.$/g, '')
    const repoDir = join(REPOS_DIR, projectId)
    const fullPath = join(repoDir, normalized)

    // Ensure path stays within repo dir
    if (!fullPath.startsWith(repoDir)) {
      return c.json({ error: 'Invalid file path (path traversal attempt)' }, 400)
    }

    if (!existsSync(fullPath)) {
      // Try to find file by basename in repo
      const basename = normalized.split('/').pop() ?? ''
      const suggestions = findFilesByName(repoDir, basename, 5)
      return c.json({
        error: `File not found: ${normalized}`,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        hint: 'Use cortex_code_search to find the correct file path first.',
      }, 404)
    }

    const stat = statSync(fullPath)
    if (!stat.isFile()) {
      return c.json({ error: 'Path is a directory, not a file' }, 400)
    }
    if (stat.size > MAX_READ_SIZE) {
      return c.json({
        error: `File too large (${Math.round(stat.size / 1024)}KB > ${MAX_READ_SIZE / 1024}KB limit)`,
        hint: 'Use startLine/endLine to read a portion of the file.',
      }, 400)
    }

    const content = readFileSync(fullPath, 'utf-8')

    // Optional line range
    if (startLine || endLine) {
      const lines = content.split('\n')
      const start = Math.max(1, startLine ?? 1) - 1
      const end = Math.min(lines.length, endLine ?? lines.length)
      const sliced = lines.slice(start, end)

      return c.json({
        success: true,
        data: {
          file: normalized,
          projectId,
          totalLines: lines.length,
          startLine: start + 1,
          endLine: end,
          content: sliced.join('\n'),
        },
      })
    }

    return c.json({
      success: true,
      data: {
        file: normalized,
        projectId,
        totalLines: content.split('\n').length,
        sizeBytes: stat.size,
        content,
      },
    })
  } catch (error) {
    logger.error(`File content read failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

/** Find files by basename in a repo directory (for suggestions) */
function findFilesByName(dir: string, basename: string, maxResults: number): string[] {
  const results: string[] = []
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.turbo', 'vendor', 'bin', 'obj'])

  function walk(currentDir: string) {
    if (results.length >= maxResults) return
    let entries: string[]
    try { entries = readdirSync(currentDir) } catch { return }

    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (skipDirs.has(entry) || entry.startsWith('.')) continue

      const fullPath = join(currentDir, entry)
      let stat
      try { stat = statSync(fullPath) } catch { continue }

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (entry.toLowerCase() === basename.toLowerCase()) {
        results.push(relative(dir, fullPath))
      }
    }
  }

  walk(dir)
  return results
}

// ── Health: check GitNexus service status ──
intelRouter.get('/health', async (c) => {
  try {
    const res = await fetch(`${GITNEXUS_URL()}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return c.json({ status: 'unhealthy', statusCode: res.status }, 503)
    }

    const data = await res.json()
    return c.json({ status: 'healthy', ...data })
  } catch (error) {
    return c.json(
      { status: 'unreachable', error: String(error) },
      503,
    )
  }
})
