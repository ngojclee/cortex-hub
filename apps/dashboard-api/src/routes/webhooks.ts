import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { db } from '../db/client.js'
import { startIndexing } from '../services/indexer.js'
import { createLogger } from '@cortex/shared-utils'

const logger = createLogger('webhooks')

export const webhooksRouter = new Hono()

interface GitHubPushPayload {
  ref: string
  repository: {
    clone_url: string
    html_url: string
    full_name: string
  }
  head_commit: {
    id: string
    message: string
    author: { name: string; username?: string }
    added: string[]
    removed: string[]
    modified: string[]
  } | null
  commits?: Array<{
    id: string
    message: string
    added: string[]
    removed: string[]
    modified: string[]
  }>
  pusher: { name: string }
}

/**
 * POST /github — GitHub webhook receiver for push events.
 * Records change_events and optionally triggers reindex.
 */
webhooksRouter.post('/github', async (c) => {
  try {
    const event = c.req.header('X-GitHub-Event')
    if (event !== 'push') {
      return c.json({ ignored: true, reason: `event type: ${event}` })
    }

    const payload = await c.req.json() as GitHubPushPayload
    const branch = payload.ref.replace('refs/heads/', '')
    const repoUrl = payload.repository.clone_url || payload.repository.html_url

    // Look up project by repo URL
    const project = db.prepare(
      `SELECT id FROM projects WHERE git_repo_url = ? OR git_repo_url = ?`
    ).get(repoUrl, repoUrl.replace(/\.git$/, '')) as { id: string } | undefined

    if (!project) {
      return c.json({ ignored: true, reason: 'No matching project found' })
    }

    // Collect changed files from head_commit or all commits
    const filesSet = new Set<string>()
    const commits = payload.commits ?? (payload.head_commit ? [payload.head_commit] : [])
    for (const commit of commits) {
      for (const f of [...(commit.added ?? []), ...(commit.modified ?? []), ...(commit.removed ?? [])]) {
        filesSet.add(f)
      }
    }

    // Record change event
    const eventId = `chg-${randomUUID().slice(0, 12)}`
    db.prepare(
      `INSERT INTO change_events (id, project_id, branch, agent_id, commit_sha, commit_message, files_changed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      project.id,
      branch,
      payload.pusher.name,
      payload.head_commit?.id ?? '',
      payload.head_commit?.message ?? '',
      JSON.stringify([...filesSet])
    )

    logger.info(`Change event ${eventId}: ${filesSet.size} files on ${branch} by ${payload.pusher.name}`)

    // Auto-trigger reindex
    const jobId = `idx-${randomUUID().slice(0, 12)}`
    const activeJob = db.prepare(
      `SELECT id FROM index_jobs WHERE project_id = ? AND status IN ('pending', 'cloning', 'analyzing', 'ingesting')`
    ).get(project.id) as { id: string } | undefined

    let reindexStarted = false
    if (!activeJob) {
      db.prepare(
        `INSERT INTO index_jobs (id, project_id, branch, status, progress) VALUES (?, ?, ?, 'pending', 0)`
      ).run(jobId, project.id, branch)
      startIndexing(project.id, jobId, branch).catch(() => {})
      reindexStarted = true
    }

    return c.json({
      received: true,
      eventId,
      projectId: project.id,
      branch,
      filesChanged: filesSet.size,
      reindexStarted,
    })
  } catch (error) {
    logger.error(`Webhook error: ${error}`)
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * POST /local-push — Lightweight endpoint for local git hooks (lefthook).
 * Body: { repo, branch, agentId?, commitSha?, commitMessage?, filesChanged? }
 */
webhooksRouter.post('/local-push', async (c) => {
  try {
    const body = await c.req.json()
    const { repo, branch, agentId, commitSha, commitMessage, filesChanged } = body

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

    // Record change event
    const eventId = `chg-${randomUUID().slice(0, 12)}`
    db.prepare(
      `INSERT INTO change_events (id, project_id, branch, agent_id, commit_sha, commit_message, files_changed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      project.id,
      branch,
      agentId ?? 'local',
      commitSha ?? '',
      commitMessage ?? '',
      JSON.stringify(filesChanged ?? [])
    )

    return c.json({ received: true, eventId, projectId: project.id })
  } catch (error) {
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
      // Get events newer than last seen, excluding own events
      events = db.prepare(
        `SELECT * FROM change_events
         WHERE project_id = ? AND agent_id != ? AND created_at > (
           SELECT created_at FROM change_events WHERE id = ?
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

    return c.json({ events, count: (events as unknown[]).length })
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

/**
 * DELETE /changes/cleanup — Remove change events older than 24 hours.
 */
webhooksRouter.delete('/changes/cleanup', (c) => {
  try {
    const result = db.prepare(
      `DELETE FROM change_events WHERE created_at < datetime('now', '-1 day')`
    ).run()

    return c.json({ deleted: result.changes })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})
