'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { checkHealth, getAuthConfig, logout, validateSession } from '@/lib/api'
import styles from './Sidebar.module.css'

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◈' },
  { href: '/orgs', label: 'Organizations', icon: '🏢' },
  { href: '/graph', label: 'Graph', icon: '⟡' },
  { href: '/knowledge', label: 'Knowledge', icon: '📚' },
  { href: '/memories', label: 'Memories', icon: '🧠' },
  { href: '/keys', label: 'API Keys', icon: '⚿' },
  { href: '/providers', label: 'LLM Providers', icon: '⬡' },
  { href: '/usage', label: 'Usage', icon: '📊' },
  { href: '/ops', label: 'Ops', icon: '⌁' },
  { href: '/quality', label: 'Quality', icon: '✦' },
  { href: '/sessions', label: 'Sessions', icon: '⇄' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const { data: health } = useSWR('health', checkHealth, { refreshInterval: 30000 })
  const { data: authConfig } = useSWR('sidebar-auth-config', getAuthConfig, { refreshInterval: 60000 })
  const { data: authSession, mutate: mutateAuthSession } = useSWR(
    authConfig?.enabled ? 'sidebar-auth-session' : null,
    validateSession,
    { refreshInterval: 30000 },
  )

  const commitShort = health?.commit && health.commit !== 'dev'
    ? health.commit.slice(0, 7)
    : 'dev'
  const isOnline = health?.status === 'ok' || health?.status === 'degraded'

  const closeSidebar = useCallback(() => setIsOpen(false), [])

  // Close sidebar on route change (mobile)
  useEffect(() => {
    closeSidebar()
  }, [pathname, closeSidebar])

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return

    setIsLoggingOut(true)
    try {
      await logout()
    } catch {
      // Even if the API call fails, clear the client cookie so the guard can re-authenticate.
    } finally {
      document.cookie = 'cortex_session=; path=/; max-age=0; samesite=lax'
      await mutateAuthSession({ valid: false }, false)
      setIsLoggingOut(false)
      window.location.reload()
    }
  }, [isLoggingOut, mutateAuthSession])

  return (
    <>
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        className={styles.hamburger}
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation"
      >
        <span className={styles.hamburgerBar} />
        <span className={styles.hamburgerBar} />
        <span className={styles.hamburgerBar} />
      </button>

      {/* Backdrop overlay — visible only when sidebar is open on mobile */}
      {isOpen && (
        <div
          className={styles.backdrop}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
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
                onClick={closeSidebar}
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
          {authConfig?.enabled && authSession?.valid && (
            <div className={styles.authPanel}>
              <div className={styles.authMeta}>
                <span className={styles.authLabel}>Signed in</span>
                <span className={styles.authEmail}>{authSession.email ?? 'Approved session'}</span>
              </div>
              <button
                className={styles.logoutButton}
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          )}

          <div className={styles.statusRow}>
            <span className={`status-dot ${isOnline ? 'healthy' : 'unhealthy'}`} />
            <span className={styles.statusText}>
              {!isOnline ? 'Connecting...' : health?.status === 'degraded' ? 'Core degraded' : 'All systems online'}
            </span>
          </div>
        <div className={styles.commitRow} title={`Version: v${health?.version ?? '0.0.0'}\nCommit: ${health?.commit ?? 'dev'}\nBuilt: ${health?.buildDate ?? 'N/A'}`}>
            <code className={styles.commitHash}>
              v{health?.version ?? '0.0.0'}{commitShort !== 'dev' ? ` · ${commitShort}` : ''}
            </code>
          </div>
        </div>
      </aside>
    </>
  )
}
