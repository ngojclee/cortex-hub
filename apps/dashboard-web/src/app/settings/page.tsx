'use client'

import { useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { getSettings, getAppSettings, updateAppSettings, restartService } from '@/lib/api'
import { config } from '@/lib/config'
import styles from './page.module.css'

// ── Types ──
type ServiceRowProps = {
  name: string
  url: string
  icon: string
}

type DockerServiceProps = {
  containerName: string
  label: string
  icon: string
}

// ── Components ──
function ServiceRow({ name, url, icon }: ServiceRowProps) {
  return (
    <div className={styles.serviceRow}>
      <span className={styles.serviceIcon}>{icon}</span>
      <div className={styles.serviceInfo}>
        <span className={styles.serviceName}>{name}</span>
        <code className={styles.serviceUrl}>{url}</code>
      </div>
      <span className={`badge badge-healthy`}>configured</span>
    </div>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmText: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [input, setInput] = useState('')
  const isConfirmed = input === 'CONFIRM'

  return (
    <div className={styles.dialogOverlay}>
      <div className={styles.dialog}>
        <h3 className={styles.dialogTitle}>{title}</h3>
        <p className={styles.dialogMessage}>{message}</p>
        <div className={styles.dialogInput}>
          <label className={styles.dialogLabel}>
            Type <strong>CONFIRM</strong> to proceed:
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={styles.confirmInput}
            placeholder="CONFIRM"
            autoFocus
          />
        </div>
        <div className={styles.dialogActions}>
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={!isConfirmed}
            style={{
              background: isConfirmed ? 'var(--danger)' : undefined,
              borderColor: isConfirmed ? 'var(--danger)' : undefined,
              opacity: isConfirmed ? 1 : 0.5,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

const SERVICE_ICONS: Record<string, string> = {
  cliproxy: '🤖',
  qdrant: '🔮',
  gitnexus: '🧬',
  dashboardApi: '📡',
}

const SERVICE_LABELS: Record<string, string> = {
  cliproxy: 'CLIProxy (LLM Gateway)',
  qdrant: 'Qdrant Vector DB',
  gitnexus: 'GitNexus (Code Intelligence)',
  dashboardApi: 'Dashboard API',
}

export default function SettingsPage() {
  const { data, error, isLoading } = useSWR('settings', getSettings)
  const { data: appSettings, mutate: mutateAppSettings } = useSWR('app-settings', getAppSettings)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [restartingService, setRestartingService] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Git credentials state
  const [gitUsername, setGitUsername] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [gitDirty, setGitDirty] = useState(false)
  const [gitSaving, setGitSaving] = useState(false)

  // Sync from fetched app settings
  const gitLoaded = useState(false)
  if (appSettings && !gitLoaded[0]) {
    if (appSettings.global_git_username) setGitUsername(appSettings.global_git_username)
    if (appSettings.global_git_token) setGitToken(appSettings.global_git_token)
    gitLoaded[1](true)
  }

  const dockerServices: DockerServiceProps[] = [
    { containerName: 'cortex-llm-proxy', label: 'CLIProxy (LLM)', icon: '🤖' },
    { containerName: 'cortex-qdrant', label: 'Qdrant Vector DB', icon: '🔮' },
    { containerName: 'cortex-gitnexus', label: 'GitNexus (Code Intelligence)', icon: '🧬' },
  ]
  const dashboardUrl = typeof window !== 'undefined' ? window.location.origin : config.api.base
  const endpointLinks = [
    { label: 'Dashboard', url: dashboardUrl },
    { label: 'API', url: config.api.base },
    { label: 'MCP', url: config.mcp.base },
    { label: 'LLM Proxy', url: config.services.cliproxy },
  ]
  const mcpConfigSnippet = `{
  "mcpServers": {
    "cortex-hub": {
      "url": "${config.mcp.endpoint}",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}`

  async function handleRestart(containerName: string) {
    setRestartingService(containerName)
    try {
      const result = await restartService(containerName)
      setActionStatus({ type: 'success', message: result.message })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Restart failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setRestartingService(null)
    }
  }

  async function handleResetSetup() {
    setShowResetDialog(false)
    try {
      const res = await fetch(`${config.api.base}/api/setup/reset`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error('Reset failed')
      localStorage.removeItem('cortex_setup_completed')
      setActionStatus({ type: 'success', message: 'Setup reset. Redirecting to setup wizard...' })
      setTimeout(() => (window.location.href = '/setup'), 1500)
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: `Reset failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    }
  }

  async function handleClearData() {
    setShowClearDialog(false)
    try {
      const res = await fetch(`${config.api.base}/api/setup/clear-data`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw new Error('Clear data failed')
      setActionStatus({ type: 'success', message: 'All data cleared successfully.' })
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: `Clear failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    }
  }

  async function handleSaveGitCredentials() {
    setGitSaving(true)
    try {
      await updateAppSettings({
        global_git_username: gitUsername || null,
        global_git_token: gitToken || null,
      })
      setGitDirty(false)
      mutateAppSettings()
      setActionStatus({ type: 'success', message: 'Global Git credentials saved.' })
    } catch (err) {
      setActionStatus({ type: 'error', message: `Save failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setGitSaving(false)
    }
  }

  return (
    <DashboardLayout title="Settings" subtitle="Runtime configuration and service endpoints">
      {/* Action Status Toast */}
      {actionStatus && (
        <div
          className={styles.toast}
          style={{
            borderColor:
              actionStatus.type === 'success' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          <span>
            {actionStatus.type === 'success' ? '✅' : '❌'} {actionStatus.message}
          </span>
          <button
            className={styles.toastClose}
            onClick={() => setActionStatus(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Environment Info */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Environment</h2>
        <div className={`card ${styles.envCard}`}>
          <div className={styles.envGrid}>
            <div className={styles.envItem}>
              <span className={styles.envLabel}>Mode</span>
              <span
                className={`badge ${data?.environment === 'production' ? 'badge-healthy' : 'badge-warning'}`}
              >
                {isLoading ? '...' : data?.environment ?? 'unknown'}
              </span>
            </div>
            <div className={styles.envItem}>
              <span className={styles.envLabel}>Version</span>
              <code className={styles.envValue}>{data?.version ?? '...'}</code>
            </div>
            <div className={styles.envItem}>
              <span className={styles.envLabel}>Database</span>
              <code className={styles.envValue}>{data?.database ?? '...'}</code>
            </div>
          </div>
        </div>
      </div>

      {/* Tunnel & Endpoints */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Cloudflare Tunnel</h2>
        <div className={`card ${styles.tunnelCard}`}>
          <div className={styles.tunnelGrid}>
            {endpointLinks.map((endpoint) => (
              <div key={endpoint.label} className={styles.tunnelItem}>
                <span className={styles.tunnelLabel}>{endpoint.label}</span>
                <a
                  href={endpoint.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.tunnelLink}
                >
                  {endpoint.url}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Service Endpoints */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Service Endpoints</h2>
        <div className={`card ${styles.servicesCard}`}>
          {error && (
            <div className={styles.errorBanner}>
              ⚠️ Failed to load settings. Is the API running?
            </div>
          )}
          {isLoading && !data ? (
            <div className={styles.loading}>Loading configuration…</div>
          ) : data?.services ? (
            Object.entries(data.services).map(([key, url]) => (
              <ServiceRow
                key={key}
                name={SERVICE_LABELS[key] ?? key}
                url={url}
                icon={SERVICE_ICONS[key] ?? '📦'}
              />
            ))
          ) : null}
        </div>
      </div>

      {/* Docker Services */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Docker Services</h2>
        <div className={`card ${styles.servicesCard}`}>
          {dockerServices.map((svc) => (
            <div key={svc.containerName} className={styles.serviceRow}>
              <span className={styles.serviceIcon}>{svc.icon}</span>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>{svc.label}</span>
                <code className={styles.serviceUrl}>{svc.containerName}</code>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleRestart(svc.containerName)}
                disabled={restartingService === svc.containerName}
              >
                {restartingService === svc.containerName ? '⏳ Restarting...' : '🔄 Restart'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Git Credentials */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Global Git Credentials</h2>
        <div className={`card ${styles.gitCard}`}>
          <p className={styles.gitHint}>
            Fallback credentials used when a project has no token configured. Required for indexing private repositories.
          </p>
          <div className={styles.gitFields}>
            <div className={styles.gitField}>
              <label className={styles.gitLabel}>Username (optional)</label>
              <input
                className={styles.gitInput}
                type="text"
                placeholder="github-username"
                value={gitUsername}
                onChange={(e) => { setGitUsername(e.target.value); setGitDirty(true) }}
              />
            </div>
            <div className={styles.gitField}>
              <label className={styles.gitLabel}>Personal Access Token</label>
              <input
                className={styles.gitInput}
                type="password"
                placeholder="ghp_xxxx"
                value={gitToken}
                onChange={(e) => { setGitToken(e.target.value); setGitDirty(true) }}
              />
            </div>
          </div>
          <div className={styles.gitActions}>
            <span className={styles.gitStatus}>
              {appSettings?.global_git_token ? 'Token configured' : 'No token set'}
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveGitCredentials}
              disabled={!gitDirty || gitSaving}
            >
              {gitSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* MCP Connection */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>MCP Agent Config</h2>
        <div className={`card ${styles.codeCard}`}>
          <p className={styles.codeHint}>
            Copy this snippet into your AI agent&apos;s MCP client configuration:
          </p>
          <pre className={styles.codeBlock}>
{mcpConfigSnippet}
          </pre>
        </div>
      </div>

      {/* Danger Zone */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle} style={{ color: 'var(--danger)' }}>
          ⚠️ Danger Zone
        </h2>
        <div className={`card ${styles.dangerCard}`}>
          <div className={styles.dangerRow}>
            <div className={styles.dangerInfo}>
              <h4 className={styles.dangerLabel}>Reset Setup Wizard</h4>
              <p className={styles.dangerDesc}>
                Go back through the setup wizard to reconfigure your LLM provider.
                Your API keys and data are preserved.
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowResetDialog(true)}
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              Reset Setup
            </button>
          </div>
          <div className={styles.dangerRow}>
            <div className={styles.dangerInfo}>
              <h4 className={styles.dangerLabel}>Clear All Data</h4>
              <p className={styles.dangerDesc}>
                Delete all quality logs, session handoffs, and cached data.
                API keys and provider configuration are kept.
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowClearDialog(true)}
              style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              Clear Data
            </button>
          </div>
        </div>
      </div>

      {/* About */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>About</h2>
        <div className={`card ${styles.aboutCard}`}>
          <div className={styles.aboutBrand}>
            <span className={styles.aboutLogo}>◇</span>
            <div>
              <h3 className={styles.aboutName}>Cortex Hub</h3>
              <span className={styles.aboutVersion}>
                v{data?.version ?? '0.1.0'} · Self-hosted MCP Intelligence Platform
              </span>
            </div>
          </div>
          <div className={styles.aboutLinks}>
            <a href="https://github.com/ngojclee/cortex-hub" target="_blank" rel="noreferrer" className={styles.aboutLink}>
              GitHub
            </a>
            <a href="/docs" className={styles.aboutLink}>
              Documentation
            </a>
            <a href={dashboardUrl} className={styles.aboutLink}>
              Dashboard
            </a>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showResetDialog && (
        <ConfirmDialog
          title="Reset Setup Wizard"
          message="This will reset the setup wizard so you can reconfigure your LLM provider. Your API keys and data will be preserved."
          confirmText="Reset Setup"
          onConfirm={handleResetSetup}
          onCancel={() => setShowResetDialog(false)}
        />
      )}
      {showClearDialog && (
        <ConfirmDialog
          title="Clear All Data"
          message="This will permanently delete all quality logs, session handoffs, and cached data. This action cannot be undone."
          confirmText="Clear All Data"
          onConfirm={handleClearData}
          onCancel={() => setShowClearDialog(false)}
        />
      )}
    </DashboardLayout>
  )
}
