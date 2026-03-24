import { Hono } from 'hono'
import { createLogger } from '@cortex/shared-utils'
import { db } from '../db/client.js'

const logger = createLogger('intel')

export const intelRouter = new Hono()

const GITNEXUS_URL = () => process.env.GITNEXUS_URL ?? 'http://gitnexus:4848'

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
 * Resolve a projectId to a GitNexus-compatible repo name.
 * GitNexus registers repos by folder name (our clone path uses projectId)
 * or by git remote URL. We try multiple strategies:
 * 1. If input looks like a project ID (proj-xxx), look up the project slug
 * 2. Extract repo name from git_repo_url as fallback
 * 3. Return the original input as last resort
 */
function resolveRepoName(projectId: string): string {
  // If it doesn't look like an internal ID, use as-is (already a repo name)
  if (!projectId.startsWith('proj-')) {
    return projectId
  }

  try {
    const project = db.prepare(
      'SELECT slug, git_repo_url FROM projects WHERE id = ?'
    ).get(projectId) as { slug?: string; git_repo_url?: string } | undefined

    if (!project) {
      logger.warn(`resolveRepoName: project ${projectId} not found, using ID as-is`)
      return projectId
    }

    // Strategy 1: Use slug (most likely matches GitNexus registration)
    if (project.slug) {
      logger.info(`resolveRepoName: ${projectId} → slug "${project.slug}"`)
      return project.slug
    }

    // Strategy 2: Extract repo name from git URL
    if (project.git_repo_url) {
      const repoName = project.git_repo_url
        .replace(/\.git$/, '')
        .split('/')
        .pop()
      if (repoName) {
        logger.info(`resolveRepoName: ${projectId} → url-derived "${repoName}"`)
        return repoName
      }
    }
  } catch (error) {
    logger.warn(`resolveRepoName: DB lookup failed: ${error}`)
  }

  // Fallback: use projectId directly (might work if folder-based registration)
  return projectId
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GitNexusResult = Record<string, any>

/**
 * Format GitNexus query results into a readable report for agents.
 * Handles the process-grouped search format that GitNexus returns.
 */
function formatSearchResults(query: string, data: unknown): string {
  const result = data as GitNexusResult

  // Handle raw text response
  if (result?.raw) {
    return `🔍 Search: "${query}"\n\n${result.raw}`
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

    // Smart repo name resolution: handle both projectId and direct repo name
    if (projectId) {
      const repoName = resolveRepoName(projectId)
      params.repo = repoName
      // Also try with projectId as fallback identifier
      logger.info(`Code search: resolved repo "${repoName}" from "${projectId}"`)
    }

    if (branch) {
      params.branch = branch
    }

    let results: unknown
    try {
      results = await callGitNexus('query', params)
    } catch (firstError) {
      // Fallback: if repo name didn't work, try with projectId directly
      if (projectId && params.repo !== projectId) {
        logger.info(`Code search: retrying with projectId "${projectId}" as repo name`)
        params.repo = projectId
        try {
          results = await callGitNexus('query', params)
        } catch {
          // Final fallback: try without repo filter
          logger.info('Code search: retrying without repo filter')
          delete params.repo
          results = await callGitNexus('query', params)
        }
      } else {
        throw firstError
      }
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
    if (projectId) {
      params.repo = resolveRepoName(projectId)
    }

    const results = await callGitNexus('impact', params)

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
    if (projectId) {
      params.repo = resolveRepoName(projectId)
    }
    if (file) params.file = file

    const results = await callGitNexus('context', params)

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

// ── List Repos: discover indexed repositories ──
intelRouter.get('/repos', async (c) => {
  try {
    const results = await callGitNexus('list_repos', {})
    return c.json({ success: true, data: results })
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
    if (projectId) {
      params.repo = resolveRepoName(projectId)
    }

    const results = await callGitNexus('detect_changes', params)
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
    if (projectId) {
      params.repo = resolveRepoName(projectId)
    }

    const results = await callGitNexus('cypher', params)
    return c.json({ success: true, data: results })
  } catch (error) {
    logger.error(`Cypher query failed: ${String(error)}`)
    return c.json(
      { success: false, error: String(error) },
      500,
    )
  }
})

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
