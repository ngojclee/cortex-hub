'use client'

import DashboardLayout from '@/components/layout/DashboardLayout'
import useSWR from 'swr'
import { getSettings } from '@/lib/api'
import styles from './page.module.css'

interface ServiceRowProps {
  name: string
  url: string
  icon: string
}

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

const serviceIcons: Record<string, string> = {
  cliproxy: '🤖',
  qdrant: '🔮',
  neo4j: '🕸️',
  mem0: '🧠',
  dashboardApi: '📡',
}

const serviceLabels: Record<string, string> = {
  cliproxy: 'CLIProxy (LLM Gateway)',
  qdrant: 'Qdrant Vector DB',
  neo4j: 'Neo4j Graph DB',
  mem0: 'mem0 Memory Service',
  dashboardApi: 'Dashboard API',
}

export default function SettingsPage() {
  const { data, error, isLoading } = useSWR('settings', getSettings)

  return (
    <DashboardLayout title="Settings" subtitle="Runtime configuration and service endpoints">
      {/* Environment Info */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Environment</h2>
        <div className={`card ${styles.envCard}`}>
          <div className={styles.envGrid}>
            <div className={styles.envItem}>
              <span className={styles.envLabel}>Mode</span>
              <span className={`badge ${data?.environment === 'production' ? 'badge-healthy' : 'badge-warning'}`}>
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
                name={serviceLabels[key] ?? key}
                url={url}
                icon={serviceIcons[key] ?? '📦'}
              />
            ))
          ) : null}
        </div>
      </div>

      {/* MCP Connection */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>MCP Agent Config</h2>
        <div className={`card ${styles.codeCard}`}>
          <p className={styles.codeHint}>
            Copy this snippet into your AI agent's MCP client configuration:
          </p>
          <pre className={styles.codeBlock}>
{`{
  "mcpServers": {
    "cortex-hub": {
      "url": "https://mcp.hub.jackle.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}`}
          </pre>
        </div>
      </div>
    </DashboardLayout>
  )
}
