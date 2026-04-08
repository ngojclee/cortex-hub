import { z } from 'zod'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Env } from '../types.js'
import { apiCall } from '../api-call.js'

export function registerAdminTools(server: McpServer, env: Env) {
  server.tool(
    'cortex_list_knowledge_docs',
    'List raw knowledge documents for data cleanup and project-linkage audits. Admin-oriented tool for finding unassigned, orphaned, or mislinked knowledge rows.',
    {
      projectId: z.string().optional().describe('Filter by project ID or slug'),
      status: z.string().optional().describe('Filter by status (e.g. active, archived)'),
      search: z.string().optional().describe('Filter by title/content preview substring'),
      linkage: z.enum(['all', 'assigned', 'unassigned', 'orphaned']).optional().describe('Filter by linkage state'),
      limit: z.number().optional().describe('Maximum docs to return (default: 200, max: 1000)'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ projectId, status, search, linkage, limit, offset }) => {
      try {
        const params = new URLSearchParams()
        if (projectId) params.set('projectId', projectId)
        if (status) params.set('status', status)
        if (search) params.set('search', search)
        if (linkage) params.set('linkage', linkage)
        if (limit) params.set('limit', String(limit))
        if (offset) params.set('offset', String(offset))

        const res = await apiCall(env, `/api/knowledge/admin/docs?${params.toString()}`)
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `List knowledge docs failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `List knowledge docs error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_update_knowledge_doc',
    'Update a knowledge document metadata row for project-linkage cleanup. Supports title, tags, status, and project reassignment.',
    {
      id: z.string().describe('Knowledge document ID'),
      title: z.string().optional().describe('New title'),
      tags: z.array(z.string()).optional().describe('Replace tags array'),
      status: z.string().optional().describe('New status'),
      projectId: z.string().nullable().optional().describe('Assign to project ID/slug, or null to unassign'),
    },
    async ({ id, title, tags, status, projectId }) => {
      try {
        const res = await apiCall(env, `/api/knowledge/admin/docs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, tags, status, projectId }),
        })
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `Update knowledge doc failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Update knowledge doc error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_list_projects_admin',
    'List raw project rows with repo, knowledge, and latest indexing hints for data cleanup. Useful for distinguishing repository, knowledge-only, umbrella, and placeholder projects.',
    {
      kind: z.enum(['all', 'repository', 'umbrella', 'knowledge_only', 'placeholder']).optional().describe('Filter project cleanup view by kind'),
      search: z.string().optional().describe('Filter by name, slug, or description'),
    },
    async ({ kind, search }) => {
      try {
        const params = new URLSearchParams()
        if (kind) params.set('kind', kind)
        if (search) params.set('search', search)

        const res = await apiCall(env, `/api/projects/admin/list?${params.toString()}`)
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `List projects admin failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `List projects admin error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_update_project_admin',
    'Update raw project metadata for cleanup. Supports name, description, git repo URL, indexedAt, and indexedSymbols.',
    {
      id: z.string().describe('Project ID'),
      name: z.string().optional().describe('New project name'),
      description: z.string().nullable().optional().describe('New description'),
      gitRepoUrl: z.string().nullable().optional().describe('New git repo URL'),
      indexedAt: z.string().nullable().optional().describe('Override indexedAt timestamp'),
      indexedSymbols: z.number().nullable().optional().describe('Override indexed symbol count'),
    },
    async ({ id, name, description, gitRepoUrl, indexedAt, indexedSymbols }) => {
      try {
        const res = await apiCall(env, `/api/projects/admin/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, gitRepoUrl, indexedAt, indexedSymbols }),
        })
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `Update project admin failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Update project admin error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_gitnexus_registry_audit',
    'Audit GitNexus registry mapping for duplicate aliases and unmapped repos. Read-only safety tool for data-quality cleanup planning.',
    {},
    async () => {
      try {
        const res = await apiCall(env, '/api/intel/admin/gitnexus-audit')
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `GitNexus registry audit failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `GitNexus registry audit error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_gitnexus_registry_cleanup',
    'Preview or apply GitNexus registry cleanup for duplicate aliases and stale unmapped entries. Use preview first, then apply once the plan looks safe.',
    {
      mode: z.enum(['preview', 'apply']).optional().describe('Preview or apply cleanup actions'),
      projectId: z.string().optional().describe('Limit cleanup to one project ID or slug'),
      includeUnmapped: z.boolean().optional().describe('Also include stale unmapped registry entries'),
      deleteStorage: z.boolean().optional().describe('Delete duplicate .gitnexus storage directories when applying'),
    },
    async ({ mode, projectId, includeUnmapped, deleteStorage }) => {
      try {
        const res = await apiCall(env, '/api/intel/admin/gitnexus-cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode ?? 'preview', projectId, includeUnmapped, deleteStorage }),
        })
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `GitNexus registry cleanup failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `GitNexus registry cleanup error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )

  server.tool(
    'cortex_project_cleanup',
    'Preview or apply safe project metadata cleanup. Normalizes blank repo URLs, clears stale repo URLs on umbrella projects, and clears project-level index hints for umbrella/placeholder entries.',
    {
      mode: z.enum(['preview', 'apply']).optional().describe('Preview or apply cleanup actions'),
      projectIds: z.array(z.string()).optional().describe('Optional project IDs/slugs to limit cleanup scope'),
      clearRepoUrlForUmbrella: z.boolean().optional().describe('Clear repo URLs for projects described as umbrella/no direct repo'),
      clearLatestIndexHint: z.boolean().optional().describe('Clear indexedAt/indexedSymbols for umbrella/placeholder projects'),
      normalizeBlankRepoUrl: z.boolean().optional().describe('Normalize empty-string repo URLs back to null'),
    },
    async ({ mode, projectIds, clearRepoUrlForUmbrella, clearLatestIndexHint, normalizeBlankRepoUrl }) => {
      try {
        const res = await apiCall(env, '/api/intel/admin/project-cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: mode ?? 'preview',
            projectIds,
            clearRepoUrlForUmbrella,
            clearLatestIndexHint,
            normalizeBlankRepoUrl,
          }),
        })
        if (!res.ok) {
          const errorText = await res.text()
          return { content: [{ type: 'text' as const, text: `Project cleanup failed: ${res.status} ${errorText}` }], isError: true }
        }

        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Project cleanup error: ${error instanceof Error ? error.message : 'Unknown'}` }], isError: true }
      }
    },
  )
}
