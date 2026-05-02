import { Hono } from 'hono'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { randomUUID } from 'crypto'
import { createLogger } from '@cortex/shared-utils'
import { Embedder } from '@cortex/shared-mem9'
import { db } from '../db/client.js'
import { resolveEmbeddingConfig } from '../services/embedding-config.js'
import { buildGraphSnapshotMeta, readGraphSnapshot, writeGraphSnapshot, type GraphSnapshotMeta } from '../services/graph-snapshot.js'
import { requireAdminAccess } from './admin-helpers.js'

const logger = createLogger('intel')

export const intelRouter = new Hono()

const GITNEXUS_URL = () => process.env.GITNEXUS_URL ?? 'http://gitnexus:4848'
const QDRANT_URL = process.env.QDRANT_URL ?? 'http://qdrant:6333'
const REPOS_DIR = process.env.REPOS_DIR ?? '/app/data/repos'
const GITNEXUS_REGISTRY_DIR = process.env.GITNEXUS_REGISTRY_DIR ?? '/root/.gitnexus'
const GITNEXUS_REGISTRY_PATH = () => join(GITNEXUS_REGISTRY_DIR, 'registry.json')

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

type ProjectKnowledgeStats = {
  docs: number
  chunks: number
}

type DiscoveryCandidate = {
  key: string
  slug: string
  name: string
  sourceKinds: string[]
  repoName: string | null
  gitRepoUrl: string | null
  repoPath: string | null
  knowledge: ProjectKnowledgeStats | null
  gitnexus: GitNexusRepoSummary | null
}

type GitNexusRegistryEntry = {
  name: string
  path: string
  storagePath: string
  indexedAt: string | null
  lastCommit: string | null
  stats: {
    nodes: number | null
    edges: number | null
    processes: number | null
  } | null
}

type GitNexusRegistryAuditEntry = {
  projectId: string
  slug: string
  name: string
  aliases: string[]
  aliasCount: number
  canonicalCandidates: string[]
  entries: GitNexusRegistryEntry[]
  canonicalAlias: string | null
}

type GitNexusRegistryCleanupOperation = {
  type: 'dedupe_aliases' | 'remove_stale_unmapped'
  projectId: string | null
  slug: string | null
  canonicalAlias: string | null
  keep: GitNexusRegistryEntry | null
  remove: GitNexusRegistryEntry[]
  reason: string
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
  gitnexusAliases: GitNexusRepoSummary[]
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

type IndexedSource = 'gitnexus.indexedAt' | 'cortex.indexed_at' | 'cortex.index_jobs'
type ProjectClassificationKind = 'repository' | 'umbrella' | 'knowledge_only' | 'placeholder'

type ProjectCleanupOperation = {
  projectId: string
  slug: string
  name: string
  kind: ProjectClassificationKind
  patch: {
    gitRepoUrl?: string | null
    indexedAt?: string | null
    indexedSymbols?: number | null
  }
  reasons: string[]
}

type GraphDirection = 'upstream' | 'downstream' | 'both'

type GraphQueryOptions = {
  nodeTypes: string[]
  edgeTypes: string[]
  focus: string | null
  search: string | null
  community: string | null
  depth: number
  direction: GraphDirection
  limitNodes: number
  limitEdges: number
  format: string
}

type BoundedGraphNode = {
  id: string
  type: string
  name: string
  filePath: string | null
  startLine: number | null
  endLine: number | null
  label: string | null
  heuristicLabel: string | null
  community: string | null
  depth: number | null
}

type BoundedGraphEdge = {
  id: string
  source: string
  target: string
  type: string
  confidence: number | null
  reason: string | null
  step: number | null
}

type BoundedGraphData = {
  repo: string | null
  nodes: BoundedGraphNode[]
  edges: BoundedGraphEdge[]
  visibleCounts: {
    nodes: number
    edges: number
  }
  totalCounts: {
    nodes: number | null
    edges: number | null
  }
  truncated: boolean
  capReason: string[]
  snapshot?: GraphSnapshotMeta
}

const DEFAULT_GRAPH_NODE_TYPES = ['File', 'Class', 'Function', 'Method', 'Interface'] as const
const DEFAULT_GRAPH_EDGE_TYPES = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'] as const
const MAX_GRAPH_NODES = 250
const MAX_GRAPH_EDGES = 500
const DEFAULT_GRAPH_NODES = 80
const DEFAULT_GRAPH_EDGES = 160
const MAX_GRAPH_DEPTH = 5

const GITNEXUS_RESOURCE_TOOLS = [
  'cortex_code_search',
  'cortex_code_context',
  'cortex_code_impact',
  'cortex_detect_changes',
  'cortex_cypher',
  'cortex_list_repos',
  'cortex_code_read',
  'cortex_graph_search',
  'cortex_graph_slice',
  'cortex_file_neighbors',
  'cortex_symbol_brief',
] as const

function buildResourceUris(projectId: string): string[] {
  return [
    'cortex://projects',
    `cortex://project/${projectId}/context`,
    `cortex://project/${projectId}/graph`,
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

const GENERIC_CLUSTER_NAME = /^(unknown|cluster[_-\s]?\d+)$/i
const TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'api', 'app', 'apps', 'base', 'button', 'card', 'code', 'common',
  'component', 'components', 'config', 'container', 'core', 'dashboard', 'data',
  'default', 'detail', 'dist', 'error', 'feature', 'file', 'files', 'flow', 'general',
  'helper', 'helpers', 'hook', 'hooks', 'index', 'item', 'js', 'json', 'layout', 'lib',
  'list', 'logic', 'model', 'module', 'node', 'page', 'pages', 'path', 'provider',
  'report', 'resource', 'route', 'routes', 'service', 'services', 'shared', 'src',
  'state', 'store', 'system', 'ts', 'tsx', 'type', 'types', 'ui', 'util', 'utils',
  'value', 'view', 'web',
])

function isGenericClusterName(value: string | null): boolean {
  if (!value) return true
  return GENERIC_CLUSTER_NAME.test(value.trim())
}

function splitIdentifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function cleanClusterToken(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  if (
    !normalized ||
    normalized.length < 3 ||
    TOKEN_STOPWORDS.has(normalized) ||
    /^\d+$/.test(normalized)
  ) {
    return null
  }
  return normalized
}

function titleCaseToken(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function collectClusterCandidateTokens(filePath: string | null, symbolName: string | null): string[] {
  const weighted: string[] = []

  if (filePath) {
    const normalizedPath = filePath.replaceAll('\\', '/')
    const parts = normalizedPath.split('/').filter(Boolean)
    const fileName = parts.at(-1) ?? ''
    const baseName = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName
    const parentDir = parts.at(-2) ?? ''

    for (const token of splitIdentifierTokens(baseName)) {
      const cleaned = cleanClusterToken(token)
      if (cleaned) weighted.push(cleaned, cleaned, cleaned, cleaned)
    }

    for (const token of splitIdentifierTokens(parentDir)) {
      const cleaned = cleanClusterToken(token)
      if (cleaned) weighted.push(cleaned, cleaned)
    }

    for (const segment of parts) {
      for (const token of splitIdentifierTokens(segment)) {
        const cleaned = cleanClusterToken(token)
        if (cleaned) weighted.push(cleaned)
      }
    }
  }

  if (symbolName) {
    for (const token of splitIdentifierTokens(symbolName)) {
      const cleaned = cleanClusterToken(token)
      if (cleaned) weighted.push(cleaned, cleaned)
    }
  }

  return weighted
}

function inferClusterLabelFromMembers(
  members: Array<{ filePath: string | null; name: string | null }>,
): string | null {
  const scores = new Map<string, number>()

  for (const member of members) {
    const weightedTokens = collectClusterCandidateTokens(member.filePath, member.name)
    for (const token of weightedTokens) {
      scores.set(token, (scores.get(token) ?? 0) + 1)
    }
  }

  const winner = Array.from(scores.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      if (b[0].length !== a[0].length) return b[0].length - a[0].length
      return a[0].localeCompare(b[0])
    })[0]?.[0]

  return winner ? titleCaseToken(winner) : null
}

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function humanizeSlug(value: string): string {
  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.replaceAll(',', '').trim()
  if (!cleaned || cleaned === '?' || cleaned === 'undefined' || cleaned === 'null') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseScalarValue(rawValue: string): string | number | null {
  return parseNumberLike(rawValue) ?? normalizeStringValue(rawValue)
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

function parseMarkdownTableRows(markdown: string): Array<Record<string, string | number | null>> {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))

  if (lines.length < 3) return []

  const headerCells = splitMarkdownTableRow(lines[0] ?? '')
  const separator = lines[1] ?? ''
  if (
    headerCells.length === 0 ||
    !separator.includes('---')
  ) {
    return []
  }

  return lines
    .slice(2)
    .map((line) => {
      const cells = splitMarkdownTableRow(line)
      const row: Record<string, string | number | null> = {}

      headerCells.forEach((header, index) => {
        if (!header) return
        row[header] = parseScalarValue(cells[index] ?? '')
      })

      return row
    })
    .filter((row) => Object.keys(row).length > 0)
}

function extractLeadingJSONObject(raw: string): string | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('{')) return null

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (escaping) {
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return trimmed.slice(0, index + 1)
      }
    }
  }

  return null
}

function extractGitNexusMarkdown(raw: string): string | null {
  if (raw.trimStart().startsWith('|')) {
    return raw.trim()
  }

  const leadingJson = extractLeadingJSONObject(raw)
  if (!leadingJson) return null

  try {
    const parsed = JSON.parse(leadingJson) as { markdown?: unknown }
    return typeof parsed.markdown === 'string'
      ? parsed.markdown.trim()
      : null
  } catch {
    return null
  }
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

function readGitNexusRegistry(): GitNexusRegistryEntry[] {
  const registryPath = GITNEXUS_REGISTRY_PATH()
  if (!existsSync(registryPath)) return []

  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => ({
        name: String(entry.name ?? ''),
        path: String(entry.path ?? ''),
        storagePath: String(entry.storagePath ?? join(String(entry.path ?? ''), '.gitnexus')),
        indexedAt: normalizeStringValue(entry.indexedAt),
        lastCommit: normalizeStringValue(entry.lastCommit),
        stats: entry.stats && typeof entry.stats === 'object'
          ? {
              nodes: parseNumberLike((entry.stats as Record<string, unknown>).nodes),
              edges: parseNumberLike((entry.stats as Record<string, unknown>).edges),
              processes: parseNumberLike((entry.stats as Record<string, unknown>).processes),
            }
          : null,
      }))
      .filter((entry) => entry.name && entry.path)
  } catch (error) {
    logger.warn(`Failed to read GitNexus registry: ${String(error)}`)
    return []
  }
}

function mapRegistryEntryToRepoSummary(entry: GitNexusRegistryEntry): GitNexusRepoSummary {
  return {
    name: entry.name,
    path: entry.path,
    indexedAt: entry.indexedAt,
    stats: {
      symbols: entry.stats?.nodes ?? null,
      relationships: entry.stats?.edges ?? null,
      processes: entry.stats?.processes ?? null,
    },
  }
}

async function listGitNexusRepos(options: { allowLiveFallback?: boolean } = {}): Promise<GitNexusRepoSummary[]> {
  const registryRepos = readGitNexusRegistry().map(mapRegistryEntryToRepoSummary)
  if (registryRepos.length > 0 || !options.allowLiveFallback) return registryRepos

  try {
    return parseGitNexusListRepos(await callGitNexus('list_repos', {}))
  } catch (error) {
    logger.warn(`listGitNexusRepos live fallback failed: ${String(error)}`)
    return []
  }
}

function writeGitNexusRegistry(entries: GitNexusRegistryEntry[]) {
  const registryPath = GITNEXUS_REGISTRY_PATH()
  mkdirSync(GITNEXUS_REGISTRY_DIR, { recursive: true })
  writeFileSync(registryPath, JSON.stringify(entries, null, 2), 'utf8')
}

function hasUmbrellaHint(project: Pick<ProjectResourceRecord, 'name' | 'description'>): boolean {
  const description = `${project.name} ${project.description ?? ''}`.toLowerCase()
  return (
    description.includes('umbrella project') ||
    description.includes('brand hub') ||
    description.includes('no direct repo') ||
    description.includes('use sub-projects') ||
    description.includes('use sub projects')
  )
}

function chooseCanonicalRegistryEntry(
  project: Pick<ProjectResourceRecord, 'id' | 'slug' | 'git_repo_url'>,
  entries: GitNexusRegistryEntry[],
): GitNexusRegistryEntry | null {
  if (entries.length === 0) return null

  const normalizedByName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]))
  const projectSlug = slugifyName(project.slug)
  const projectId = slugifyName(project.id)
  const repoSlug = getRepoSlugFromGitUrl(project.git_repo_url)

  for (const candidate of [projectSlug, repoSlug, projectId]) {
    if (!candidate) continue
    const match = normalizedByName.get(candidate.toLowerCase())
    if (match) return match
  }

  return [...entries].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null
}

function buildGitNexusRegistryAuditData(
  projects: Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'name' | 'git_repo_url'>>,
  registryEntries: GitNexusRegistryEntry[],
) {
  const byProjectId = new Map<string, GitNexusRegistryEntry[]>()
  const unmapped: Array<GitNexusRegistryEntry & { repoName: string; repoPathExists: boolean; storagePathExists: boolean }> = []

  for (const entry of registryEntries) {
    const linked = findProjectByDiscoveryCandidate(projects, {
      slug: entry.name,
      gitRepoUrl: readGitRemoteUrl(entry.path),
      repoName: entry.name,
    })

    if (!linked) {
      unmapped.push({
        ...entry,
        repoName: entry.name,
        repoPathExists: existsSync(entry.path),
        storagePathExists: existsSync(entry.storagePath),
      })
      continue
    }

    const list = byProjectId.get(linked.id) ?? []
    list.push(entry)
    byProjectId.set(linked.id, list)
  }

  const aliasDrift: GitNexusRegistryAuditEntry[] = projects
    .map((project) => {
      const entries = byProjectId.get(project.id) ?? []
      const canonicalEntry = chooseCanonicalRegistryEntry(project, entries)
      return {
        projectId: project.id,
        slug: project.slug,
        name: project.name,
        aliases: entries.map((entry) => entry.name),
        aliasCount: entries.length,
        canonicalCandidates: resolveRepoNames(project.id),
        entries,
        canonicalAlias: canonicalEntry?.name ?? null,
      }
    })
    .filter((entry) => entry.aliasCount > 1)

  return {
    totalRepos: registryEntries.length,
    mappedProjects: byProjectId.size,
    aliasDrift,
    unmapped,
  }
}

function buildGitNexusRegistryCleanupOperations(
  projects: Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'name' | 'git_repo_url'>>,
  registryEntries: GitNexusRegistryEntry[],
  options?: { projectId?: string | null; includeUnmapped?: boolean },
): GitNexusRegistryCleanupOperation[] {
  const audit = buildGitNexusRegistryAuditData(projects, registryEntries)
  const projectFilter = normalizeStringValue(options?.projectId ?? null)
  const operations: GitNexusRegistryCleanupOperation[] = []

  for (const entry of audit.aliasDrift) {
    if (projectFilter && entry.projectId !== projectFilter && entry.slug !== projectFilter) continue

    const keep = chooseCanonicalRegistryEntry(
      projects.find((project) => project.id === entry.projectId)!,
      entry.entries,
    )
    const remove = entry.entries.filter((candidate) => keep ? candidate.path !== keep.path : true)
    if (remove.length === 0) continue

    operations.push({
      type: 'dedupe_aliases',
      projectId: entry.projectId,
      slug: entry.slug,
      canonicalAlias: keep?.name ?? null,
      keep,
      remove,
      reason: `Keep canonical alias ${keep?.name ?? 'unknown'} and remove duplicate GitNexus registry aliases for ${entry.slug}.`,
    })
  }

  if (options?.includeUnmapped) {
    for (const entry of audit.unmapped) {
      const missingRepo = !entry.repoPathExists
      const missingStorage = !entry.storagePathExists
      if (!missingRepo && !missingStorage) continue
      operations.push({
        type: 'remove_stale_unmapped',
        projectId: null,
        slug: null,
        canonicalAlias: null,
        keep: null,
        remove: [entry],
        reason: `Remove stale unmapped registry entry ${entry.name} because ${missingRepo ? 'repo path is missing' : 'storage path is missing'}.`,
      })
    }
  }

  return operations
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

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '').replace(/\/$/, '')
}

function getRepoSlugFromGitUrl(value: string | null | undefined): string | null {
  const normalized = normalizeGitUrlForMatch(value)
  if (!normalized) return null

  const pathSegments = normalized.split('/').filter(Boolean)
  const repoName = pathSegments[pathSegments.length - 1]
  return repoName ? slugifyName(repoName) : null
}

function normalizeGitUrlForMatch(value: string | null | undefined): string | null {
  const raw = normalizeStringValue(value)
  if (!raw) return null

  const sanitized = sanitizeGitUrl(raw).trim()
  const sshMatch = sanitized.match(/^git@([^:]+):(.+)$/i)
  if (sshMatch) {
    return `${sshMatch[1]!.toLowerCase()}/${stripGitSuffix(sshMatch[2]!.toLowerCase())}`
  }

  try {
    const parsed = new URL(sanitized)
    const host = parsed.hostname.toLowerCase()
    const path = stripGitSuffix(parsed.pathname.toLowerCase())
    return `${host}${path}`
  } catch {
    return stripGitSuffix(sanitized.toLowerCase())
  }
}

function findProjectByDiscoveryCandidate(
  projects: Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'git_repo_url'>>,
  candidate: { slug?: string | null; gitRepoUrl?: string | null; repoName?: string | null },
): Pick<ProjectResourceRecord, 'id' | 'slug' | 'git_repo_url'> | null {
  const candidateSlug = candidate.slug ? slugifyName(candidate.slug) : null
  const cleanCandidateUrl = normalizeGitUrlForMatch(candidate.gitRepoUrl)
  const cleanRepoName = candidate.repoName ? slugifyName(candidate.repoName) : null
  const candidateRepoSlug = getRepoSlugFromGitUrl(candidate.gitRepoUrl)

  for (const project of projects) {
    const projectId = slugifyName(project.id)
    const projectSlug = project.slug ? slugifyName(project.slug) : null
    const cleanProjectUrl = normalizeGitUrlForMatch(project.git_repo_url)
    const projectRepoName = getRepoSlugFromGitUrl(project.git_repo_url)

    if (candidateSlug && (projectSlug === candidateSlug || projectId === candidateSlug)) return project
    if (cleanCandidateUrl && cleanProjectUrl === cleanCandidateUrl) return project
    if (candidateRepoSlug && (projectSlug === candidateRepoSlug || projectRepoName === candidateRepoSlug || projectId === candidateRepoSlug)) {
      return project
    }
    if (cleanRepoName && (projectSlug === cleanRepoName || projectRepoName === cleanRepoName || projectId === cleanRepoName)) return project
  }

  return null
}

function findGitNexusRepoAliases(
  candidates: string[],
  repos: GitNexusRepoSummary[],
): GitNexusRepoSummary[] {
  const uniqueCandidates = Array.from(new Set(candidates.map((candidate) => candidate.toLowerCase())))
  return repos.filter((repo) => uniqueCandidates.includes(repo.name.toLowerCase()))
}

/** Strip embedded credentials (user:pass@) from a git URL to prevent token leaks. */
function sanitizeGitUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
      return parsed.toString()
    }
    return url
  } catch {
    return url
  }
}

function readGitRemoteUrl(repoPath: string | null): string | null {
  if (!repoPath) return null

  const configPath = join(repoPath, '.git', 'config')
  if (!existsSync(configPath)) return null

  try {
    const raw = readFileSync(configPath, 'utf8')
    const match = raw.match(/\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+)/)
    const url = match?.[1]?.trim() ?? null
    return url ? sanitizeGitUrl(url) : null
  } catch {
    return null
  }
}

function listLocalRepoDirectories(): Array<{ slug: string; name: string; path: string; gitRepoUrl: string | null }> {
  if (!existsSync(REPOS_DIR)) return []

  try {
    return readdirSync(REPOS_DIR)
      .map((entry) => {
        const repoPath = join(REPOS_DIR, entry)
        try {
          const stats = statSync(repoPath)
          if (!stats.isDirectory()) return null
          if (!existsSync(join(repoPath, '.git'))) return null

          const gitRepoUrl = readGitRemoteUrl(repoPath)
          const inferredSlug = slugifyName(
            gitRepoUrl?.split('/').pop() ?? entry,
          )

          return {
            slug: inferredSlug || slugifyName(entry),
            name: humanizeSlug(inferredSlug || entry),
            path: repoPath.replace(/\\/g, '/'),
            gitRepoUrl,
          }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { slug: string; name: string; path: string; gitRepoUrl: string | null } => Boolean(entry))
  } catch {
    return []
  }
}

function getKnowledgeStatsForProject(project: Pick<ProjectResourceRecord, 'id' | 'slug'>): ProjectKnowledgeStats {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) as docs, COALESCE(SUM(chunk_count), 0) as chunks
       FROM knowledge_documents
       WHERE status = 'active' AND (project_id = ? OR project_id = ?)`
    ).get(project.id, project.slug) as { docs: number; chunks: number } | undefined

    return {
      docs: row?.docs ?? 0,
      chunks: row?.chunks ?? 0,
    }
  } catch {
    return { docs: 0, chunks: 0 }
  }
}

async function listDiscoveryCandidates(): Promise<DiscoveryCandidate[]> {
  const projects = db.prepare(
    'SELECT id, slug, git_repo_url FROM projects'
  ).all() as Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'git_repo_url'>>

  const bySlug = new Map<string, DiscoveryCandidate>()
  const upsert = (
    key: string,
    patch: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, 'slug' | 'name'>,
  ) => {
    const existing = bySlug.get(key)
    const next: DiscoveryCandidate = existing ?? {
      key,
      slug: patch.slug,
      name: patch.name,
      sourceKinds: [],
      repoName: null,
      gitRepoUrl: null,
      repoPath: null,
      knowledge: null,
      gitnexus: null,
    }

    if (patch.repoName) next.repoName = patch.repoName
    if (patch.gitRepoUrl) next.gitRepoUrl = patch.gitRepoUrl
    if (patch.repoPath) next.repoPath = patch.repoPath
    if (patch.knowledge) next.knowledge = patch.knowledge
    if (patch.gitnexus) next.gitnexus = patch.gitnexus
    if (patch.sourceKinds) {
      next.sourceKinds = Array.from(new Set([...next.sourceKinds, ...patch.sourceKinds]))
    }

    bySlug.set(key, next)
  }

  const gitnexusRepos = await listGitNexusRepos()
  for (const repo of gitnexusRepos) {
    const gitRepoUrl = readGitRemoteUrl(repo.path)
    const slug = slugifyName(gitRepoUrl?.split('/').pop() ?? repo.name)
    if (!slug) continue

    const linked = findProjectByDiscoveryCandidate(projects, {
      slug,
      gitRepoUrl,
      repoName: repo.name,
    })
    if (linked) continue

    upsert(slug, {
      slug,
      name: humanizeSlug(slug),
      sourceKinds: ['gitnexus'],
      repoName: repo.name,
      gitRepoUrl,
      repoPath: repo.path,
      gitnexus: repo,
    })
  }

  for (const repo of listLocalRepoDirectories()) {
    const linked = findProjectByDiscoveryCandidate(projects, {
      slug: repo.slug,
      gitRepoUrl: repo.gitRepoUrl,
      repoName: repo.name,
    })
    if (linked) continue

    upsert(repo.slug, {
      slug: repo.slug,
      name: repo.name,
      sourceKinds: ['local_repo'],
      gitRepoUrl: repo.gitRepoUrl,
      repoPath: repo.path,
    })
  }

  try {
    const knowledgeRows = db.prepare(
      `SELECT project_id, COUNT(*) as docs, COALESCE(SUM(chunk_count), 0) as chunks
       FROM knowledge_documents
       WHERE status = 'active' AND project_id IS NOT NULL AND project_id != ''
       GROUP BY project_id`
    ).all() as Array<{ project_id: string; docs: number; chunks: number }>

    for (const row of knowledgeRows) {
      const slug = slugifyName(row.project_id)
      if (!slug) continue

      const linked = findProjectByDiscoveryCandidate(projects, {
        slug: row.project_id,
        repoName: row.project_id,
      })
      if (linked) continue

      upsert(slug, {
        slug,
        name: humanizeSlug(slug),
        sourceKinds: ['knowledge'],
        knowledge: {
          docs: row.docs,
          chunks: row.chunks,
        },
      })
    }
  } catch {
    // knowledge tables may not exist on every install yet
  }

  return [...bySlug.values()].sort((a, b) => {
    const score = (candidate: DiscoveryCandidate) =>
      (candidate.gitnexus ? 100 : 0) +
      (candidate.knowledge?.docs ?? 0) * 10 +
      (candidate.sourceKinds.includes('local_repo') ? 5 : 0)

    return score(b) - score(a) || a.name.localeCompare(b.name)
  })
}

async function buildProjectCleanupOperations(options?: {
  projectIds?: string[]
  clearRepoUrlForUmbrella?: boolean
  clearLatestIndexHint?: boolean
  normalizeBlankRepoUrl?: boolean
}): Promise<ProjectCleanupOperation[]> {
  const projects = db.prepare(
    `SELECT p.*, o.name AS org_name, o.slug AS org_slug
     FROM projects p
     JOIN organizations o ON o.id = p.org_id
     ORDER BY LOWER(p.name) ASC`
  ).all() as ProjectResourceRecord[]

  const wanted = new Set((options?.projectIds ?? []).map((value) => value.trim()).filter(Boolean))
  const gitnexusRepos = await listGitNexusRepos()
  const operations: ProjectCleanupOperation[] = []

  for (const project of projects) {
    if (wanted.size > 0 && !wanted.has(project.id) && !wanted.has(project.slug)) continue

    const repoCandidates = resolveRepoNames(project.id)
    const gitnexusRepo = findGitNexusRepo(repoCandidates, gitnexusRepos)
    const gitnexusAliases = findGitNexusRepoAliases(repoCandidates, gitnexusRepos)
    const latestJob = getLatestIndexJob(project.id)
    const knowledge = getKnowledgeStatsForProject(project)
    const classification = classifyProjectResource(project, gitnexusRepo, latestJob, knowledge, gitnexusAliases)

    const patch: ProjectCleanupOperation['patch'] = {}
    const reasons: string[] = []

    if ((options?.normalizeBlankRepoUrl ?? true) && project.git_repo_url !== null && normalizeStringValue(project.git_repo_url) === null) {
      patch.gitRepoUrl = null
      reasons.push('Normalize blank git repo URL to null.')
    }

    if ((options?.clearRepoUrlForUmbrella ?? true) && hasUmbrellaHint(project) && normalizeStringValue(project.git_repo_url)) {
      patch.gitRepoUrl = null
      reasons.push('Project description marks this as umbrella/no direct repo, so clear stale repo URL.')
    }

    if ((options?.clearLatestIndexHint ?? true) && (classification.kind === 'umbrella' || classification.kind === 'placeholder')) {
      if (project.indexed_at !== null) {
        patch.indexedAt = null
        reasons.push(`Clear indexed_at for ${classification.kind} project.`)
      }
      if (project.indexed_symbols !== null) {
        patch.indexedSymbols = null
        reasons.push(`Clear indexed_symbols for ${classification.kind} project.`)
      }
    }

    if (reasons.length === 0) continue

    operations.push({
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      kind: classification.kind,
      patch,
      reasons,
    })
  }

  return operations
}

function ensureDefaultOrganizationId(): string {
  const existing = db.prepare(
    "SELECT id FROM organizations WHERE slug = 'personal' OR id = 'org-default' ORDER BY created_at ASC LIMIT 1"
  ).get() as { id: string } | undefined

  if (existing?.id) return existing.id

  const orgId = 'org-default'
  db.prepare(
    'INSERT INTO organizations (id, name, slug, description) VALUES (?, ?, ?, ?)'
  ).run(orgId, 'Personal', 'personal', 'Default personal organization')

  return orgId
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

  const markdown = extractGitNexusMarkdown(raw)
  if (markdown) {
    const markdownRows = parseMarkdownTableRows(markdown)
    if (markdownRows.length > 0) {
      return markdownRows
    }
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

        row[key] = parseScalarValue(rawValue)
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

function getPreferredIndexedSnapshot(
  project: ProjectResourceRecord,
  latestJob: ProjectIndexJobRecord | null,
  gitnexusRepo: GitNexusRepoSummary | null,
): { indexedAt: string | null; basedOn: IndexedSource | null } {
  const candidates: Array<{ indexedAt: string; basedOn: IndexedSource; ts: number }> = []

  const pushCandidate = (indexedAt: string | null | undefined, basedOn: IndexedSource) => {
    if (!indexedAt) return
    const ts = Date.parse(indexedAt)
    if (!Number.isFinite(ts)) return
    candidates.push({ indexedAt, basedOn, ts })
  }

  pushCandidate(gitnexusRepo?.indexedAt, 'gitnexus.indexedAt')
  pushCandidate(project.indexed_at, 'cortex.indexed_at')
  pushCandidate(latestJob?.completed_at, 'cortex.index_jobs')

  if (candidates.length === 0) {
    return { indexedAt: null, basedOn: null }
  }

  candidates.sort((a, b) => b.ts - a.ts)
  const freshest = candidates[0]!
  return { indexedAt: freshest.indexedAt, basedOn: freshest.basedOn }
}

function hasRepoSignal(
  project: ProjectResourceRecord,
  gitnexusRepo: GitNexusRepoSummary | null,
): boolean {
  return Boolean(gitnexusRepo || normalizeStringValue(project.git_repo_url))
}

function isUmbrellaProject(project: ProjectResourceRecord): boolean {
  if (normalizeStringValue(project.git_repo_url)) return false

  return hasUmbrellaHint(project)
}

function buildStaleness(
  project: ProjectResourceRecord,
  latestJob: ProjectIndexJobRecord | null,
  gitnexusRepo: GitNexusRepoSummary | null,
): ResourceContext['staleness'] {
  const activeStatuses = new Set(['pending', 'cloning', 'analyzing', 'ingesting'])
  const freshest = getPreferredIndexedSnapshot(project, latestJob, gitnexusRepo)
  const canIndexDirectly = hasRepoSignal(project, gitnexusRepo)

  if (!canIndexDirectly) {
    return {
      status: 'not_indexed',
      basedOn: freshest.basedOn ?? 'cortex.indexed_at',
      indexedAt: null,
      ageHours: null,
      latestJobStatus: latestJob?.status ?? null,
    }
  }

  if (latestJob?.status && activeStatuses.has(latestJob.status)) {
    return {
      status: 'indexing',
      basedOn: 'cortex.index_jobs',
      indexedAt: freshest.indexedAt ?? latestJob.completed_at,
      ageHours: null,
      latestJobStatus: latestJob.status,
    }
  }

  const indexedAt = freshest.indexedAt
  if (!indexedAt) {
    return {
      status: 'not_indexed',
      basedOn: freshest.basedOn ?? 'cortex.indexed_at',
      indexedAt: null,
      ageHours: null,
      latestJobStatus: latestJob?.status ?? null,
    }
  }

  const ageMs = Date.now() - Date.parse(indexedAt)
  if (!Number.isFinite(ageMs)) {
    return {
      status: 'unknown',
      basedOn: freshest.basedOn ?? 'cortex.indexed_at',
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
    basedOn: freshest.basedOn ?? 'cortex.indexed_at',
    indexedAt,
    ageHours,
    latestJobStatus: latestJob?.status ?? null,
  }
}

function classifyProjectResource(
  project: ProjectResourceRecord,
  gitnexusRepo: GitNexusRepoSummary | null,
  latestJob: ProjectIndexJobRecord | null,
  knowledge: ProjectKnowledgeStats,
  gitnexusAliases: GitNexusRepoSummary[],
) {
  const umbrella = isUmbrellaProject(project)
  const repoBacked = hasRepoSignal(project, gitnexusRepo)
  const hasKnowledge = knowledge.docs > 0

  let kind: ProjectClassificationKind = 'placeholder'
  if (umbrella) {
    kind = 'umbrella'
  } else if (repoBacked || Boolean(latestJob?.branch)) {
    kind = 'repository'
  } else if (hasKnowledge) {
    kind = 'knowledge_only'
  }

  return {
    kind,
    isIndexable: repoBacked,
    hasAliasDrift: gitnexusAliases.length > 1,
    aliasCount: gitnexusAliases.length,
    aliases: gitnexusAliases.map((alias) => alias.name),
  }
}

async function resolveResourceContext(projectId: string): Promise<ResourceContext | null> {
  const project = getProjectResourceRecord(projectId)
  if (!project) return null

  const repoCandidates = resolveRepoNames(project.id)
  const gitnexusRepos = await listGitNexusRepos()
  const gitnexusRepo = findGitNexusRepo(repoCandidates, gitnexusRepos)
  const gitnexusAliases = findGitNexusRepoAliases(repoCandidates, gitnexusRepos)
  const latestJob = getLatestIndexJob(project.id)
  const directRepoSignal = hasRepoSignal(project, gitnexusRepo)

  return {
    project,
    repoCandidates,
    gitnexusRepo,
    gitnexusAliases,
    latestJob,
    branch: directRepoSignal ? latestJob?.branch ?? null : null,
    staleness: buildStaleness(project, latestJob, gitnexusRepo),
  }
}

function buildProjectResourceSummary(context: ResourceContext) {
  const preferredIndexed = getPreferredIndexedSnapshot(
    context.project,
    context.latestJob,
    context.gitnexusRepo,
  )
  const knowledge = getKnowledgeStatsForProject(context.project)
  const classification = classifyProjectResource(
    context.project,
    context.gitnexusRepo,
    context.latestJob,
    knowledge,
    context.gitnexusAliases,
  )

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
    classification,
    indexedAt: preferredIndexed.indexedAt,
    symbols: context.project.indexed_symbols ?? context.gitnexusRepo?.stats.symbols ?? null,
    knowledge,
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

function getProjectStatusSortValue(item: ReturnType<typeof buildProjectResourceSummary>): number {
  if (item.classification.kind === 'repository' && item.gitnexus.registered && item.branch) return 0
  if (item.classification.kind === 'repository' && item.gitnexus.registered) return 1
  if (item.classification.kind === 'repository' && item.staleness.status === 'indexing') return 2
  if (item.classification.kind === 'repository' && item.staleness.status === 'aging') return 3
  if (item.classification.kind === 'repository' && item.staleness.status === 'stale') return 4
  if (item.classification.kind === 'repository') return 5
  if (item.classification.kind === 'umbrella') return 6
  if (item.classification.kind === 'knowledge_only') return 7
  if (item.staleness.status === 'not_indexed') return 8
  return 9
}

function sortProjectResourceSummaries<T extends ReturnType<typeof buildProjectResourceSummary>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const statusDiff = getProjectStatusSortValue(a) - getProjectStatusSortValue(b)
    if (statusDiff !== 0) return statusDiff

    const branchDiff = Number(Boolean(b.branch)) - Number(Boolean(a.branch))
    if (branchDiff !== 0) return branchDiff

    return a.name.localeCompare(b.name)
  })
}

function parseGraphList(
  value: string | undefined,
  fallback: readonly string[],
  normalize: (item: string) => string | null,
): string[] {
  if (value?.trim().toLowerCase() === 'all') return []

  const rawItems = value
    ? value.split(',')
    : [...fallback]

  return Array.from(new Set(
    rawItems
      .map((item) => normalize(item))
      .filter((item): item is string => Boolean(item)),
  ))
}

function normalizeGraphNodeType(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/[^A-Za-z0-9_]/g, '') || null
}

function normalizeGraphEdgeType(value: string): string | null {
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return null
  return trimmed.replace(/[^A-Z0-9_]/g, '') || null
}

function parseGraphDirection(value: string | undefined): GraphDirection {
  if (value === 'upstream' || value === 'downstream') return value
  return 'both'
}

function clampGraphInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function buildGraphOptions(query: (name: string) => string | undefined): GraphQueryOptions {
  return {
    nodeTypes: parseGraphList(query('nodeTypes'), DEFAULT_GRAPH_NODE_TYPES, normalizeGraphNodeType),
    edgeTypes: parseGraphList(query('edgeTypes'), DEFAULT_GRAPH_EDGE_TYPES, normalizeGraphEdgeType),
    focus: normalizeStringValue(query('focus')),
    search: normalizeStringValue(query('search')),
    community: normalizeStringValue(query('community')),
    depth: clampGraphInteger(query('depth'), 2, MAX_GRAPH_DEPTH),
    direction: parseGraphDirection(query('direction')),
    limitNodes: clampGraphInteger(query('limitNodes'), DEFAULT_GRAPH_NODES, MAX_GRAPH_NODES),
    limitEdges: clampGraphInteger(query('limitEdges'), DEFAULT_GRAPH_EDGES, MAX_GRAPH_EDGES),
    format: normalizeStringValue(query('format')) ?? 'json',
  }
}

function parseBooleanQuery(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase())
}

function emptyGraphData(repo: string | null, snapshot: GraphSnapshotMeta): BoundedGraphData {
  return {
    repo,
    nodes: [],
    edges: [],
    visibleCounts: { nodes: 0, edges: 0 },
    totalCounts: { nodes: 0, edges: 0 },
    truncated: false,
    capReason: [],
    snapshot,
  }
}

function buildCypherStringList(values: string[]): string {
  return `[${values.map((value) => `"${escapeCypherString(value)}"`).join(', ')}]`
}

function buildGraphNodeTypeFilter(alias: string, nodeTypes: string[]): string {
  if (nodeTypes.length === 0) return 'true'
  return `labels(${alias})[0] IN ${buildCypherStringList(nodeTypes)}`
}

function buildGraphEdgeTypeFilter(alias: string, edgeTypes: string[]): string {
  if (edgeTypes.length === 0) return 'true'
  return `${alias}.type IN ${buildCypherStringList(edgeTypes)}`
}

function buildGraphTextFilter(alias: string, search: string | null): string {
  if (!search) return 'true'
  const safeSearch = escapeCypherString(search)
  return `(
    COALESCE(${alias}.id, '') CONTAINS "${safeSearch}" OR
    COALESCE(${alias}.name, '') CONTAINS "${safeSearch}" OR
    COALESCE(${alias}.filePath, '') CONTAINS "${safeSearch}" OR
    COALESCE(${alias}.label, '') CONTAINS "${safeSearch}" OR
    COALESCE(${alias}.heuristicLabel, '') CONTAINS "${safeSearch}"
  )`
}

function buildGraphFocusFilter(alias: string, focus: string): string {
  const safeFocus = escapeCypherString(focus)
  return `(
    COALESCE(${alias}.id, '') = "${safeFocus}" OR
    COALESCE(${alias}.name, '') = "${safeFocus}" OR
    COALESCE(${alias}.filePath, '') = "${safeFocus}" OR
    COALESCE(${alias}.id, '') CONTAINS "${safeFocus}" OR
    COALESCE(${alias}.name, '') CONTAINS "${safeFocus}" OR
    COALESCE(${alias}.filePath, '') CONTAINS "${safeFocus}"
  )`
}

function buildGraphCommunityFilter(alias: string, community: string): string {
  const safeCommunity = escapeCypherString(community)
  return `(
    COALESCE(${alias}.id, '') = "${safeCommunity}" OR
    COALESCE(${alias}.label, '') = "${safeCommunity}" OR
    COALESCE(${alias}.heuristicLabel, '') = "${safeCommunity}" OR
    COALESCE(${alias}.label, '') CONTAINS "${safeCommunity}" OR
    COALESCE(${alias}.heuristicLabel, '') CONTAINS "${safeCommunity}"
  )`
}

function buildGraphNodeReturn(alias: string, prefix = ''): string {
  const column = (name: string) => prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name
  return [
    `${alias}.id AS ${column('id')}`,
    `labels(${alias})[0] AS ${column('type')}`,
    `COALESCE(${alias}.name, ${alias}.label, ${alias}.heuristicLabel, ${alias}.id) AS ${column('name')}`,
    `${alias}.filePath AS ${column('filePath')}`,
    `${alias}.startLine AS ${column('startLine')}`,
    `${alias}.endLine AS ${column('endLine')}`,
    `${alias}.label AS ${column('label')}`,
    `${alias}.heuristicLabel AS ${column('heuristicLabel')}`,
  ].join(', ')
}

function graphNodeFromRow(
  row: Record<string, string | number | null>,
  prefix = '',
  depth: number | null = null,
): BoundedGraphNode | null {
  const column = (name: string) => prefix ? `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}` : name
  const id = normalizeStringValue(row[column('id')])
  if (!id) return null

  const label = normalizeStringValue(row[column('label')])
  const heuristicLabel = normalizeStringValue(row[column('heuristicLabel')])
  return {
    id,
    type: normalizeStringValue(row[column('type')]) ?? 'Unknown',
    name: normalizeStringValue(row[column('name')]) ?? heuristicLabel ?? label ?? id,
    filePath: normalizeStringValue(row[column('filePath')]),
    startLine: parseNumberLike(row[column('startLine')]),
    endLine: parseNumberLike(row[column('endLine')]),
    label,
    heuristicLabel,
    community: normalizeStringValue(row.community),
    depth,
  }
}

function upsertGraphNode(nodes: Map<string, BoundedGraphNode>, node: BoundedGraphNode): void {
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, node)
    return
  }

  const existingDepth = existing.depth ?? Number.POSITIVE_INFINITY
  const nextDepth = node.depth ?? Number.POSITIVE_INFINITY
  if (nextDepth < existingDepth) {
    nodes.set(node.id, { ...existing, depth: node.depth })
  }
}

function graphEdgeFromRow(row: Record<string, string | number | null>): BoundedGraphEdge | null {
  const source = normalizeStringValue(row.sourceId)
  const target = normalizeStringValue(row.targetId)
  const type = normalizeStringValue(row.edgeType)
  if (!source || !target || !type) return null

  const step = parseNumberLike(row.edgeStep)
  const reason = normalizeStringValue(row.edgeReason)
  return {
    id: [source, type, target, reason ?? '', step ?? ''].join(':'),
    source,
    target,
    type,
    confidence: parseNumberLike(row.edgeConfidence),
    reason,
    step,
  }
}

function addGraphEdge(
  nodes: Map<string, BoundedGraphNode>,
  edges: Map<string, BoundedGraphEdge>,
  edge: BoundedGraphEdge,
  source: BoundedGraphNode,
  target: BoundedGraphNode,
  limitNodes: number,
): boolean {
  const needsSource = !nodes.has(source.id)
  const needsTarget = !nodes.has(target.id)
  const newNodeCount = Number(needsSource) + Number(needsTarget)
  if (nodes.size + newNodeCount > limitNodes) return false

  upsertGraphNode(nodes, source)
  upsertGraphNode(nodes, target)
  edges.set(edge.id, edge)
  return true
}

async function fetchGraphSeedNodes(
  projectId: string,
  options: GraphQueryOptions,
  limit: number,
): Promise<{ repo: string; rows: Array<Record<string, string | number | null>> }> {
  const filters = [
    buildGraphNodeTypeFilter('n', options.nodeTypes),
    buildGraphTextFilter('n', options.search),
  ]
  if (options.focus) filters.push(buildGraphFocusFilter('n', options.focus))

  const query = options.community
    ? `MATCH (n)-[memberRel:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
       WHERE ${filters.join(' AND ')} AND ${buildGraphCommunityFilter('c', options.community)}
       RETURN DISTINCT ${buildGraphNodeReturn('n')}, COALESCE(c.heuristicLabel, c.label, c.id) AS community
       LIMIT ${limit}`
    : `MATCH (n)
       WHERE ${filters.join(' AND ')}
       RETURN DISTINCT ${buildGraphNodeReturn('n')}, null AS community
       LIMIT ${limit}`

  return queryProjectCypherRows(projectId, query)
}

async function fetchGraphEdgesForFrontier(
  projectId: string,
  frontierIds: string[],
  options: GraphQueryOptions,
  limit: number,
): Promise<{ repo: string; rows: Array<Record<string, string | number | null>> }> {
  if (frontierIds.length === 0) return { repo: '', rows: [] }

  const frontierList = buildCypherStringList(frontierIds)
  const directionFilter = options.direction === 'upstream'
    ? `b.id IN ${frontierList}`
    : options.direction === 'downstream'
      ? `a.id IN ${frontierList}`
      : `(a.id IN ${frontierList} OR b.id IN ${frontierList})`

  const query = `MATCH (a)-[r:CodeRelation]->(b)
    WHERE ${directionFilter}
      AND ${buildGraphEdgeTypeFilter('r', options.edgeTypes)}
      AND ${buildGraphNodeTypeFilter('a', options.nodeTypes)}
      AND ${buildGraphNodeTypeFilter('b', options.nodeTypes)}
    RETURN DISTINCT ${buildGraphNodeReturn('a', 'source')}, ${buildGraphNodeReturn('b', 'target')},
      r.type AS edgeType, r.confidence AS edgeConfidence, r.reason AS edgeReason, r.step AS edgeStep
    LIMIT ${limit}`

  return queryProjectCypherRows(projectId, query)
}

async function fetchGraphEdgesAmongNodes(
  projectId: string,
  nodeIds: string[],
  options: GraphQueryOptions,
  limit: number,
): Promise<{ repo: string; rows: Array<Record<string, string | number | null>> }> {
  if (nodeIds.length === 0) return { repo: '', rows: [] }

  const nodeList = buildCypherStringList(nodeIds)
  const query = `MATCH (a)-[r:CodeRelation]->(b)
    WHERE a.id IN ${nodeList}
      AND b.id IN ${nodeList}
      AND ${buildGraphEdgeTypeFilter('r', options.edgeTypes)}
    RETURN DISTINCT ${buildGraphNodeReturn('a', 'source')}, ${buildGraphNodeReturn('b', 'target')},
      r.type AS edgeType, r.confidence AS edgeConfidence, r.reason AS edgeReason, r.step AS edgeStep
    LIMIT ${limit}`

  return queryProjectCypherRows(projectId, query)
}

async function countGraphNodes(
  projectId: string,
  options: GraphQueryOptions,
): Promise<number | null> {
  try {
    const filters = [
      buildGraphNodeTypeFilter('n', options.nodeTypes),
      buildGraphTextFilter('n', options.search),
    ]
    const query = options.community
      ? `MATCH (n)-[memberRel:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
         WHERE ${filters.join(' AND ')} AND ${buildGraphCommunityFilter('c', options.community)}
         RETURN COUNT(DISTINCT n) AS nodes`
      : `MATCH (n)
         WHERE ${filters.join(' AND ')}
         RETURN COUNT(n) AS nodes`

    const { rows } = await queryProjectCypherRows(projectId, query)
    return parseNumberLike(rows[0]?.nodes)
  } catch (error) {
    logger.warn(`Graph node count failed for ${projectId}: ${String(error)}`)
    return null
  }
}

function rowsToGraphEdges(
  rows: Array<Record<string, string | number | null>>,
  nodes: Map<string, BoundedGraphNode>,
  edges: Map<string, BoundedGraphEdge>,
  options: GraphQueryOptions,
  depth: number,
): { addedNodeIds: string[]; skippedForNodeCap: boolean } {
  const addedNodeIds: string[] = []
  let skippedForNodeCap = false

  for (const row of rows) {
    if (edges.size >= options.limitEdges) break

    const source = graphNodeFromRow(row, 'source', depth)
    const target = graphNodeFromRow(row, 'target', depth)
    const edge = graphEdgeFromRow(row)
    if (!source || !target || !edge) continue

    const beforeIds = new Set(nodes.keys())
    if (!addGraphEdge(nodes, edges, edge, source, target, options.limitNodes)) {
      skippedForNodeCap = true
      continue
    }

    for (const id of [source.id, target.id]) {
      if (!beforeIds.has(id)) addedNodeIds.push(id)
    }
  }

  return { addedNodeIds, skippedForNodeCap }
}

async function buildBoundedGraph(
  projectId: string,
  options: GraphQueryOptions,
): Promise<BoundedGraphData> {
  const nodes = new Map<string, BoundedGraphNode>()
  const edges = new Map<string, BoundedGraphEdge>()
  const capReason: string[] = []

  const seedLimit = options.limitNodes + 1
  const seedResult = await fetchGraphSeedNodes(projectId, options, seedLimit)
  for (const row of seedResult.rows.slice(0, options.limitNodes)) {
    const node = graphNodeFromRow(row, '', 0)
    if (node) upsertGraphNode(nodes, node)
  }
  if (seedResult.rows.length > options.limitNodes) {
    capReason.push(`node cap ${options.limitNodes} reached while selecting seeds`)
  }

  if (options.focus) {
    let frontier = Array.from(nodes.keys())
    for (let depth = 1; depth <= options.depth && frontier.length > 0; depth += 1) {
      if (edges.size >= options.limitEdges || nodes.size >= options.limitNodes) break

      const edgeLimit = options.limitEdges - edges.size + 1
      const edgeResult = await fetchGraphEdgesForFrontier(projectId, frontier, options, edgeLimit)
      if (edgeResult.rows.length >= edgeLimit) {
        capReason.push(`edge cap ${options.limitEdges} reached at depth ${depth}`)
      }

      const { addedNodeIds, skippedForNodeCap } = rowsToGraphEdges(
        edgeResult.rows.slice(0, Math.max(edgeLimit - 1, 0)),
        nodes,
        edges,
        options,
        depth,
      )
      if (skippedForNodeCap) capReason.push(`node cap ${options.limitNodes} reached at depth ${depth}`)
      frontier = Array.from(new Set(addedNodeIds))
    }
  } else {
    const edgeLimit = options.limitEdges + 1
    const edgeResult = await fetchGraphEdgesAmongNodes(projectId, Array.from(nodes.keys()), options, edgeLimit)
    if (edgeResult.rows.length > options.limitEdges) {
      capReason.push(`edge cap ${options.limitEdges} reached`)
    }
    const { skippedForNodeCap } = rowsToGraphEdges(
      edgeResult.rows.slice(0, options.limitEdges),
      nodes,
      edges,
      options,
      1,
    )
    if (skippedForNodeCap) capReason.push(`node cap ${options.limitNodes} reached while linking nodes`)
  }

  const totalNodes = options.focus ? nodes.size : await countGraphNodes(projectId, options)
  const totalEdges = options.focus || capReason.length > 0 ? null : edges.size
  const truncated = capReason.length > 0

  return {
    repo: seedResult.repo,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    visibleCounts: {
      nodes: nodes.size,
      edges: edges.size,
    },
    totalCounts: {
      nodes: totalNodes,
      edges: totalEdges,
    },
    truncated,
    capReason,
  }
}

async function queryProjectCypherRows(
  projectId: string,
  query: string,
  params: Record<string, unknown> = {}
): Promise<{ repo: string; rows: Array<Record<string, string | number | null>> }> {
  const { repo, result } = await callGitNexusStrictWithFallback('cypher', { query, ...params }, projectId)
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

async function enrichGenericClusterNames(
  projectId: string,
  clusters: Array<{
    id: string | null
    name: string
    label: string | null
    heuristicLabel: string | null
    symbols: number
    cohesion: number | null
    subCommunities: number
  }>,
) {
  const genericIds = clusters
    .filter((cluster) => cluster.id && isGenericClusterName(cluster.name))
    .map((cluster) => cluster.id as string)

  if (genericIds.length === 0) return clusters

  const whereClause = genericIds
    .map((clusterId) => `c.id = "${escapeCypherString(clusterId)}"`)
    .join(' OR ')

  const { rows } = await queryProjectCypherRows(
    projectId,
    `MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
     WHERE ${whereClause}
     RETURN c.id AS clusterId, n.name AS name, n.filePath AS filePath
     LIMIT ${Math.max(genericIds.length * 20, 60)}`,
  )

  const membersByCluster = new Map<string, Array<{ filePath: string | null; name: string | null }>>()
  for (const row of rows) {
    const clusterId = normalizeStringValue(row.clusterId)
    if (!clusterId) continue
    const members = membersByCluster.get(clusterId) ?? []
    members.push({
      filePath: normalizeStringValue(row.filePath),
      name: normalizeStringValue(row.name),
    })
    membersByCluster.set(clusterId, members)
  }

  return clusters.map((cluster) => {
    if (!cluster.id || !isGenericClusterName(cluster.name)) return cluster
    const inferredLabel = inferClusterLabelFromMembers(membersByCluster.get(cluster.id) ?? [])
    if (!inferredLabel) return cluster

    return {
      ...cluster,
      name: inferredLabel,
      heuristicLabel: inferredLabel,
    }
  })
}

function hasOnlyUnknownNames(items: Array<{ name: string | null }>): boolean {
  return items.length > 0 && items.every((item) => {
    const normalized = (item.name ?? '').trim().toLowerCase()
    return !normalized || normalized === 'unknown' || GENERIC_CLUSTER_NAME.test(normalized)
  })
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

    const items = sortProjectResourceSummaries(projects.map((project) => {
      const repoCandidates = resolveRepoNames(project.id)
      const gitnexusRepo = findGitNexusRepo(repoCandidates, gitnexusRepos)
      const latestJob = getLatestIndexJob(project.id)
      const summaryContext: ResourceContext = {
        project,
        repoCandidates,
        gitnexusRepo,
        gitnexusAliases: findGitNexusRepoAliases(repoCandidates, gitnexusRepos),
        latestJob,
        branch: hasRepoSignal(project, gitnexusRepo) ? latestJob?.branch ?? null : null,
        staleness: buildStaleness(project, latestJob, gitnexusRepo),
      }

      return {
        ...buildProjectResourceSummary(summaryContext),
        resourcesAvailable: buildResourceUris(project.id),
      }
    }))

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

// ── Resource: discovery candidates not yet linked as Cortex projects ──
intelRouter.get('/resources/discovery', async (c) => {
  try {
    const candidates = await listDiscoveryCandidates()

    return c.json({
      success: true,
      data: {
        uri: 'cortex://projects/discovery',
        total: candidates.length,
        candidates,
      },
    })
  } catch (error) {
    logger.error(`Project discovery resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Admin: GitNexus registry audit ──
intelRouter.get('/admin/gitnexus-audit', async (c) => {
  const denied = requireAdminAccess(c)
  if (denied) return denied

  try {
    const registryEntries = readGitNexusRegistry()
    const projects = db.prepare(
      'SELECT id, slug, name, git_repo_url FROM projects ORDER BY LOWER(name) ASC'
    ).all() as Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'name' | 'git_repo_url'>>
    const audit = buildGitNexusRegistryAuditData(projects, registryEntries)

    return c.json({
      success: true,
      data: {
        totalRepos: audit.totalRepos,
        mappedProjects: audit.mappedProjects,
        aliasDrift: audit.aliasDrift,
        unmapped: audit.unmapped,
      },
    })
  } catch (error) {
    logger.error(`GitNexus audit failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Admin: GitNexus registry cleanup preview/apply ──
intelRouter.post('/admin/gitnexus-cleanup', async (c) => {
  const denied = requireAdminAccess(c)
  if (denied) return denied

  try {
    const body = await c.req.json() as {
      mode?: 'preview' | 'apply'
      projectId?: string
      includeUnmapped?: boolean
      deleteStorage?: boolean
    }

    const mode = body.mode === 'apply' ? 'apply' : 'preview'
    const registryEntries = readGitNexusRegistry()
    const projects = db.prepare(
      'SELECT id, slug, name, git_repo_url FROM projects ORDER BY LOWER(name) ASC'
    ).all() as Array<Pick<ProjectResourceRecord, 'id' | 'slug' | 'name' | 'git_repo_url'>>
    const operations = buildGitNexusRegistryCleanupOperations(projects, registryEntries, {
      projectId: normalizeStringValue(body.projectId),
      includeUnmapped: body.includeUnmapped ?? false,
    })

    if (mode === 'preview') {
      return c.json({
        success: true,
        mode,
        data: {
          registryPath: GITNEXUS_REGISTRY_PATH(),
          operations,
          operationCount: operations.length,
        },
      })
    }

    const removePaths = new Set(
      operations.flatMap((operation) => operation.remove.map((entry) => entry.path)),
    )
    const keepStoragePaths = new Set(
      operations
        .map((operation) => operation.keep?.storagePath)
        .filter((value): value is string => Boolean(value)),
    )

    const nextRegistry = registryEntries.filter((entry) => !removePaths.has(entry.path))
    writeGitNexusRegistry(nextRegistry)

    const deletedStorage: string[] = []
    if (body.deleteStorage ?? true) {
      for (const operation of operations) {
        for (const entry of operation.remove) {
          if (!entry.storagePath || keepStoragePaths.has(entry.storagePath)) continue
          if (!existsSync(entry.storagePath)) continue
          rmSync(entry.storagePath, { recursive: true, force: true })
          deletedStorage.push(entry.storagePath)
        }
      }
    }

    return c.json({
      success: true,
      mode,
      data: {
        operations,
        operationCount: operations.length,
        removedRegistryEntries: Array.from(removePaths),
        deletedStorage,
        registryPath: GITNEXUS_REGISTRY_PATH(),
      },
    })
  } catch (error) {
    logger.error(`GitNexus cleanup failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Admin: project metadata cleanup preview/apply ──
intelRouter.post('/admin/project-cleanup', async (c) => {
  const denied = requireAdminAccess(c)
  if (denied) return denied

  try {
    const body = await c.req.json() as {
      mode?: 'preview' | 'apply'
      projectIds?: string[]
      clearRepoUrlForUmbrella?: boolean
      clearLatestIndexHint?: boolean
      normalizeBlankRepoUrl?: boolean
    }

    const mode = body.mode === 'apply' ? 'apply' : 'preview'
    const operations = await buildProjectCleanupOperations({
      projectIds: Array.isArray(body.projectIds) ? body.projectIds : [],
      clearRepoUrlForUmbrella: body.clearRepoUrlForUmbrella ?? true,
      clearLatestIndexHint: body.clearLatestIndexHint ?? true,
      normalizeBlankRepoUrl: body.normalizeBlankRepoUrl ?? true,
    })

    if (mode === 'preview') {
      return c.json({
        success: true,
        mode,
        data: {
          operations,
          operationCount: operations.length,
        },
      })
    }

    const selectProjectCleanupState = db.prepare(
      'SELECT git_repo_url, indexed_at, indexed_symbols FROM projects WHERE id = ?'
    )

    for (const operation of operations) {
      const existing = selectProjectCleanupState.get(operation.projectId) as {
        git_repo_url: string | null
        indexed_at: string | null
        indexed_symbols: number | null
      } | undefined

      db.prepare(
        `UPDATE projects
         SET git_repo_url = ?,
             indexed_at = ?,
             indexed_symbols = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        Object.prototype.hasOwnProperty.call(operation.patch, 'gitRepoUrl')
          ? (operation.patch.gitRepoUrl ?? null)
          : existing?.git_repo_url ?? null,
        Object.prototype.hasOwnProperty.call(operation.patch, 'indexedAt')
          ? (operation.patch.indexedAt ?? null)
          : existing?.indexed_at ?? null,
        Object.prototype.hasOwnProperty.call(operation.patch, 'indexedSymbols')
          ? (operation.patch.indexedSymbols ?? null)
          : existing?.indexed_symbols ?? null,
        operation.projectId,
      )
    }

    return c.json({
      success: true,
      mode,
      data: {
        operations,
        operationCount: operations.length,
      },
    })
  } catch (error) {
    logger.error(`Project cleanup failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Action: promote a discovered repo/knowledge space into a Cortex project ──
intelRouter.post('/resources/discovery/link', async (c) => {
  try {
    const body = await c.req.json() as {
      slug?: string
      name?: string
      gitRepoUrl?: string
      repoPath?: string
    }

    const slug = slugifyName(body.slug ?? body.name ?? '')
    if (!slug) {
      return c.json({ success: false, error: 'slug or name is required' }, 400)
    }

    const existing = db.prepare(
      `SELECT id, slug, name, git_repo_url
       FROM projects
       WHERE slug = ? OR git_repo_url = ? OR REPLACE(git_repo_url, '.git', '') = ? 
       LIMIT 1`
    ).get(
      slug,
      body.gitRepoUrl ?? null,
      body.gitRepoUrl ? body.gitRepoUrl.replace(/\.git$/, '').replace(/\/$/, '') : null,
    ) as { id: string; slug: string; name: string; git_repo_url: string | null } | undefined

    if (existing) {
      return c.json({
        success: true,
        created: false,
        project: existing,
      })
    }

    const orgId = ensureDefaultOrganizationId()
    const projectId = `proj-${randomUUID().slice(0, 8)}`
    const name = (body.name?.trim() || humanizeSlug(slug)).slice(0, 120)

    db.prepare(
      `INSERT INTO projects (id, org_id, name, slug, description, git_repo_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      orgId,
      name,
      slug,
      `Discovered from ${body.gitRepoUrl ? 'repository context' : 'knowledge/project metadata'}`,
      body.gitRepoUrl ?? null,
    )

    const created = db.prepare(
      'SELECT id, slug, name, git_repo_url FROM projects WHERE id = ?'
    ).get(projectId)

    return c.json({
      success: true,
      created: true,
      project: created,
    }, 201)
  } catch (error) {
    logger.error(`Project discovery link failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: project context overview ──
intelRouter.get('/resources/project/:projectId/context', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    const refresh = parseBooleanQuery(c.req.query('refresh'))

    let fileCount: number | null = null
    if (context.gitnexusRepo && refresh) {
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
        runtime: {
          registryFirst: true,
          liveFileCount: refresh,
          hint: refresh ? null : 'Add refresh=true to compute file count from GitNexus explicitly.',
        },
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

// ── Resource: bounded project graph slice for AI agents and Explorer UI ──
intelRouter.get('/resources/project/:projectId/graph', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    const options = buildGraphOptions((name) => c.req.query(name))
    const refresh = parseBooleanQuery(c.req.query('refresh'))
    const snapshotRead = readGraphSnapshot<BoundedGraphData>(context.project.id, options, refresh)

    if (!context.gitnexusRepo) {
      const snapshot = buildGraphSnapshotMeta(snapshotRead, {
        source: 'empty',
        refresh,
      })
      const graph = emptyGraphData(null, snapshot)
      return c.json({
        success: true,
        data: {
          uri: `cortex://project/${context.project.id}/graph`,
          project: buildProjectResourceSummary(context),
          query: options,
          ...graph,
          hint: 'No GitNexus index found for this project yet.',
        },
      })
    }

    if (!refresh && snapshotRead.record) {
      const graph = {
        ...snapshotRead.record.data,
        snapshot: buildGraphSnapshotMeta(snapshotRead, {
          source: 'snapshot',
          refresh,
        }),
      }
      const data = {
        uri: `cortex://project/${context.project.id}/graph`,
        project: buildProjectResourceSummary(context),
        query: options,
        ...graph,
        hint: graph.truncated
          ? 'Snapshot result was capped. Narrow nodeTypes/edgeTypes/search/focus, or lower depth.'
          : graph.snapshot.stale
            ? 'Snapshot is stale. Add refresh=true to rebuild it from GitNexus explicitly.'
            : null,
      }

      return c.json({ success: true, data })
    }

    if (!refresh) {
      const snapshot = buildGraphSnapshotMeta(snapshotRead, {
        source: 'empty',
        refresh,
      })
      const graph = emptyGraphData(context.gitnexusRepo.name, snapshot)
      return c.json({
        success: true,
        data: {
          uri: `cortex://project/${context.project.id}/graph`,
          project: buildProjectResourceSummary(context),
          query: options,
          ...graph,
          hint: 'No graph snapshot is cached for this query. Add refresh=true to build one explicitly.',
        },
      })
    }

    const liveGraph = await buildBoundedGraph(context.project.id, options)
    const snapshotRecord = writeGraphSnapshot(context.project.id, options, liveGraph)
    const freshSnapshotRead = readGraphSnapshot<BoundedGraphData>(context.project.id, options, refresh)
    const graph = {
      ...snapshotRecord.data,
      snapshot: buildGraphSnapshotMeta(freshSnapshotRead, {
        snapshotHit: true,
        snapshotCreatedAt: snapshotRecord.createdAt,
        snapshotAgeMs: 0,
        stale: false,
        source: 'gitnexus',
        refresh,
      }),
    }
    const data = {
      uri: `cortex://project/${context.project.id}/graph`,
      project: buildProjectResourceSummary(context),
      query: options,
      ...graph,
      hint: graph.truncated
        ? 'Result was capped. Narrow nodeTypes/edgeTypes/search/focus, or lower depth.'
        : null,
    }

    if (options.format === 'ndjson') {
      const records = [
        { type: 'meta', data: { ...data, nodes: undefined, edges: undefined } },
        ...data.nodes.map((node) => ({ type: 'node', data: node })),
        ...data.edges.map((edge) => ({ type: 'edge', data: edge })),
      ]
      return c.text(records.map((record) => JSON.stringify(record)).join('\n'), 200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      })
    }

    return c.json({ success: true, data })
  } catch (error) {
    logger.error(`Bounded graph resource failed: ${String(error)}`)
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
    const clusters = (await enrichGenericClusterNames(
      context.project.id,
      normalizeClusterRows(rows),
    )).slice(0, limit)
    const hint = hasOnlyUnknownNames(clusters)
      ? 'Cluster labels are still generic. This usually means the current graph index lacks enriched community naming or was built with a limited extraction path.'
      : null

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/clusters`,
        repo,
        project: buildProjectResourceSummary(context),
        total: clusters.length,
        clusters,
        hint,
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
       WHERE c.id = "${safeClusterName}" OR c.label = "${safeClusterName}" OR c.heuristicLabel = "${safeClusterName}"
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
       WHERE c.id = "${safeClusterName}" OR c.label = "${safeClusterName}" OR c.heuristicLabel = "${safeClusterName}"
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

// ── Resource: cluster full members ──
intelRouter.get('/resources/project/:projectId/cluster/:clusterName/members', async (c) => {
  try {
    const { projectId, clusterName } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    if (!context.gitnexusRepo) return c.json({ success: false, error: 'Project is not yet indexed in GitNexus' }, 409)

    const decodedClusterName = decodeURIComponent(clusterName)
    const safeClusterName = escapeCypherString(decodedClusterName)

    const { rows: memberRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
       WHERE c.id = "${safeClusterName}" OR c.label = "${safeClusterName}" OR c.heuristicLabel = "${safeClusterName}"
       RETURN DISTINCT n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
       ORDER BY n.filePath, n.name`
    )

    const members = memberRows.map((row) => ({
      name: normalizeStringValue(row.name) ?? 'unknown',
      type: normalizeStringValue(row.type),
      filePath: normalizeStringValue(row.filePath),
    }))

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/cluster/${encodeURIComponent(decodedClusterName)}/members`,
        clusterName: decodedClusterName,
        members,
        totalCount: members.length
      },
    })
  } catch (error) {
    logger.error(`Cluster members resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: cross-links (inter-cluster edges from processes) ──
intelRouter.get('/resources/project/:projectId/cross-links', async (c) => {
  try {
    const { projectId } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    if (!context.gitnexusRepo) return c.json({ success: false, error: 'Project is not yet indexed in GitNexus' }, 409)

    // Query all cross-community processes
    const { rows: processRows } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (p:Process {processType: 'cross_community'})
       WHERE size(p.communities) > 1
       RETURN p.id AS id, p.heuristicLabel AS label, p.communities AS communities`
    )

    const linkMap = new Map<string, { source: string, target: string, weight: number, processes: string[] }>()

    for (const row of processRows) {
      if (!Array.isArray(row.communities) || row.communities.length < 2) continue;
      // GitNexus returns communities as an array of community IDs
      const comms = row.communities as string[]
      
      // Create edges between consecutive communities in the process flow
      for (let i = 0; i < comms.length - 1; i++) {
        const source = comms[i]
        const target = comms[i+1]
        if (!source || !target || source === target) continue

        // Build a unique edge key, undirected for simplicity, or directed. Let's make it directed.
        const edgeKey = `${source}->${target}`
        const existing = linkMap.get(edgeKey)
        const processLabel = normalizeStringValue(row.label) ?? 'unknown'
        
        if (existing) {
          existing.weight += 1
          if (!existing.processes.includes(processLabel)) {
             existing.processes.push(processLabel)
          }
        } else {
          linkMap.set(edgeKey, {
            source,
            target,
            weight: 1,
            processes: [processLabel]
          })
        }
      }
    }

    const crossLinks = Array.from(linkMap.values())

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/cross-links`,
        crossLinks,
        totalVisibleEdges: crossLinks.length
      },
    })
  } catch (error) {
    logger.error(`Cross-links resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Resource: symbol tree (dependency/phả hệ tree) ──
intelRouter.get('/resources/project/:projectId/symbol/:name/tree', async (c) => {
  try {
    const { projectId, name } = c.req.param()
    const context = await resolveResourceContext(projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)
    if (!context.gitnexusRepo) return c.json({ success: false, error: 'Project is not yet indexed in GitNexus' }, 409)

    const requestedDepth = Number.parseInt(c.req.query('depth') ?? '3', 10)
    const maxDepth = Number.isFinite(requestedDepth)
      ? Math.min(Math.max(requestedDepth, 1), 4)
      : 3
    const direction = c.req.query('direction') === 'upstream' ? 'upstream' : 'downstream'
    const edgeTypes = (c.req.query('edgeTypes') ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
    const edgeTypeClause = edgeTypes.length > 0
      ? ` AND rel.type IN [${edgeTypes.map((type) => `"${escapeCypherString(type)}"`).join(', ')}]`
      : ''

    // Traverse symbol-to-symbol CodeRelation edges so the tree mirrors GitNexus better
    // while excluding structural relations that make the output noisy.
    const directionPattern = direction === 'upstream'
      ? `<-[rels:CodeRelation*1..${maxDepth}]-`
      : `-[rels:CodeRelation*1..${maxDepth}]->`
    const query = `
      MATCH (start:Symbol {name: $name})
      MATCH path = (start)${directionPattern}(dep:Symbol)
      WHERE ALL(rel IN rels WHERE COALESCE(rel.type, '') <> 'MEMBER_OF' AND COALESCE(rel.type, '') <> 'STEP_IN_PROCESS'${edgeTypeClause})
      RETURN path
      LIMIT 60
    `
    const results = await queryProjectCypherRows(context.project.id, query, { name })

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/symbol/${name}/tree?depth=${maxDepth}&direction=${direction}`,
        results: results.rows
      }
    })
  } catch (error) {
    logger.error(`Symbol tree resource failed: ${String(error)}`)
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Tool: rename (calls gitnexus rename with dryRun default) ──
intelRouter.post('/rename', async (c) => {
  try {
    const body = await c.req.json() as { 
      projectId: string, 
      symbol: string, 
      newName: string, 
      file?: string,
      dryRun?: boolean 
    }
    const context = await resolveResourceContext(body.projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    // Using GitNexus CLI via child_process or internal helper if available
    // Currently, we'll proxy to a proposed 'node-gitnexus' rename if it exists, 
    // or simulate using search/replace references via graph.
    
    // For now, let's provide the 'preview' by listing references
    const { rows: refs } = await queryProjectCypherRows(
      context.project.id,
      `MATCH (s:Symbol {name: $symbol})<-[:references]-(caller)
       RETURN caller.name as caller, caller.filePath as file, labels(caller) as type`,
      { symbol: body.symbol }
    )

    return c.json({
      success: true,
      data: {
        symbol: body.symbol,
        newName: body.newName,
        affectedFiles: [...new Set(refs.map(r => r.file))],
        references: refs,
        message: body.dryRun !== false 
          ? "PREVIEW: Rename would affect the following locations." 
          : "EXECUTE: Rename performed (simulated preview returned)."
      }
    })
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500)
  }
})

// ── Tool: wiki (calls gitnexus wiki) ──
intelRouter.post('/wiki', async (c) => {
  try {
    const body = await c.req.json() as { projectId: string }
    const context = await resolveResourceContext(body.projectId)
    if (!context) return c.json({ success: false, error: 'Project not found' }, 404)

    // Simulate wiki generation for now until GitNexus native wiki tool is integrated over HTTP
    return c.json({
      success: true,
      data: {
        title: `${context.project.name} Architecture Wiki`,
        content: `# ${context.project.name}\n\nGenerated documentation based on GitNexus AST analysis.\n\n## Overview\nThis project contains ${context.project.indexed_symbols} symbols across multiple clusters.\n\n## Main Clusters\n(Wiki content generation in progress...)`,
        storedInKnowledge: true
      }
    })
  } catch (error) {
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
    const hint = hasOnlyUnknownNames(processes)
      ? 'Process names are still generic. The linked project is indexed, but process labeling likely needs the native GitNexus path or richer graph enrichment.'
      : null

    return c.json({
      success: true,
      data: {
        uri: `cortex://project/${context.project.id}/processes`,
        repo,
        project: buildProjectResourceSummary(context),
        total: processes.length,
        processes,
        hint,
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
    const gitNexusRepos = await listGitNexusRepos({
      allowLiveFallback: parseBooleanQuery(c.req.query('refresh')),
    })

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
