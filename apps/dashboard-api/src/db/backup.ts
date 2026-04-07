/**
 * Database backup automation for Cortex Hub.
 *
 * Usage:
 *   pnpm --filter @cortex/dashboard-api run db:backup
 *   BACKUP_KEEP_COUNT=14 pnpm --filter @cortex/dashboard-api run db:backup
 *
 * Creates timestamped backups and rotates old ones.
 * Designed to run via cron or scheduled task.
 */

import Database from 'better-sqlite3'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { createGzip } from 'zlib'
import { join, dirname } from 'path'

const DB_PATH = process.env.DATABASE_PATH ?? join(process.cwd(), 'data', 'cortex.db')
const BACKUP_DIR = process.env.BACKUP_DIR ?? join(process.cwd(), 'data', 'backups')
const KEEP_COUNT = parseInt(process.env.BACKUP_KEEP_COUNT ?? '7', 10)

async function createBackup(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupName = `cortex-${timestamp}.db.gz`
  const backupPath = join(BACKUP_DIR, backupName)

  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }

  // Use SQLite VACUUM INTO for a consistent snapshot
  const tempPath = join(BACKUP_DIR, `cortex-${timestamp}.db`)
  const db = new Database(DB_PATH, { readonly: true })
  db.exec(`VACUUM INTO '${tempPath}'`)
  db.close()

  // Gzip the backup
  return new Promise<string>((resolve, reject) => {
    const source = createReadStream(tempPath)
    const dest = createWriteStream(backupPath)
    const gzip = createGzip()

    source.pipe(gzip).pipe(dest)

    dest.on('finish', () => {
      // Remove uncompressed temp file
      try { unlinkSync(tempPath) } catch { /* ignore */ }
      console.log(`[backup] Created: ${backupPath}`)
      resolve(backupPath)
    })

    dest.on('error', reject)
    source.on('error', reject)
  })
}

function rotateBackups(keepCount: number): void {
  if (!existsSync(BACKUP_DIR)) return

  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('cortex-') && f.endsWith('.db.gz'))
    .map((f) => ({
      name: f,
      path: join(BACKUP_DIR, f),
      mtime: statSync(join(BACKUP_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime)

  const toDelete = files.slice(keepCount)
  for (const file of toDelete) {
    console.log(`[backup] Rotating: ${file.name}`)
    unlinkSync(file.path)
  }

  if (toDelete.length > 0) {
    console.log(`[backup] Rotated ${toDelete.length} old backup(s). Kept ${files.length - toDelete.length}.`)
  }
}

// Run
async function main() {
  console.log(`[backup] Starting backup of ${DB_PATH}`)
  await createBackup()
  rotateBackups(KEEP_COUNT)
  console.log('[backup] Done.')
}

void main().catch((err) => {
  console.error('[backup] Failed:', err)
  process.exit(1)
})
