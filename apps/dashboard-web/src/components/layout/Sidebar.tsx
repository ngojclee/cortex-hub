'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { checkHealth } from '@/lib/api'
import styles from './Sidebar.module.css'

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◈' },
  { href: '/orgs', label: 'Organizations', icon: '🏢' },
  { href: '/keys', label: 'API Keys', icon: '⚿' },
  { href: '/providers', label: 'LLM Providers', icon: '⬡' },
  { href: '/usage', label: 'Usage', icon: '📊' },
  { href: '/quality', label: 'Quality', icon: '✦' },
  { href: '/sessions', label: 'Sessions', icon: '⇄' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: health } = useSWR('health', checkHealth, { refreshInterval: 30000 })

  const commitShort = health?.commit && health.commit !== 'dev'
    ? health.commit.slice(0, 7)
    : 'dev'
  const isOnline = health?.status === 'ok' || health?.status === 'degraded'

  return (
    <aside className={styles.sidebar}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>◇</span>
          <span className={styles.logoText}>Cortex Hub</span>
        </div>
        <span className={styles.version}>v{health?.version ?? '0.1'}</span>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
              {isActive && <span className={styles.activeIndicator} />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.statusRow}>
          <span className={`status-dot ${isOnline ? 'healthy' : 'unhealthy'}`} />
          <span className={styles.statusText}>
            {isOnline ? 'All systems online' : 'Connecting...'}
          </span>
        </div>
        {commitShort !== 'dev' && (
          <div className={styles.commitRow} title={`Commit: ${health?.commit}\nBuilt: ${health?.buildDate ?? 'unknown'}`}>
            <code className={styles.commitHash}>{commitShort}</code>
          </div>
        )}
      </div>
    </aside>
  )
}
