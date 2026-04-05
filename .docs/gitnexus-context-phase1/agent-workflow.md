# Agent Workflow: GitNexus Context Fabric

## Goal
Give every MCP client the same low-token discovery path before it starts using heavier code tools.

## Recommended Flow
1. Discovery
   - Start with `cortex://projects`
   - Confirm the correct `projectId`
   - Check whether GitNexus is registered and whether the index looks fresh or stale
2. Overview
   - Read `cortex://project/{projectId}/context`
   - Capture branch, index freshness, file/symbol/process counts, and companion resources
3. Deep Dive
   - Read `cortex://project/{projectId}/clusters`
   - Read `cortex://project/{projectId}/processes`
   - Open one or two focused detail resources:
     - `cortex://project/{projectId}/cluster/{clusterName}`
     - `cortex://project/{projectId}/process/{processName}`
   - Read `cortex://project/{projectId}/schema` before complex Cypher work
4. Action
   - Use `cortex_code_context` for symbol-level dependency context
   - Use `cortex_code_impact` when evaluating blast radius
   - Use `cortex_code_search` for focused retrieval after the resource map is clear
   - Use `cortex_cypher` only after the schema and target entities are clear
   - Use `cortex_code_read` when you already know which files matter

## Prompt Entry Points
- `cortex_detect_impact`
  - Use when the agent already knows the intended change and wants a structured blast-radius workflow
- `cortex_generate_map`
  - Use when the agent needs an onboarding summary, architecture map, or Mermaid view

## Session Start Contract
`cortex_session_start` should return:
- project identity
- recent quality and session history
- unseen changes from other agents
- recent memories
- context fabric:
  - top clusters
  - top processes
  - suggested files
  - suggested resources
  - suggested next tools/workflow

## Why This Order Works
- Resources are cheaper than repeated tool calls
- Agents share a common project vocabulary before editing
- Clusters and processes make file relationships easier to explain across Claude, Gemini, Codex, and other MCP clients
