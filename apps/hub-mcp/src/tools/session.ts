import type { Env } from '../types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { apiCall } from '../api-call.js'
import { fetchUnseenChanges, formatChangeSummary, acknowledgeChanges } from './changes.js'
import { buildContextFabric } from '../context-fabric.js'
import { normalizeSharedProjectMetadata } from '@cortex/shared-types'

/**
 * Register Session Tools
 *
 * cortex_session_start: Start a session and get project context.
 * Calls dashboard-api /api/sessions/start via apiCall (in-memory when co-located).
 */
export function registerSessionTools(server: McpServer, env: Env) {
  // End/complete a session
  server.tool(
    'cortex_session_end',
    'End/complete the current session. Call this when your conversation is finishing to avoid leaving stale sessions.',
    {
      sessionId: z.string().describe('The session ID returned by cortex_session_start'),
      summary: z.string().optional().describe('Brief summary of work done in this session'),
      shared_metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Canonical shared metadata: projectId, branch, filesTouched, symbolsTouched, processesAffected, clustersTouched, resourceUris'),
    },
    async ({ sessionId, summary, shared_metadata }) => {
      try {
        const normalizedSharedMetadata = normalizeSharedProjectMetadata(shared_metadata)
        const response = await apiCall(env, `/api/sessions/${sessionId}/complete`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            task_summary: summary,
            shared_metadata: normalizedSharedMetadata,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return {
            content: [{ type: 'text' as const, text: `Session end failed: ${response.status} ${errorText}` }],
            isError: true,
          }
        }

        const result = await response.json()

        // ── Auto-store session summary to mem9 for cross-session recall ──
        if (summary) {
          try {
            await apiCall(env, '/api/mem9/store', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: [{ role: 'user', content: `Session completed: ${summary}` }],
                userId: `session-${sessionId}`,
                agentId: 'session-auto',
                metadata: { session_id: sessionId, type: 'session_summary' },
              }),
            })
          } catch { /* non-fatal: don't block session end */ }
        }

        // ── Fetch compliance score for this session ──
        let complianceReport = ''
        try {
          const complianceRes = await apiCall(env, `/api/metrics/session-compliance/${sessionId}`)
          if (complianceRes.ok) {
            const compliance = (await complianceRes.json()) as {
              overallScore: number; grade: string
              toolsUsed: string[]; totalUsed: number; totalRecommended: number
              categories: Array<{ category: string; used: string[]; missing: string[]; score: number }>
              hints: string[]
            }

            const lines: string[] = []
            lines.push(`\n\n══════════════════════════════════════════`)
            lines.push(`  CORTEX COMPLIANCE: ${compliance.grade} (${compliance.overallScore}%)`)
            lines.push(`  Tools: ${compliance.totalUsed}/${compliance.totalRecommended} recommended`)
            lines.push(`══════════════════════════════════════════`)

            for (const cat of compliance.categories) {
              const icon = cat.score === 100 ? '✅' : cat.score >= 50 ? '⚠️' : '❌'
              lines.push(`${icon} ${cat.category}: ${cat.score}%${cat.missing.length > 0 ? ` (missing: ${cat.missing.join(', ')})` : ''}`)
            }

            if (compliance.hints.length > 0) {
              lines.push(`\n📋 Improvement hints:`)
              for (const hint of compliance.hints) {
                lines.push(`  ${hint}`)
              }
            }

            complianceReport = lines.join('\n')
          }
        } catch { /* non-fatal */ }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) + complianceReport }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Session end error: ${error instanceof Error ? error.message : 'Unknown'}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'cortex_session_start',
    'Start or refresh a session. Creates or reuses a session record and returns project context, recent quality logs, session history, and unseen code changes from other agents.',
    {
      repo: z.string().describe('The URL of the repository being worked on'),
      mode: z.string().optional().describe('Session mode: development, production, onboarding, review'),
      agentId: z.string().describe('Your agent identifier for change tracking (e.g., "claude-code", "antigravity", "cursor")'),
    },
    async ({ repo, mode, agentId }) => {
      try {
        // Server-resolved identity (from API key) takes precedence over self-reported
        const resolvedAgentId = env.API_KEY_OWNER || agentId

        const response = await apiCall(env, '/api/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo, mode, agentId: resolvedAgentId }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session start failed: ${response.status} ${errorText}`,
              },
            ],
            isError: true,
          }
        }

        const session = (await response.json()) as Record<string, unknown>

        // Inject recent changes if project was found
        const projectData = session.project as Record<string, unknown> | null
        if (projectData?.id && resolvedAgentId) {
          const projectId = projectData.id as string
          const { events } = await fetchUnseenChanges(env, resolvedAgentId, projectId)
          const changeSummary = formatChangeSummary(events)

          if (changeSummary) {
            session.recentChanges = {
              count: events.length,
              summary: changeSummary,
              warning: 'Code has changed since your last session. Run git pull before editing.',
              events: events.map((e) => ({
                agent: e.agent_id,
                branch: e.branch,
                commit: e.commit_sha?.slice(0, 7),
                message: e.commit_message,
                files: JSON.parse(e.files_changed || '[]'),
                time: e.created_at,
              })),
            }

            // Auto-acknowledge these changes
            const latestId = events[0]?.id
            if (latestId) {
              await acknowledgeChanges(env, resolvedAgentId, projectId, latestId)
            }
          } else {
            session.recentChanges = { count: 0, summary: 'No unseen changes.' }
          }

          // ── Auto-recall recent mem9 memories for context ──
          try {
            const memResponse = await apiCall(env, '/api/mem9/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: `project ${projectId} recent session context`,
                userId: `project-${projectId}`,
                limit: 3,
              }),
            })
            if (memResponse.ok) {
              const memData = (await memResponse.json()) as { memories?: Array<{ memory?: string }> }
              const memories = memData.memories ?? []
              if (memories.length > 0) {
                session.recentMemories = {
                  count: memories.length,
                  items: memories.map((m) => m.memory ?? '').filter(Boolean),
                }
              }
            }
          } catch { /* non-fatal */ }

          try {
            const contextFabric = await buildContextFabric(env, projectId)
            if (contextFabric) {
              const sharedMetadata = normalizeSharedProjectMetadata({
                projectId,
                branch: contextFabric.branch,
                filesTouched: contextFabric.suggestedFiles,
                processesAffected: contextFabric.topProcesses.map((process) => process.name),
                clustersTouched: contextFabric.topClusters.map((cluster) => cluster.name),
                resourceUris: contextFabric.suggestedNext.resources,
              })

              if (sharedMetadata) {
                await apiCall(env, `/api/sessions/${session.sessionId}/metadata`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ shared_metadata: sharedMetadata }),
                })
              }

              session.contextFabric = contextFabric
              session.sessionSnapshot = {
                projectId,
                branch: contextFabric.branch,
                clusters: contextFabric.topClusters.map((cluster) => cluster.name),
                processes: contextFabric.topProcesses.map((process) => process.name),
                suggestedFiles: contextFabric.suggestedFiles,
                resourceUris: contextFabric.suggestedNext.resources,
              }
              session.suggestedNext = contextFabric.suggestedNext
            }
          } catch {
            // Non-fatal: session start should still work even if context enrichment fails.
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(session, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Session start error: ${error instanceof Error ? error.message : 'Unknown'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}
