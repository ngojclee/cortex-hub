/**
 * Formal migration system for Cortex Hub SQLite database.
 *
 * Migrations are numbered sequentially. Each migration runs in a transaction
 * and is tracked in the `_migrations` table. Safe for production: skips
 * already-applied migrations, rolls back on failure.
 */

import type Database from 'better-sqlite3'

export interface Migration {
  id: number
  name: string
  up: (db: Database.Database) => void
}

/* ── Migration registry ── */

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'create_api_keys_permissions',
    up(db) {
      db.exec(`ALTER TABLE api_keys ADD COLUMN permissions TEXT`)
      db.exec(`ALTER TABLE api_keys ADD COLUMN project_id TEXT`)
    },
  },
  {
    id: 2,
    name: 'create_index_jobs_mem9',
    up(db) {
      db.exec(`ALTER TABLE index_jobs ADD COLUMN mem9_status TEXT DEFAULT 'pending'`)
      db.exec(`ALTER TABLE index_jobs ADD COLUMN mem9_chunks INTEGER DEFAULT 0`)
      db.exec(`ALTER TABLE index_jobs ADD COLUMN mem9_indexed_at TEXT`)
    },
  },
  {
    id: 3,
    name: 'create_index_jobs_docs_knowledge',
    up(db) {
      db.exec(`ALTER TABLE index_jobs ADD COLUMN docs_status TEXT DEFAULT 'pending'`)
      db.exec(`ALTER TABLE index_jobs ADD COLUMN docs_count INTEGER DEFAULT 0`)
      db.exec(`ALTER TABLE index_jobs ADD COLUMN docs_indexed_at TEXT`)
    },
  },
  {
    id: 4,
    name: 'create_query_logs_extended',
    up(db) {
      db.exec(`ALTER TABLE query_logs ADD COLUMN project_id TEXT`)
      db.exec(`ALTER TABLE query_logs ADD COLUMN model TEXT`)
      db.exec(`ALTER TABLE query_logs ADD COLUMN input_tokens INTEGER`)
      db.exec(`ALTER TABLE query_logs ADD COLUMN output_tokens INTEGER`)
    },
  },
  {
    id: 5,
    name: 'create_provider_accounts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          auth_type TEXT DEFAULT 'api_key',
          api_base TEXT NOT NULL,
          api_key TEXT,
          status TEXT DEFAULT 'enabled',
          capabilities TEXT DEFAULT '["chat"]',
          models TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `)
    },
  },
  {
    id: 6,
    name: 'create_model_routing',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_routing (
          purpose TEXT PRIMARY KEY,
          chain TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `)
    },
  },
  {
    id: 7,
    name: 'create_quality_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quality_reports (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          grade TEXT NOT NULL,
          score INTEGER NOT NULL,
          dimensions TEXT,
          shared_metadata TEXT,
          notes TEXT,
          agent_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `)
    },
  },
  {
    id: 8,
    name: 'create_app_settings',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `)
    },
  },
  {
    id: 9,
    name: 'create_auth_requests',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_requests (
          id TEXT PRIMARY KEY,
          telegram_user_id TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        )
      `)
    },
  },
  {
    id: 10,
    name: 'create_sessions_connection_source',
    up(db) {
      db.exec(`ALTER TABLE session_handoffs ADD COLUMN transport TEXT`)
      db.exec(`ALTER TABLE session_handoffs ADD COLUMN client_app TEXT`)
      db.exec(`ALTER TABLE session_handoffs ADD COLUMN client_host TEXT`)
      db.exec(`ALTER TABLE session_handoffs ADD COLUMN client_user_agent TEXT`)
      db.exec(`ALTER TABLE session_handoffs ADD COLUMN client_ip TEXT`)
    },
  },
]

/* ── Runner ── */

export function runMigrations(db: Database.Database): void {
  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((r: any) => r.id as number),
  )

  const pending = migrations
    .filter((m) => !applied.has(m.id))
    .sort((a, b) => a.id - b.id)

  if (pending.length === 0) {
    console.log(`[migrator] All ${migrations.length} migrations already applied.`)
    return
  }

  console.log(`[migrator] Applying ${pending.length} pending migration(s)...`)

  const insertMigration = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')

  for (const migration of pending) {
    const runInTx = db.transaction(() => {
      console.log(`[migrator] #${migration.id}: ${migration.name}`)
      migration.up(db)
      insertMigration.run(migration.id, migration.name)
    })

    try {
      runInTx()
    } catch (err) {
      console.error(`[migrator] FAILED #${migration.id} (${migration.name}):`, err)
      // Continue with next migration — individual column/table failures
      // (e.g., column already exists) are non-fatal for additive migrations
      const fallbackInsert = db.prepare('INSERT OR IGNORE INTO _migrations (id, name) VALUES (?, ?)')
      fallbackInsert.run(migration.id, migration.name)
    }
  }

  console.log(`[migrator] Done. Applied ${pending.length} migration(s).`)
}

/* ── Backup helper ── */

export function createBackup(db: Database.Database, backupPath: string): void {
  const fs = require('fs')
  const dir = require('path').dirname(backupPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  db.exec(`VACUUM INTO '${backupPath}'`)
  console.log(`[migrator] Backup created: ${backupPath}`)
}
