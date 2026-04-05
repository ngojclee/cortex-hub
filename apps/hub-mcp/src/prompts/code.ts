import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { buildContextFabric } from '../context-fabric.js'
import type { Env } from '../types.js'

function linesToText(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim().length > 0)).join('\n')
}

function bulletList(items: string[], emptyText: string): string[] {
  if (items.length === 0) return [`- ${emptyText}`]
  return items.map((item) => `- ${item}`)
}

function buildImpactPromptText(args: {
  projectId: string
  changeSummary: string
  focus?: string
  fabric: Awaited<ReturnType<typeof buildContextFabric>> | null
}): string {
  const { projectId, changeSummary, focus, fabric } = args

  const resourceLines = fabric
    ? [
        `- overview: ${fabric.resources.overview}`,
        `- clusters: ${fabric.resources.clusters}`,
        `- processes: ${fabric.resources.processes}`,
        `- schema: ${fabric.resources.schema}`,
      ]
    : [`- context: cortex://project/${projectId}/context`]

  const clusterLines = fabric
    ? bulletList(
        fabric.topClusters.map((cluster) =>
          `${cluster.name} (symbols=${cluster.symbols ?? 'unknown'}, cohesion=${cluster.cohesion ?? 'unknown'}) -> ${cluster.uri}`,
        ),
        'No cluster summary available yet.',
      )
    : ['- No cluster summary available yet.']

  const processLines = fabric
    ? bulletList(
        fabric.topProcesses.map((process) =>
          `${process.name} (type=${process.type ?? 'unknown'}, steps=${process.steps ?? 'unknown'}) -> ${process.uri}`,
        ),
        'No process summary available yet.',
      )
    : ['- No process summary available yet.']

  const suggestedFiles = fabric
    ? bulletList(fabric.suggestedFiles, 'No suggested files were derived from cluster/process detail yet.')
    : ['- No suggested files were derived yet.']

  const workflow = fabric
    ? bulletList(fabric.suggestedNext.workflow, 'Read project context, then inspect clusters/processes before using action tools.')
    : ['- Read project context, then inspect clusters/processes before using action tools.']

  const tools = fabric
    ? bulletList(fabric.suggestedNext.tools, 'cortex_code_context')
    : ['- cortex_code_context', '- cortex_code_impact', '- cortex_code_search', '- cortex_cypher']

  return linesToText([
    `Analyze the impact of the following change for Cortex project "${projectId}".`,
    '',
    `Change summary: ${changeSummary}`,
    focus ? `Focus: ${focus}` : null,
    '',
    'Use this workflow:',
    ...workflow,
    '',
    'Start from these resources:',
    ...resourceLines,
    '',
    'Top clusters to inspect first:',
    ...clusterLines,
    '',
    'Top processes to inspect first:',
    ...processLines,
    '',
    'Suggested files to inspect:',
    ...suggestedFiles,
    '',
    'Preferred tools after the resource pass:',
    ...tools,
    '',
    'Return your answer with these sections:',
    '- Summary of the likely blast radius',
    '- Affected files and symbols',
    '- Affected clusters and processes',
    '- Confidence gaps and what to inspect next',
    '- Validation checklist before editing',
  ])
}

function buildGenerateMapPromptText(args: {
  projectId: string
  focus?: string
  audience?: string
  fabric: Awaited<ReturnType<typeof buildContextFabric>> | null
}): string {
  const { projectId, focus, audience, fabric } = args

  const resources = fabric
    ? [
        fabric.resources.overview,
        fabric.resources.clusters,
        fabric.resources.processes,
        fabric.resources.schema,
        ...fabric.resources.clusterDetails.slice(0, 2),
        ...fabric.resources.processDetails.slice(0, 2),
      ]
    : [`cortex://project/${projectId}/context`, `cortex://project/${projectId}/schema`]

  const clusterLines = fabric
    ? bulletList(
        fabric.topClusters.map((cluster) =>
          `${cluster.name} (symbols=${cluster.symbols ?? 'unknown'})`,
        ),
        'No cluster summary available yet.',
      )
    : ['- No cluster summary available yet.']

  const processLines = fabric
    ? bulletList(
        fabric.topProcesses.map((process) =>
          `${process.name} (type=${process.type ?? 'unknown'}, steps=${process.steps ?? 'unknown'})`,
        ),
        'No process summary available yet.',
      )
    : ['- No process summary available yet.']

  return linesToText([
    `Generate an architecture map for Cortex project "${projectId}".`,
    focus ? `Focus area: ${focus}` : null,
    `Audience: ${audience ?? 'both'}`,
    '',
    'Read these resources before drafting the map:',
    ...bulletList(resources, 'No resources available.'),
    '',
    'Current top clusters:',
    ...clusterLines,
    '',
    'Current top processes:',
    ...processLines,
    '',
    'Produce the map in this order:',
    '1. Short overview of the project purpose and current index freshness.',
    '2. Main clusters/modules and what they own.',
    '3. Main processes/flows and which files anchor them.',
    '4. Suggested starting points for a new agent.',
    '5. A Mermaid diagram showing the most relevant modules and flows.',
    '',
    'Keep the output practical for onboarding and future tool calls.',
  ])
}

export function registerCodePrompts(server: McpServer, env: Env) {
  server.registerPrompt(
    'cortex_detect_impact',
    {
      title: 'Cortex Detect Impact',
      description: 'Guide an agent through GitNexus-backed impact analysis for one Cortex project.',
      argsSchema: {
        projectId: z.string().describe('Cortex project ID'),
        changeSummary: z.string().describe('A short description of the intended change'),
        focus: z.string().optional().describe('Optional area or symbol to focus on'),
      },
    },
    async ({ projectId, changeSummary, focus }) => {
      const fabric = await buildContextFabric(env, projectId).catch(() => null)

      return {
        description: `Impact-analysis workflow for ${projectId}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: buildImpactPromptText({ projectId, changeSummary, focus, fabric }),
            },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'cortex_generate_map',
    {
      title: 'Cortex Generate Map',
      description: 'Generate an architecture map anchored to Cortex resources and GitNexus-backed project context.',
      argsSchema: {
        projectId: z.string().describe('Cortex project ID'),
        focus: z.string().optional().describe('Optional feature, flow, or module to highlight'),
        audience: z.enum(['agent', 'human', 'both']).optional().describe('Who the map is primarily for'),
      },
    },
    async ({ projectId, focus, audience }) => {
      const fabric = await buildContextFabric(env, projectId).catch(() => null)

      return {
        description: `Architecture-map workflow for ${projectId}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: buildGenerateMapPromptText({ projectId, focus, audience, fabric }),
            },
          },
        ],
      }
    },
  )
}
