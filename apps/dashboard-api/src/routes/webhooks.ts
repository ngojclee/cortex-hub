import { Hono } from 'hono'
import { randomUUID, createHash } from 'crypto'
import { db } from '../db/client.js'
import { startIndexing } from '../services/indexer.js'
import { createLogger } from '@cortex/shared-utils'
import { normalizeSharedProjectMetadata, parseSharedProjectMetadataJson } from '@cortex/shared-types'

const logger = createLogger('webhooks')

export const webhooksRouter = new Hono()

// ── Auth: validate API key on protected endpoints ──
function validateWebhookAuth(authHeader: string | undefined): boolean {
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false

  try {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const key = db.prepare(
      `SELECT id
       FROM api_keys
       WHERE key_hash = ?
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       LIMIT 1`
    ).get(tokenHash) as { id: string } | undefined

    if (!key?.id) return false

    db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(key.id)
    return true
  } catch {
    return false
  }
}

/**
 * POST /push — Record a code push event from any source (lefthook, bot, CI).
 * Authenticated via Bearer token (same API keys as MCP).
 * Body: { repo, branch, agentId?, commitSha?, commitMessage?, filesChanged? }
 */
webhooksRouter.post('/push', async (c) => {
  try {
    // Auth check
    const authHeader = c.req.header('Authorization')
    if (!validateWebhookAuth(authHeader)) {
      return c.json({ error: 'Unauthorized. Provide a valid Bearer token.' }, 401)
    }

    const body = await c.req.json()
    const { repo, branch, agentId, commitSha, commitMessage, filesChanged, sharedMetadata, shared_metadata } = body

    if (!repo || !branch) {
      return c.json({ error: 'repo and branch are required' }, 400)
    }

    // Look up project
    const project = db.prepare(
      `SELECT id FROM projects WHERE git_repo_url = ? OR git_repo_url = ?`
    ).get(repo, repo.replace(/\.git$/, '')) as { id: string } | undefined

    if (!project) {
      return c.json({ ignored: true, reason: 'No matching project found' })
    }

    const normalizedSharedMetadata = normalizeSharedProjectMetadata(sharedMetadata ?? shared_metadata, {
      projectId: project.id,
      branch,
      filesTouched: Array.isArray(filesChanged) ? filesChanged : undefined,
    })

    // Record change event
    const eventId = `chg-${randomUUID().slice(0, 12)}`
    db.prepare(
      `INSERT INTO change_events (id, project_id, branch, agent_id, commit_sha, commit_message, files_changed, shared_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      project.id,
      branch,
      agentId ?? 'local',
      commitSha ?? '',
      commitMessage ?? '',
      JSON.stringify(filesChanged ?? []),
      normalizedSharedMetadata ? JSON.stringify(normalizedSharedMetadata) : null,
    )

    logger.info(`Change event ${eventId}: ${(filesChanged ?? []).length} files on ${branch} by ${agentId ?? 'local'}`)

    // Auto-trigger reindex
    const activeJob = db.prepare(
      `SELECT id FROM index_jobs WHERE project_id = ? AND status IN ('pending', 'cloning', 'analyzing', 'ingesting')`
    ).get(project.id) as { id: string } | undefined

    let reindexStarted = false
    if (!activeJob) {
      const jobId = `idx-${randomUUID().slice(0, 12)}`
      db.prepare(
        `INSERT INTO index_jobs (id, project_id, branch, status, progress) VALUES (?, ?, ?, 'pending', 0)`
      ).run(jobId, project.id, branch)
      startIndexing(project.id, jobId, branch).catch(() => {})
      reindexStarted = true
    }

    return c.json({ received: true, eventId, projectId: project.id, reindexStarted })
  } catch (error) {
    logger.error(`Push event error: ${error}`)
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * GET /changes — Query unseen change events for an agent.
 * Query params: agentId, projectId, limit?
 */
webhooksRouter.get('/changes', (c) => {
  const agentId = c.req.query('agentId')
  const projectId = c.req.query('projectId')
  const limit = Number(c.req.query('limit') || '20')

  if (!agentId || !projectId) {
    return c.json({ error: 'agentId and projectId are required' }, 400)
  }

  try {
    // Get last acknowledged event
    const ack = db.prepare(
      'SELECT last_seen_event_id FROM agent_ack WHERE agent_id = ? AND project_id = ?'
    ).get(agentId, projectId) as { last_seen_event_id: string } | undefined

    let events
    if (ack) {
      // Get events newer than last seen, excluding own events.
      // COALESCE handles case where the ack'd event was already cleaned up by TTL.
      events = db.prepare(
        `SELECT * FROM change_events
         WHERE project_id = ? AND agent_id != ? AND created_at > COALESCE(
           (SELECT created_at FROM change_events WHERE id = ?),
           datetime('now', '-1 day')
         )
         ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, agentId, ack.last_seen_event_id, limit)
    } else {
      // No ack — return recent events (last 24h), excluding own
      events = db.prepare(
        `SELECT * FROM change_events
         WHERE project_id = ? AND agent_id != ?
           AND created_at > datetime('now', '-1 day')
         ORDER BY created_at DESC LIMIT ?`
      ).all(projectId, agentId, limit)
    }

    const normalizedEvents = (events as Array<Record<string, unknown>>).map((event) => ({
      ...event,
      sharedMetadata: parseSharedProjectMetadataJson(event.shared_metadata, {
        projectId,
        branch: typeof event.branch === 'string' ? event.branch : undefined,
      }),
    }))

    return c.json({ events: normalizedEvents, count: normalizedEvents.length })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * POST /changes/ack — Acknowledge that an agent has seen events.
 * Body: { agentId, projectId, lastSeenEventId }
 */
webhooksRouter.post('/changes/ack', async (c) => {
  try {
    const { agentId, projectId, lastSeenEventId } = await c.req.json()
    if (!agentId || !projectId || !lastSeenEventId) {
      return c.json({ error: 'agentId, projectId, and lastSeenEventId are required' }, 400)
    }

    db.prepare(
      `INSERT INTO agent_ack (agent_id, project_id, last_seen_event_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, project_id)
       DO UPDATE SET last_seen_event_id = excluded.last_seen_event_id, updated_at = datetime('now')`
    ).run(agentId, projectId, lastSeenEventId)

    return c.json({ acknowledged: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})
