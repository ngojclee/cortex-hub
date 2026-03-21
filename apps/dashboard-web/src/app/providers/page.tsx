'use client'

import { useState, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { config } from '@/lib/config'
import styles from './page.module.css'

// ── Types ──
interface ProviderAccount {
  id: string
  name: string
  type: string
  api_base: string
  api_key: string | null
  status: string
  capabilities: string[]
  models: string[]
  created_at: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface AccountsResponse {
  accounts: ProviderAccount[]
  pagination: Pagination
}

// ── Constants ──
const TYPE_LABELS: Record<string, string> = {
  openai_compat: 'OpenAI Compatible',
  gemini: 'Gemini API',
  anthropic: 'Anthropic API',
}

const TYPE_ICONS: Record<string, string> = {
  openai_compat: '🤖',
  gemini: '✨',
  anthropic: '🧩',
}

const TYPE_DEFAULTS: Record<string, string> = {
  openai_compat: 'http://llm-proxy:8317/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1',
}

// ── Fetcher ──
async function fetchAccounts(page = 1, search = ''): Promise<AccountsResponse> {
  const params = new URLSearchParams({ page: String(page), limit: '20' })
  if (search) params.set('search', search)
  const res = await fetch(`${config.api.base}/api/accounts?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error('Failed to fetch accounts')
  return res.json()
}

// ── Components ──
function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    enabled: 'var(--success)',
    disabled: 'var(--text-tertiary)',
    error: 'var(--danger)',
  }
  return (
    <span
      className={styles.statusBadge}
      style={{ '--badge-color': colorMap[status] || 'var(--text-tertiary)' } as React.CSSProperties}
    >
      <span className={styles.statusDot} />
      {status === 'enabled' ? 'Enabled' : status === 'disabled' ? 'Disabled' : 'Error'}
    </span>
  )
}

function AddProviderDialog({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: {
    name: string
    type: string
    apiBase: string
    apiKey: string
    capabilities: string[]
  }) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('openai_compat')
  const [apiBase, setApiBase] = useState(TYPE_DEFAULTS['openai_compat'] ?? '')
  const [apiKey, setApiKey] = useState('')
  const [caps, setCaps] = useState<string[]>(['chat'])

  const toggleCap = (cap: string) => {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]))
  }

  const handleTypeChange = (newType: string) => {
    setType(newType)
    setApiBase(TYPE_DEFAULTS[newType] ?? '')
    // Auto-set capabilities based on type
    if (newType === 'gemini') setCaps(['chat', 'embedding'])
    else if (newType === 'anthropic') setCaps(['chat', 'code'])
    else setCaps(['chat'])
  }

  return (
    <div className={styles.dialogOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <h3 className={styles.dialogTitle}>Add Provider</h3>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Name</label>
          <input
            className={styles.dialogInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. OpenAI (Personal)"
            autoFocus
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Type</label>
          <select
            className={styles.dialogSelect}
            value={type}
            onChange={(e) => handleTypeChange(e.target.value)}
          >
            <option value="openai_compat">OpenAI Compatible</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>API Base URL</label>
          <input
            className={styles.dialogInput}
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>API Key</label>
          <input
            className={styles.dialogInput}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-... or AIza..."
          />
        </div>

        <div className={styles.dialogField}>
          <label className={styles.dialogLabel}>Capabilities</label>
          <div className={styles.capsGroup}>
            {['chat', 'embedding', 'code'].map((cap) => (
              <label key={cap} className={styles.capCheckbox}>
                <input
                  type="checkbox"
                  checked={caps.includes(cap)}
                  onChange={() => toggleCap(cap)}
                />
                {cap.charAt(0).toUpperCase() + cap.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.dialogActions}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || !apiBase.trim()}
            onClick={() => onSave({ name, type, apiBase, apiKey, capabilities: caps })}
          >
            Add Provider
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──
export default function ProvidersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    ['provider-accounts', page, search],
    () => fetchAccounts(page, search),
    { refreshInterval: 30000 }
  )

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const handleAdd = useCallback(
    async (formData: { name: string; type: string; apiBase: string; apiKey: string; capabilities: string[] }) => {
      try {
        const res = await fetch(`${config.api.base}/api/accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
          signal: AbortSignal.timeout(10000),
        })
        const result = (await res.json()) as { success?: boolean; error?: string }
        if (result.success) {
          showToast('success', `✅ Provider "${formData.name}" added`)
          setShowAddDialog(false)
          mutate()
        } else {
          showToast('error', `❌ ${result.error || 'Failed to add provider'}`)
        }
      } catch (err) {
        showToast('error', `❌ ${String(err)}`)
      }
    },
    [mutate, showToast]
  )

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Delete provider "${name}"?`)) return
      try {
        await fetch(`${config.api.base}/api/accounts/${id}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        })
        showToast('success', `🗑️ Provider "${name}" removed`)
        mutate()
      } catch (err) {
        showToast('error', `❌ ${String(err)}`)
      }
    },
    [mutate, showToast]
  )

  const handleTest = useCallback(
    async (id: string) => {
      setTestingId(id)
      try {
        const res = await fetch(`${config.api.base}/api/accounts/${id}/test`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
        })
        const result = (await res.json()) as { success: boolean; modelCount?: number; error?: string }
        if (result.success) {
          showToast('success', `✅ Connection OK — ${result.modelCount} models found`)
          mutate()
        } else {
          showToast('error', `❌ ${result.error || 'Test failed'}`)
        }
      } catch (err) {
        showToast('error', `❌ ${String(err)}`)
      } finally {
        setTestingId(null)
      }
    },
    [mutate, showToast]
  )

  const handleToggleStatus = useCallback(
    async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled'
      try {
        await fetch(`${config.api.base}/api/accounts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
          signal: AbortSignal.timeout(5000),
        })
        mutate()
      } catch (err) {
        showToast('error', `❌ ${String(err)}`)
      }
    },
    [mutate, showToast]
  )

  const accounts = data?.accounts ?? []
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 }

  return (
    <DashboardLayout title="Providers" subtitle="Manage LLM providers">
      {/* Toast */}
      {toast && (
        <div
          className={styles.toast}
          style={{ borderColor: toast.type === 'success' ? 'var(--success)' : 'var(--danger)' }}
        >
          <span>{toast.message}</span>
          <button className={styles.toastClose} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {/* Header with Add + Refresh */}
      <div className={styles.headerRow}>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchBar}
            placeholder="Search providers..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddDialog(true)}>
            + Add Provider
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => mutate()} disabled={isLoading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className={`card ${styles.errorCard}`}>
          <p>Failed to load providers. Is the backend API running?</p>
          <button className="btn btn-primary btn-sm" onClick={() => mutate()}>
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>API Base</th>
              <th>API Key</th>
              <th>Capabilities</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && accounts.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  Loading...
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📦</div>
                    <p className={styles.emptyText}>No providers configured yet</p>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowAddDialog(true)}>
                      + Add your first provider
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              accounts.map((acc) => (
                <tr key={acc.id}>
                  <td>
                    <div className={styles.nameCell}>
                      <span className={styles.nameIcon}>{TYPE_ICONS[acc.type] || '📦'}</span>
                      <span>{acc.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className={styles.typeBadge}>{TYPE_LABELS[acc.type] || acc.type}</span>
                  </td>
                  <td>
                    <code className={styles.apiBase}>
                      {acc.api_base.length > 35 ? acc.api_base.slice(0, 35) + '...' : acc.api_base}
                    </code>
                  </td>
                  <td>
                    <span className={styles.apiKeyMask}>{acc.api_key ? '•••' : '—'}</span>
                  </td>
                  <td>
                    <div className={styles.capChips}>
                      {acc.capabilities.map((cap) => (
                        <span key={cap} className={styles.capChip}>
                          {cap}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={acc.status} />
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={styles.iconBtn}
                        title="Test Connection"
                        onClick={() => handleTest(acc.id)}
                        disabled={testingId === acc.id}
                      >
                        {testingId === acc.id ? '⏳' : '🧪'}
                      </button>
                      <button
                        className={styles.iconBtn}
                        title={acc.status === 'enabled' ? 'Disable' : 'Enable'}
                        onClick={() => handleToggleStatus(acc.id, acc.status)}
                      >
                        {acc.status === 'enabled' ? '⏸' : '▶'}
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        title="Delete"
                        onClick={() => handleDelete(acc.id, acc.name)}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {pagination.total > 0 && (
          <div className={styles.tableFooter}>
            <span>{pagination.total} items</span>
            <div className={styles.pagination}>
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                className={styles.pageBtn}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹
              </button>
              <button
                className={styles.pageBtn}
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog onClose={() => setShowAddDialog(false)} onSave={handleAdd} />
      )}
    </DashboardLayout>
  )
}
