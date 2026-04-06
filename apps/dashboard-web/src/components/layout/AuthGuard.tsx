'use client'

import { useEffect, useState, useCallback } from 'react'
import { getAuthConfig, requestAccess, getAuthStatus, validateSession } from '@/lib/api'
import styles from './AuthGuard.module.css'

type AuthState = 'loading' | 'disabled' | 'authenticated' | 'login' | 'pending' | 'denied' | 'error'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')
  const [email, setEmail] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Check if auth is enabled and if user has a valid session
  useEffect(() => {
    async function init() {
      try {
        const config = await getAuthConfig()
        if (!config.enabled) {
          setState('disabled')
          return
        }

        // Check existing session cookie
        const session = await validateSession().catch(() => ({ valid: false }))
        if (session.valid) {
          setState('authenticated')
        } else {
          setState('login')
        }
      } catch {
        // If auth config fails, assume disabled (backward compat)
        setState('disabled')
      }
    }
    init()
  }, [])

  // Poll for approval
  useEffect(() => {
    if (state !== 'pending' || !requestId) return

    const interval = setInterval(async () => {
      try {
        const result = await getAuthStatus(requestId)
        if (result.status === 'approved' && result.sessionToken) {
          // Set session cookie (7 days)
          document.cookie = `cortex_session=${result.sessionToken}; path=/; max-age=${7 * 24 * 3600}; samesite=lax`
          setState('authenticated')
        } else if (result.status === 'denied') {
          setState('denied')
          setError(result.reason === 'expired' ? 'Request expired. Please try again.' : 'Access denied.')
        }
      } catch {
        // Keep polling
      }
    }, 2000)

    // Auto-stop after 10 min
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setState('denied')
      setError('Request expired. Please try again.')
    }, 10 * 60 * 1000)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [state, requestId])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const result = await requestAccess(email.trim())
      setRequestId(result.requestId)
      setState('pending')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request')
    } finally {
      setSubmitting(false)
    }
  }, [email, submitting])

  // Auth disabled → pass through
  if (state === 'loading') {
    return (
      <div className={styles.container}>
        <div className={styles.spinner} />
        <span className={styles.loadingText}>Checking authentication...</span>
      </div>
    )
  }

  if (state === 'disabled' || state === 'authenticated') {
    return <>{children}</>
  }

  // Login / Pending / Denied states
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>◇</div>
        <h1 className={styles.title}>Cortex Hub</h1>
        <p className={styles.subtitle}>Self-hosted AI Agent Intelligence Platform</p>

        {state === 'login' && (
          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label}>Enter your email to request access</label>
            <input
              type="email"
              className={styles.input}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
            <button type="submit" className={styles.button} disabled={submitting || !email.trim()}>
              {submitting ? 'Sending...' : 'Request Access'}
            </button>
          </form>
        )}

        {state === 'pending' && (
          <div className={styles.pendingBox}>
            <div className={styles.pendingIcon}>
              <div className={styles.spinner} />
            </div>
            <p className={styles.pendingText}>
              Approval request sent to admin via Telegram.
            </p>
            <p className={styles.pendingHint}>
              Waiting for approval... This page will update automatically.
            </p>
          </div>
        )}

        {(state === 'denied' || state === 'error') && (
          <div className={styles.deniedBox}>
            <p className={styles.deniedText}>{error || 'Access denied.'}</p>
            <button
              className={styles.retryButton}
              onClick={() => { setState('login'); setError(null); setRequestId(null) }}
            >
              Try Again
            </button>
          </div>
        )}

        {error && state === 'login' && (
          <p className={styles.errorText}>{error}</p>
        )}
      </div>
    </div>
  )
}
