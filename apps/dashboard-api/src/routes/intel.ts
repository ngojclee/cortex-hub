import { Hono } from 'hono'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const intelRouter = new Hono()

const REPOS_DIR = process.env.REPOS_DIR ?? '/app/data/repos'

/**
 * Run a gitnexus CLI command and return stdout.
 */
async function runGitNexus(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npx', ['-y', 'gitnexus', ...args], {
      cwd: cwd ?? REPOS_DIR,
      timeout: 30000,
      env: { ...process.env, PATH: process.env.PATH },
    })
    return stdout
  } catch (err) {
    const error = err as { stderr?: string; message?: string }
    throw new Error(error.stderr ?? error.message ?? 'GitNexus command failed')
  }
}

intelRouter.post('/search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, limit, projectId } = body as { query: string; limit?: number; projectId?: string }

    if (!query) return c.json({ error: 'Query is required' }, 400)

    const args = ['query', query, '-l', String(limit ?? 5)]
    if (projectId) args.push('-r', projectId)
    args.push('--content')

    const stdout = await runGitNexus(args)

    // Parse GitNexus output (JSON or structured text)
    let results
    try {
      results = JSON.parse(stdout)
    } catch {
      // GitNexus outputs structured text — wrap it
      results = { raw: stdout.trim() }
    }

    return c.json({
      success: true,
      data: { query, limit: limit ?? 5, results }
    })
  } catch (error) {
    // Fallback: return error with context
    return c.json({
      success: false,
      error: String(error),
      hint: 'Make sure the repository has been indexed with GitNexus (use the Indexing panel in the Dashboard).'
    }, 500)
  }
})

intelRouter.post('/impact', async (c) => {
  try {
    const body = await c.req.json()
    const { target, direction } = body as { target: string; direction?: string }
    if (!target) return c.json({ error: 'Target is required' }, 400)

    const args = ['impact', target]
    if (direction === 'upstream') args.push('--direction', 'upstream')

    const stdout = await runGitNexus(args)

    let results
    try {
      results = JSON.parse(stdout)
    } catch {
      results = { raw: stdout.trim() }
    }

    return c.json({
      success: true,
      data: { target, direction: direction ?? 'downstream', ...results }
    })
  } catch (error) {
    return c.json({
      success: false,
      error: String(error),
      hint: 'Ensure the target symbol exists in an indexed repository.'
    }, 500)
  }
})
