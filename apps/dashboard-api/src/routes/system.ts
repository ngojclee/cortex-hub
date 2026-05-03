import { Hono } from 'hono'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { db } from '../db/client.js'

export const systemRouter = new Hono()

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

// ── Helper: get Docker container stats ──
function getContainerStats(): ContainerInfo[] {
  try {
    // Get container list via docker ps
    const psOutput = execFileSync('docker', [
      'ps', '-a',
      '--format', '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}',
    ], { timeout: 5000, encoding: 'utf-8' }).trim()

    if (!psOutput) return []

    const containers = psOutput.split('\n').filter(Boolean)
    const stats: ContainerInfo[] = []

    // Get stats for all running containers in one call
    let statsMap: Record<string, { cpu: string; cpuPercent: number; memory: string; memPercent: number }> = {}
    try {
      const statsOutput = execFileSync('docker', [
        'stats', '--no-stream',
        '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}',
      ], { timeout: 10000, encoding: 'utf-8' }).trim()

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
        image: (image ?? '').split(':')[0]?.split('/').pop() ?? image ?? '',
      })
    }

    return stats.sort((a, b) => (b.cpuPercent - a.cpuPercent) || (b.memoryRaw - a.memoryRaw) || a.name.localeCompare(b.name))
  } catch {
    return []
  }
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

// ── Main endpoint ──
systemRouter.get('/metrics', async (c) => {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memPercent = Math.round((usedMem / totalMem) * 100)

  const cpu = getCpuUsage()
  const disk = getDiskUsage()
  const containers = getContainerStats()
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
