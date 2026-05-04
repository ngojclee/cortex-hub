'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import ThemedSelect from '@/components/ui/ThemedSelect'
import styles from './page.module.css'

import useSWR from 'swr'
import { listApiKeys, createApiKey, revokeApiKey } from '@/lib/api'

const scopeOptions = [
  { id: 'all', label: 'All Projects', description: 'Standard machine key for regular MCP usage across projects.' },
  { id: 'org:personal', label: 'Personal Org', description: 'Restrict usage to the Personal workspace/project scope.' },
  { id: 'write', label: 'Write Scope', description: 'Machine key that can pass write-oriented admin guards.' },
  { id: 'admin', label: 'Admin Scope', description: 'Recommended for MCP cleanup, audits, and project/knowledge repair.' },
  { id: 'owner', label: 'Owner Scope', description: 'Full owner-level machine access for trusted operators only.' },
  { id: 'system', label: 'System Scope', description: 'Service-to-service automation and platform maintenance flows.' },
  { id: 'full', label: 'Full Scope', description: 'Compatibility scope for legacy full-access machine clients.' },
]

const allPermissions = [
  { id: 'cortex.health', label: 'Health Check', group: 'System' },
  { id: 'cortex.memory.store', label: 'Store Memory', group: 'Memory' },
  { id: 'cortex.memory.search', label: 'Search Memory', group: 'Memory' },
  { id: 'cortex.code.search', label: 'Code Search', group: 'Code' },
  { id: 'admin', label: 'Admin Access', group: 'Admin' },
  { id: 'admin:write', label: 'Admin Write', group: 'Admin' },
  { id: 'project:write', label: 'Project Write', group: 'Admin' },
  { id: 'knowledge:write', label: 'Knowledge Write', group: 'Admin' },
  { id: '*', label: 'Wildcard', group: 'Admin' },
]

const standardPermissions = ['cortex.health', 'cortex.memory.store', 'cortex.memory.search', 'cortex.code.search']
const adminPermissions = ['admin', 'admin:write', 'project:write', 'knowledge:write']

function isAdminCapable(scope: string, permissions: string[]) {
  return ['admin', 'owner', 'system', 'write', 'full'].includes(scope) ||
    permissions.includes('*') ||
    permissions.includes('admin') ||
    permissions.includes('admin:write') ||
    permissions.includes('project:write') ||
    permissions.includes('knowledge:write')
}

function keyPreview(key: { id: string; prefix: string; keyPreview?: string }) {
  return key.keyPreview || `${key.prefix}...${key.id.slice(-6)}`
}

export default function KeysPage() {
  const { data, mutate } = useSWR('api_keys', listApiKeys)
  const keys = data?.keys ?? []
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyResult, setNewKeyResult] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const [keyName, setKeyName] = useState('')
  const [keyScope, setKeyScope] = useState('all')
  const [keyPerms, setKeyPerms] = useState<string[]>(standardPermissions)
  const [keyExpiry, setKeyExpiry] = useState('never')

  const selectedScope = scopeOptions.find((option) => option.id === keyScope)
  const creatingAdminCapable = isAdminCapable(keyScope, keyPerms)

  function togglePerm(id: string) {
    setKeyPerms((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])
  }

  function applyPreset(preset: 'standard' | 'admin' | 'full') {
    if (preset === 'standard') {
      setKeyScope('all')
      setKeyPerms(standardPermissions)
      return
    }

    if (preset === 'admin') {
      setKeyScope('admin')
      setKeyPerms([...standardPermissions, ...adminPermissions])
      return
    }

    setKeyScope('full')
    setKeyPerms([...standardPermissions, ...adminPermissions, '*'])
  }

  async function handleCreate() {
    setIsCreating(true)
    try {
      const result = await createApiKey({
        name: keyName,
        scope: keyScope,
        permissions: keyPerms,
        expiresInDays: keyExpiry === 'never' ? undefined : parseInt(keyExpiry),
      })

      setNewKeyResult(result.key)
      setShowCreate(false)
      setKeyName('')
      setKeyScope('all')
      setKeyPerms(standardPermissions)
      setKeyExpiry('never')
      mutate()
    } catch (err) {
      alert(`Failed to create key: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Are you sure you want to revoke this key? This action cannot be undone.')) return

    try {
      await revokeApiKey(id)
      mutate()
    } catch (err) {
      alert(`Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <DashboardLayout title="API Keys" subtitle="Manage authentication keys for MCP access">
      {newKeyResult && (
        <div className={styles.newKeyBanner}>
          <div className={styles.newKeyHeader}>
            <span>🔑</span>
            <strong>API Key Created</strong>
            <span style={{ color: 'var(--status-warning)', fontSize: '0.8125rem' }}>
              Copy now — won&apos;t be shown again
            </span>
          </div>
          <code className={styles.newKeyValue}>{newKeyResult}</code>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(newKeyResult)
              setNewKeyResult(null)
            }}
          >
            📋 Copy & Close
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Create API Key
        </button>
      </div>

      {showCreate && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2 style={{ marginBottom: 'var(--space-6)' }}>New API Key</h2>

            <label className={styles.fieldLabel}>Name</label>
            <input
              className="input"
              placeholder="e.g. my-agent-prod"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />

            <label className={styles.fieldLabel} style={{ marginTop: 'var(--space-5)' }}>Scope</label>
            <ThemedSelect
              className="input"
              value={keyScope}
              onChange={setKeyScope}
              options={scopeOptions.map((option) => ({ value: option.id, label: option.label }))}
            />
            {selectedScope && <p className={styles.fieldHint}>{selectedScope.description}</p>}

            <label className={styles.fieldLabel} style={{ marginTop: 'var(--space-5)' }}>Presets</label>
            <div className={styles.presetRow}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('standard')}>
                Standard MCP
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('admin')}>
                Admin Cleanup
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset('full')}>
                Full Access
              </button>
            </div>

            <label className={styles.fieldLabel} style={{ marginTop: 'var(--space-5)' }}>Permissions</label>
            <div className={styles.permGrid}>
              {allPermissions.map((permission) => (
                <label key={permission.id} className={styles.permItem}>
                  <input
                    type="checkbox"
                    checked={keyPerms.includes(permission.id)}
                    onChange={() => togglePerm(permission.id)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <span>{permission.label}</span>
                  <span className={styles.permGroup}>{permission.group}</span>
                </label>
              ))}
            </div>
            <p className={styles.fieldHint}>
              Admin cleanup MCP tools require either admin-like scope (`admin`, `owner`, `system`, `write`, `full`)
              or one of `admin`, `admin:write`, `project:write`, `knowledge:write`, `*`.
            </p>

            <label className={styles.fieldLabel} style={{ marginTop: 'var(--space-5)' }}>Expiration</label>
            <ThemedSelect
              className="input"
              value={keyExpiry}
              onChange={setKeyExpiry}
              options={[
                { value: 'never', label: 'Never' },
                { value: '30', label: '30 days' },
                { value: '90', label: '90 days' },
                { value: '365', label: '1 year' },
              ]}
            />

            <div className={creatingAdminCapable ? styles.adminNotice : styles.standardNotice}>
              <strong>{creatingAdminCapable ? 'Admin-capable key' : 'Standard machine key'}</strong>
              <span>
                {creatingAdminCapable
                  ? 'This key should be able to call MCP audit and cleanup tools once created.'
                  : 'This key is fine for normal MCP usage, but it will still be rejected by admin cleanup tools.'}
              </span>
            </div>

            <div className={styles.modalActions}>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!keyName || isCreating}
                onClick={handleCreate}
              >
                {isCreating ? 'Generating...' : 'Generate Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Scope</th>
              <th>Capabilities</th>
              <th>Created</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td className={styles.keyName}>{key.name}</td>
                <td><code className={styles.keyPrefix} title={key.id}>{keyPreview(key)}</code></td>
                <td>{key.scope}</td>
                <td>
                  <span className={isAdminCapable(key.scope, key.permissions) ? styles.capabilityAdmin : styles.capabilityStandard}>
                    {isAdminCapable(key.scope, key.permissions) ? 'Admin-capable' : 'Standard'}
                  </span>
                </td>
                <td className={styles.cellMuted}>{key.createdAt}</td>
                <td className={styles.cellMuted}>{key.expiresAt ?? 'Never'}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRevoke(key.id)}
                    style={{ color: 'var(--status-error)' }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyState}>
                  No API keys. Create one to connect your AI agent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
