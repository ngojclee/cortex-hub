# Plan: GitNexus Context Fabric Phase 1

## 1. Context
Cortex Hub already uses GitNexus as its code-intelligence backend for search, impact, context, change detection, and Cypher queries. What is still missing is the lightweight context surface that helps every MCP client understand the same project map immediately:
- Read-only MCP resources for repo context, clusters, processes, process traces, and schema
- MCP prompts that turn graph data into guided workflows
- Session metadata that links project, branch, files, symbols, and affected processes across Claude, Gemini, Codex, and other clients

This feature should be delivered in two layers:
1. Ship the current `/memories` hotfix safely as a patch release and Docker image refresh
2. Implement the GitNexus-inspired context layer as the next minor feature set

## 2. Objectives
- Keep Cortex as the single MCP endpoint for all clients
- Preserve GitNexus as the internal code-intelligence engine behind Cortex
- Expose first-class context resources so agents can navigate project structure with lower token cost
- Normalize all project routing through Cortex `projectId` rather than leaking raw GitNexus repo names
- Improve cross-app handoff so sessions, memories, and change records refer to the same files, symbols, clusters, and processes

## 3. Constraints
- Do not break the existing `cortex_code_*` tool workflow
- Do not require agents to connect directly to GitNexus
- Do not ship visual graph UI work in the same patch release as the `/memories` hotfix
- Avoid broad dashboard churn until the resource contracts are stable

## Phase 0: Hotfix Release & Backup
**Goal:** Safely release the `/memories` route fix before larger GitNexus integration work.

- Pull the latest remote `master` changes before creating a new checkpoint
- Bump `version.json` for a patch release
- Commit only the hotfix and release-planning files for this checkpoint
- Push to GitHub for backup
- Build and push a fresh `cortex-api` image immediately after the GitHub checkpoint
- Rebuild `cortex-mcp` only if the exposed MCP surface changes in the same release
- Rebuild `cortex-gitnexus` only if the GitNexus container or entrypoint changes

## Phase 1: Dashboard API Resource Layer
**Goal:** Add a normalized read-only resource layer in `dashboard-api` that enriches GitNexus data with Cortex project metadata.

- Add API endpoints for:
  - `/api/intel/resources/projects`
  - `/api/intel/resources/project/:projectId/context`
  - `/api/intel/resources/project/:projectId/clusters`
  - `/api/intel/resources/project/:projectId/cluster/:clusterName`
  - `/api/intel/resources/project/:projectId/processes`
  - `/api/intel/resources/project/:projectId/process/:processName`
  - `/api/intel/resources/project/:projectId/schema`
- Resolve `projectId -> slug -> repo candidates` using the existing resolver in `intel.ts`
- Normalize responses into stable YAML-like or JSON structures that are easy for MCP resources to expose
- Enrich responses with Cortex-owned metadata:
  - `projectId`
  - `slug`
  - `repoCandidates`
  - `indexedAt`
  - `branch`
  - `symbols`
  - `staleness`

## Phase 2: MCP Resource Surface in `hub-mcp`
**Goal:** Expose first-class read-only resources from the single Cortex MCP endpoint.

- Add MCP resources if supported by the current SDK/runtime:
  - `cortex://projects`
  - `cortex://project/{projectId}/context`
  - `cortex://project/{projectId}/clusters`
  - `cortex://project/{projectId}/cluster/{clusterName}`
  - `cortex://project/{projectId}/processes`
  - `cortex://project/{projectId}/process/{processName}`
  - `cortex://project/{projectId}/schema`
- If resource primitives are limited in the current transport/runtime, add temporary read-only tool shims with the same data model while preserving the planned URI contract in docs
- Keep `cortex_list_repos`, `cortex_code_search`, and `cortex_cypher` as the action-oriented companion tools

## Phase 3: Prompt & Session Enrichment
**Goal:** Make every new session start with a usable architecture map.

- Add prompt equivalents for:
  - `cortex_detect_impact`
  - `cortex_generate_map`
- Extend `cortex_session_start` so it can optionally return:
  - top clusters
  - top processes
  - suggested files
  - suggested next resources/tools
- Store a lightweight session snapshot for cross-app continuity

## Phase 4: Shared Metadata for Cross-App Linking
**Goal:** Let all clients talk about the same project entities.

- Expand session and analytics payloads to include:
  - `projectId`
  - `branch`
  - `filesTouched`
  - `symbolsTouched`
  - `processesAffected`
  - `clustersTouched`
- Reuse these identifiers in memory records, change reports, and quality reports where possible
- Ensure dashboard pages can display the same project vocabulary that MCP clients consume

## Phase 5: Deferred Features
**Goal:** Keep release risk low by pushing non-essential work to later phases.

- Defer `cortex_code_rename` until the resource contracts are stable
- Defer a visual graph explorer until:
  - the resource model is finalized
  - process and cluster endpoints are proven useful
  - there is clear human workflow demand beyond Mermaid maps and structured resources

## 4. Current Live State
- `Providers` live routing tests are working for both chat and embedding
- `cortex-hub` is now linked as a Cortex project and indexed through the dashboard job system
- `cortex_session_start` now resolves the linked project and returns `sharedMetadata.projectId`
- `0.4.4` is live with `/health=ok`, a working favicon asset, and `gitnexus.registered=true` again on the linked project
- The current blocker is no longer basic linking; it is **quality and trustworthiness of code-intel/context**
- Two issues stand out:
  - intel resource `staleness` can still prefer the older GitNexus timestamp over the fresher Cortex indexing timestamp until the reconciliation patch is deployed
  - indexing still falls back to pure JS extraction, leaving process/cluster quality weak even though project linking is now healthy

## Phase 5A: Runtime Health & Release Verification
**Goal:** Make the live system status trustworthy for operators after every deploy.

- Keep `/health` verification in the release flow so transient parity issues are caught quickly if they reappear
- Distinguish true service outage from false-negative health probes when investigating future deploys
- Verify the favicon release end-to-end:
  - page HTML references the icon
  - direct icon asset fetch resolves correctly
  - browser tabs/bookmarks show the new branding consistently after hard refresh
- Add release verification notes so operators can confirm both API and frontend deployment, not just `dashboard-api`

## Phase 5B: GitNexus Registration & Native Indexing Quality
**Goal:** Restore high-quality code intelligence so resources and prompts are worth trusting.

- Fix the missing GitNexus CLI/runtime path that caused `pure JS symbol extraction`
- Restore proper GitNexus repo registration for linked Cortex projects
- Ensure `cortex://project/{projectId}/clusters` and `.../processes` return meaningful names instead of `unknown`
- Reconcile Cortex-owned indexing metadata with GitNexus-owned graph metadata so staleness and symbol counts are consistent
- Re-run indexing on the linked `cortex-hub` project after the registration/runtime fix

## Phase 5C: Quality Gate Adoption
**Goal:** Turn the Quality dashboard from empty chrome into an operational audit trail.

- Make `cortex_quality_report` part of the normal phase-completion workflow
- Ensure at least one real report is written after each meaningful implementation phase
- Update dashboard expectations so empty-state messaging is clear until the first report exists
- Verify reports appear in:
  - dashboard overview card
  - `/quality`
  - session history and any downstream analytics that consume shared metadata

## Phase 5D: UX Follow-Ups After Data Quality Stabilizes
**Goal:** Decide on higher-level UX features only after underlying data becomes reliable.

- Re-evaluate whether a visual graph explorer is still necessary once:
  - project linking is stable
  - process and cluster labels are meaningful
  - prompts/resources cover most discovery workflows
- If still needed, scope a lightweight graph/process explorer rather than a generic node-canvas
- Design `cortex_code_rename` as preview-first/apply-second only after resource and process contracts stabilize

## Phase 6: Testing Phase
**Goal:** Validate both the release path and the new context model.

- Patch release validation:
  - `/memories` loads without HTML/JSON parsing failures
  - `GET /api/mem9/list` and delete flows still work
  - health endpoint reflects the new version
- Context layer validation:
  - each resource resolves correctly from `projectId`
  - responses remain stable across multiple clients
  - session start returns consistent hints and context summaries
  - token usage stays lower than equivalent repeated tool calls
- Runtime verification:
  - `/health` agrees with live service behavior
  - favicon asset resolves as a real icon response, not a fallback HTML route
  - linked project indexing uses the intended GitNexus/native path
  - quality reports appear after explicit submission and are reflected in dashboard summary cards

## Risks
- MCP SDK support for `server.resource(...)` may differ between local Node and deployed transports
- GitNexus resource response formats may drift between versions and need an adapter layer
- Cross-app metadata can become noisy if entity naming is not normalized early
- A graph UI can consume substantial effort without materially improving agent performance
- False-negative health checks can cause operators to distrust healthy deployments
- Falling back to pure JS extraction can make process/cluster resources look present but low-value

## Release Recommendation
- Ship the `/memories` fix as the next patch release
- Ship the GitNexus context fabric as the next minor release after the patch is stable
- For the next cycle, prioritize runtime trust and index quality before any graph-heavy UX work
