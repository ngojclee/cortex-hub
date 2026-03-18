import DashboardLayout from '@/components/layout/DashboardLayout'
import styles from './page.module.css'

interface ServiceCardProps {
  name: string
  status: 'healthy' | 'warning' | 'error' | 'unknown'
  description: string
  endpoint: string
}

function ServiceCard({ name, status, description, endpoint }: ServiceCardProps) {
  return (
    <div className={`card ${styles.serviceCard}`}>
      <div className={styles.serviceHeader}>
        <span className={`status-dot ${status}`} />
        <h3 className={styles.serviceName}>{name}</h3>
        <span className={`badge badge-${status === 'unknown' ? 'warning' : status}`}>
          {status}
        </span>
      </div>
      <p className={styles.serviceDesc}>{description}</p>
      <code className={styles.serviceEndpoint}>{endpoint}</code>
    </div>
  )
}

const services: ServiceCardProps[] = [
  {
    name: 'MCP Gateway',
    status: 'healthy',
    description: 'Cloudflare Worker — MCP protocol endpoint',
    endpoint: 'mcp.hub.jackle.dev',
  },
  {
    name: 'Qdrant',
    status: 'healthy',
    description: 'Vector database — semantic search',
    endpoint: 'qdrant.hub.jackle.dev',
  },
  {
    name: 'Neo4j',
    status: 'healthy',
    description: 'Graph database — knowledge relationships',
    endpoint: 'neo4j.hub.jackle.dev',
  },
  {
    name: 'CLIProxy',
    status: 'healthy',
    description: 'LLM gateway — OAuth proxy to AI providers',
    endpoint: 'llm.hub.jackle.dev',
  },
]

const stats = [
  { label: 'MCP Tools', value: '3', icon: '⚡' },
  { label: 'Active Keys', value: '0', icon: '⚿' },
  { label: 'Memories', value: '—', icon: '🧠' },
  { label: 'Uptime', value: '99.9%', icon: '◈' },
]

export default function DashboardPage() {
  return (
    <DashboardLayout title="Dashboard" subtitle="System overview and service health">
      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        {stats.map((stat) => (
          <div key={stat.label} className={`card ${styles.statCard}`}>
            <span className={styles.statIcon}>{stat.icon}</span>
            <div>
              <div className={styles.statValue}>{stat.value}</div>
              <div className={styles.statLabel}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Services */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Services</h2>
        <div className={styles.servicesGrid}>
          {services.map((svc) => (
            <ServiceCard key={svc.name} {...svc} />
          ))}
        </div>
      </section>

      {/* Quick Connect */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick Connect</h2>
        <div className={`card ${styles.connectCard}`}>
          <p className={styles.connectText}>
            Add Cortex Hub to your AI agent's MCP config:
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
          <a href="/keys" className="btn btn-primary btn-sm" style={{ marginTop: 'var(--space-4)', display: 'inline-flex' }}>
            Generate API Key →
          </a>
        </div>
      </section>
    </DashboardLayout>
  )
}
