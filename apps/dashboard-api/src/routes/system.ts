import { Hono } from 'hono'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { createLogger } from '@cortex/shared-utils'
import { db } from '../db/client.js'

export const systemRouter = new Hono()
const logger = createLogger('system')

interface ContainerInfo {
  name: string
  status: string
  cpu: string
  cpuPercent: number
  memory: string
  memoryRaw: number
  memoryLimit: number
  memoryPercent: number
  uptime: string
  image: string
}

interface IndexJobInfo {
  id: string
  projectId: string
  projectName: string
  branch: string
  status: string
  progress: number
  totalFiles: number
  symbolsFound: number
  mem9Status: string | null
  mem9Chunks: number
  docsKnowledgeStatus: string | null
  docsKnowledgeCount: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  error: string | null
  active: boolean
}

interface DiskInfo {
  filesystem: string
  size: string
  used: string
  available: string
  usedPercent: number
  mountpoint: string
}

interface RuntimeLogEntry {
  container: string
  stream: string
  message: string
  timestamp: string | null
}

interface DockerContainerJson {
  Id?: string
  Names?: string[]
  Image?: string
  State?: string
  Status?: string
}

interface DockerStatsJson {
  cpu_stats?: {
    cpu_usage?: {
      total_usage?: number
      percpu_usage?: number[]
    }
    system_cpu_usage?: number
    online_cpus?: number
  }
  precpu_stats?: {
    cpu_usage?: {
      total_usage?: number
    }
    system_cpu_usage?: number
  }
  memory_stats?: {
    usage?: number
    limit?: number
    stats?: Record<string, number | undefined>
  }
}

interface ContainerSample {
  cpu: string
  cpuPercent: number
  memory: string
  memoryRaw: number
  memoryLimit: number
  memoryPercent: number
}

const LOGGABLE_DOCKER_SERVICES = [
  'cortex-api',
  'cortex-mcp',
  'cortex-gitnexus',
  'cortex-llm-proxy',
  'cortex-qdrant',
] as const

function readDockerSocket(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: '/var/run/docker.sock',
      method: 'GET',
      path,
      timeout: 15_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body)
          return
        }
        reject(new Error(`Docker API ${res.statusCode ?? 'unknown'}: ${body || res.statusMessage || 'no body'}`))
      })
    })

    req.on('timeout', () => { req.destroy(new Error('Docker API request timed out')) })
    req.on('error', reject)
    req.end()
  })
}

function sanitizeLogLine(line: string): string {
  return line
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/([?&](?:key|token|password|secret)=)[^&\s]+/gi, '$1[redacted]')
}

function parseDockerLogLine(container: string, raw: string): RuntimeLogEntry | null {
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
  if (!cleaned) return null

  const timestampMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+(.*)$/)
  const timestamp = timestampMatch?.[1] ?? null
  const message = sanitizeLogLine(timestampMatch?.[2] ?? cleaned)
  const lowered = message.toLowerCase()
  const stream = lowered.includes('error') || lowered.includes('warn') || lowered.includes('failed')
    ? 'stderr'
    : 'stdout'

  return { container, stream, message, timestamp }
}

async function getContainerLogs(container: string, tail: number): Promise<RuntimeLogEntry[]> {
  const safeTail = Math.min(300, Math.max(10, tail))
  const path = `/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&timestamps=1&tail=${safeTail}`
  const body = await readDockerSocket(path)
  return body
    .split('\n')
    .map((line) => parseDockerLogLine(container, line))
    .filter((entry): entry is RuntimeLogEntry => Boolean(entry))
}

// ── Helper: get Docker container stats ──
// `docker stats --no-stream` blocks ~1.5s while sampling CPU. Without caching,
// every /api/system/metrics request (Ops page polls every 15s, multiple tabs
// possible) would re-sample the daemon. We cache the parsed result for a short
// TTL and restrict the query to Cortex containers by default.
const CONTAINER_STATS_TTL_MS = (() => {
  const raw = Number(process.env.CONTAINER_STATS_TTL_MS ?? '8000')
  return Number.isFinite(raw) && raw >= 0 ? raw : 8000
})()
const CONTAINER_NAME_FILTER = (process.env.CONTAINER_STATS_NAME_FILTER ?? 'cortex-').trim()
let containerStatsCache: { ts: number; data: ContainerInfo[] } | null = null

async function getContainerStats(): Promise<ContainerInfo[]> {
  if (
    containerStatsCache &&
    CONTAINER_STATS_TTL_MS > 0 &&
    Date.now() - containerStatsCache.ts < CONTAINER_STATS_TTL_MS
  ) {
    return containerStatsCache.data
  }

  try {
    const stats = await getContainerStatsFromDockerSocket()
    containerStatsCache = { ts: Date.now(), data: stats }
    return stats
  } catch (error) {
    logger.warn(`Docker socket container stats failed, trying docker CLI fallback: ${String(error)}`)
  }

  const stats = getContainerStatsFromDockerCli()
  containerStatsCache = { ts: Date.now(), data: stats }
  return stats
}

async function getContainerStatsFromDockerSocket(): Promise<ContainerInfo[]> {
  const params = new URLSearchParams({ all: '1' })
  if (CONTAINER_NAME_FILTER) {
    params.set('filters', JSON.stringify({ name: [CONTAINER_NAME_FILTER] }))
  }

  const output = await readDockerSocket(`/containers/json?${params.toString()}`)
  const containers = JSON.parse(output) as DockerContainerJson[]
  if (!Array.isArray(containers)) return []

  const stats = await Promise.all(containers.map(async (container) => {
    const name = getDockerContainerName(container)
    const state = container.State ?? 'unknown'
    const id = container.Id ?? name
    let sample: ContainerSample | null = null

    if (state === 'running') {
      sample = await getDockerSocketContainerSample(id).catch(() => null)
    }

    return {
      name,
      status: state,
      cpu: sample?.cpu ?? '0%',
      cpuPercent: sample?.cpuPercent ?? 0,
      memory: sample?.memory ?? '—',
      memoryRaw: sample?.memoryRaw ?? 0,
      memoryLimit: sample?.memoryLimit ?? 0,
      memoryPercent: sample?.memoryPercent ?? 0,
      uptime: container.Status ?? '',
      image: formatContainerImage(container.Image ?? ''),
    }
  }))

  return sortContainerStats(stats)
}

async function getDockerSocketContainerSample(containerId: string): Promise<ContainerSample> {
  const output = await readDockerSocket(`/containers/${encodeURIComponent(containerId)}/stats?stream=false&one-shot=true`)
  const stats = JSON.parse(output) as DockerStatsJson
  const cpuPercent = calculateDockerCpuPercent(stats)
  const memoryRaw = calculateDockerMemoryUsage(stats)
  const memoryLimit = stats.memory_stats?.limit ?? 0
  const memoryPercent = memoryLimit > 0 ? (memoryRaw / memoryLimit) * 100 : 0

  return {
    cpu: `${cpuPercent.toFixed(2)}%`,
    cpuPercent,
    memory: memoryLimit > 0 ? `${formatBytes(memoryRaw)} / ${formatBytes(memoryLimit)}` : '—',
    memoryRaw,
    memoryLimit,
    memoryPercent,
  }
}

function calculateDockerCpuPercent(stats: DockerStatsJson): number {
  const cpuTotal = stats.cpu_stats?.cpu_usage?.total_usage ?? 0
  const previousCpuTotal = stats.precpu_stats?.cpu_usage?.total_usage ?? 0
  const systemTotal = stats.cpu_stats?.system_cpu_usage ?? 0
  const previousSystemTotal = stats.precpu_stats?.system_cpu_usage ?? 0
  const cpuDelta = cpuTotal - previousCpuTotal
  const systemDelta = systemTotal - previousSystemTotal
  const onlineCpus =
    stats.cpu_stats?.online_cpus ??
    stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
    1

  if (cpuDelta <= 0 || systemDelta <= 0) return 0
  return (cpuDelta / systemDelta) * onlineCpus * 100
}

function calculateDockerMemoryUsage(stats: DockerStatsJson): number {
  const usage = stats.memory_stats?.usage ?? 0
  const memoryStats = stats.memory_stats?.stats ?? {}
  const cache = memoryStats['inactive_file'] ?? memoryStats['cache'] ?? 0
  return usage > cache ? usage - cache : usage
}

function getDockerContainerName(container: DockerContainerJson): string {
  const name = container.Names?.find((candidate) => candidate.trim().length > 0)
  return (name ?? container.Id ?? 'unknown').replace(/^\//, '')
}

function formatContainerImage(image: string): string {
  return image.split(':')[0]?.split('/').pop() ?? image
}

function getContainerStatsFromDockerCli(): ContainerInfo[] {
  try {
    // Get container list via docker ps (filter to reduce daemon load)
    const psArgs = ['ps', '-a', '--format', '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}']
    if (CONTAINER_NAME_FILTER) psArgs.push('--filter', `name=${CONTAINER_NAME_FILTER}`)

    const psOutput = execFileSync('docker', psArgs, { timeout: 5000, encoding: 'utf-8' }).trim()

    if (!psOutput) {
      return []
    }

    const containers = psOutput.split('\n').filter(Boolean)
    const stats: ContainerInfo[] = []

    // Get stats for all running containers in one call (filtered)
    let statsMap: Record<string, { cpu: string; cpuPercent: number; memory: string; memPercent: number }> = {}
    try {
      const statsArgs = [
        'stats', '--no-stream',
        '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}',
      ]
      if (CONTAINER_NAME_FILTER) statsArgs.push('--filter', `name=${CONTAINER_NAME_FILTER}`)

      const statsOutput = execFileSync('docker', statsArgs, { timeout: 10000, encoding: 'utf-8' }).trim()

      if (statsOutput) {
        for (const line of statsOutput.split('\n').filter(Boolean)) {
          const [name, cpu, memory, memPerc] = line.split('|')
          if (name) {
            statsMap[name] = {
              cpu: cpu ?? '0%',
              cpuPercent: parseFloat(cpu?.replace('%', '') ?? '0') || 0,
              memory: memory ?? '0B / 0B',
              memPercent: parseFloat(memPerc?.replace('%', '') ?? '0') || 0,
            }
          }
        }
      }
    } catch {
      // docker stats might fail if no running containers
    }

    for (const line of containers) {
      const [name, state, statusText, image] = line.split('|')
      if (!name) continue

      const containerStats = statsMap[name]
      let memoryRaw = 0
      let memoryLimit = 0

      if (containerStats?.memory) {
        const memMatch = containerStats.memory.match(/([\d.]+)(\w+)\s*\/\s*([\d.]+)(\w+)/)
        if (memMatch) {
          memoryRaw = parseToBytes(parseFloat(memMatch[1]!), memMatch[2]!)
          memoryLimit = parseToBytes(parseFloat(memMatch[3]!), memMatch[4]!)
        }
      }

      stats.push({
        name: name ?? 'unknown',
        status: state ?? 'unknown',
        cpu: containerStats?.cpu ?? '0%',
        cpuPercent: containerStats?.cpuPercent ?? 0,
        memory: containerStats?.memory ?? '—',
        memoryRaw,
        memoryLimit,
        memoryPercent: containerStats?.memPercent ?? 0,
        uptime: statusText ?? '',
        image: formatContainerImage(image ?? ''),
      })
    }

    return sortContainerStats(stats)
  } catch (error) {
    logger.warn(`Docker CLI container stats failed: ${String(error)}`)
    return []
  }
}

function sortContainerStats(stats: ContainerInfo[]): ContainerInfo[] {
  return stats.sort((a, b) =>
    (b.cpuPercent - a.cpuPercent) ||
    (b.memoryRaw - a.memoryRaw) ||
    a.name.localeCompare(b.name),
  )
}

function parseToBytes(value: number, unit: string): number {
  const u = unit.toLowerCase()
  if (u.includes('gib') || u.includes('gb')) return value * 1024 * 1024 * 1024
  if (u.includes('mib') || u.includes('mb')) return value * 1024 * 1024
  if (u.includes('kib') || u.includes('kb')) return value * 1024
  return value
}

// ── Helper: get disk usage ──
function getDiskUsage(): DiskInfo[] {
  try {
    const output = execFileSync('df', ['-h', '/'], {
      timeout: 3000, encoding: 'utf-8',
    })
    const lines = output.trim().split('\n')
    if (lines.length < 2) return []

    const parts = lines[1]!.split(/\s+/)
    return [{
      filesystem: parts[0] ?? 'unknown',
      size: parts[1] ?? '0',
      used: parts[2] ?? '0',
      available: parts[3] ?? '0',
      usedPercent: parseInt(parts[4]?.replace('%', '') ?? '0', 10),
      mountpoint: parts[5] ?? '/',
    }]
  } catch {
    return []
  }
}

// ── Helper: get CPU usage (average over 1 second) ──
function getCpuUsage(): { percent: number; cores: number; model: string; loadAvg: number[] } {
  const cpus = os.cpus()
  const loadAvg = os.loadavg()
  const cores = cpus.length
  // Use 1-min load average as percentage of cores
  const percent = Math.min(100, Math.round((loadAvg[0]! / cores) * 100))

  return {
    percent,
    cores,
    model: cpus[0]?.model ?? 'Unknown',
    loadAvg: loadAvg.map(l => Math.round(l * 100) / 100),
  }
}

function getIndexJobColumnExpr(columns: Set<string>, preferred: string, fallback: string | null, alias: string): string {
  if (columns.has(preferred)) return `ij.${preferred} as ${alias}`
  if (fallback && columns.has(fallback)) return `ij.${fallback} as ${alias}`
  return `NULL as ${alias}`
}

function getIndexJobColumnValue(columns: Set<string>, preferred: string, fallback?: string): string {
  if (columns.has(preferred)) return `ij.${preferred}`
  if (fallback && columns.has(fallback)) return `ij.${fallback}`
  return 'NULL'
}

function getIndexJobs(): IndexJobInfo[] {
  try {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(index_jobs)').all() as Array<{ name: string }>).map((row) => row.name),
    )
    const mem9StatusExpr = getIndexJobColumnValue(columns, 'mem9_status')
    const docsStatusExpr = getIndexJobColumnValue(columns, 'docs_knowledge_status', 'docs_status')

    const rows = db.prepare(`
      SELECT
        ij.id,
        ij.project_id as projectId,
        COALESCE(p.name, ij.project_id) as projectName,
        ij.branch,
        ij.status,
        ij.progress,
        ij.total_files as totalFiles,
        ij.symbols_found as symbolsFound,
        ${getIndexJobColumnExpr(columns, 'mem9_status', null, 'mem9Status')},
        ${getIndexJobColumnExpr(columns, 'mem9_chunks', null, 'mem9Chunks')},
        ${getIndexJobColumnExpr(columns, 'docs_knowledge_status', 'docs_status', 'docsKnowledgeStatus')},
        ${getIndexJobColumnExpr(columns, 'docs_knowledge_count', 'docs_count', 'docsKnowledgeCount')},
        ij.started_at as startedAt,
        ij.completed_at as completedAt,
        ij.created_at as createdAt,
        ij.error
      FROM index_jobs ij
      LEFT JOIN projects p ON p.id = ij.project_id
      ORDER BY
        CASE
          WHEN ij.status IN ('pending', 'cloning', 'analyzing', 'ingesting') THEN 0
          WHEN ${mem9StatusExpr} = 'embedding' THEN 1
          WHEN ${docsStatusExpr} = 'building' THEN 2
          ELSE 3
        END,
        COALESCE(ij.started_at, ij.created_at) DESC
      LIMIT 16
    `).all() as Array<{
      id: string
      projectId: string
      projectName: string
      branch: string | null
      status: string | null
      progress: number | null
      totalFiles: number | null
      symbolsFound: number | null
      mem9Status: string | null
      mem9Chunks: number | null
      docsKnowledgeStatus: string | null
      docsKnowledgeCount: number | null
      startedAt: string | null
      completedAt: string | null
      createdAt: string
      error: string | null
    }>

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      branch: row.branch ?? 'main',
      status: row.status ?? 'unknown',
      progress: row.progress ?? 0,
      totalFiles: row.totalFiles ?? 0,
      symbolsFound: row.symbolsFound ?? 0,
      mem9Status: row.mem9Status,
      mem9Chunks: row.mem9Chunks ?? 0,
      docsKnowledgeStatus: row.docsKnowledgeStatus,
      docsKnowledgeCount: row.docsKnowledgeCount ?? 0,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      error: row.error,
      active: isIndexJobActive(row.status, row.mem9Status, row.docsKnowledgeStatus),
    }))
  } catch {
    return []
  }
}

function isIndexJobActive(status: string | null, mem9Status: string | null, docsKnowledgeStatus: string | null): boolean {
  return ['pending', 'cloning', 'analyzing', 'ingesting'].includes(status ?? '') ||
    mem9Status === 'embedding' || docsKnowledgeStatus === 'building'
}

// ── Runtime logs endpoint ──
systemRouter.get('/logs', async (c) => {
  const service = c.req.query('service') ?? 'all'
  const tail = Number(c.req.query('tail') ?? 80)
  const allowed = [...LOGGABLE_DOCKER_SERVICES]

  if (service !== 'all' && !allowed.includes(service as typeof LOGGABLE_DOCKER_SERVICES[number])) {
    return c.json({ error: `Cannot read logs for "${service}". Allowed: all, ${allowed.join(', ')}` }, 400)
  }

  try {
    const targets = service === 'all' ? allowed : [service]
    const logs = (await Promise.all(
      targets.map((container) => getContainerLogs(container, Math.ceil(tail / targets.length)).catch(() => [])),
    ))
      .flat()
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, Math.min(300, Math.max(10, tail)))

    return c.json({ service, tail, logs })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── Main endpoint ──
systemRouter.get('/metrics', async (c) => {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memPercent = Math.round((usedMem / totalMem) * 100)

  const cpu = getCpuUsage()
  const disk = getDiskUsage()
  const containers = await getContainerStats()
  const indexJobs = getIndexJobs()

  // Network info
  const networkInterfaces = os.networkInterfaces()
  const primaryIp = Object.values(networkInterfaces)
    .flat()
    .find(iface => iface && !iface.internal && iface.family === 'IPv4')?.address ?? 'unknown'

  return c.json({
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(os.uptime()),
    ip: primaryIp,
    cpu: {
      percent: cpu.percent,
      cores: cpu.cores,
      model: cpu.model,
      loadAvg: cpu.loadAvg,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: memPercent,
      totalHuman: formatBytes(totalMem),
      usedHuman: formatBytes(usedMem),
      freeHuman: formatBytes(freeMem),
    },
    disk: disk.map(d => ({
      ...d,
    })),
    containers,
    indexJobs,
  })
})

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
