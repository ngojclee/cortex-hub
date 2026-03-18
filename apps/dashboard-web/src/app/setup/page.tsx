'use client'

import { useState } from 'react'
import styles from './page.module.css'

type Step = 'provider' | 'auth' | 'models' | 'complete'

const providers = [
  { id: 'openai', name: 'OpenAI', desc: 'GPT-4o, o3, embeddings', icon: '🤖' },
  { id: 'gemini', name: 'Google Gemini', desc: 'Gemini 2.5 Pro, Flash', icon: '✨' },
  { id: 'claude', name: 'Anthropic Claude', desc: 'Claude 4, Sonnet', icon: '🎭' },
  { id: 'custom', name: 'Custom Provider', desc: 'Any OpenAI-compatible API', icon: '⚙️' },
]

const modelsByProvider: Record<string, { id: string; name: string; type: string }[]> = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', type: 'chat' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', type: 'chat' },
    { id: 'o3', name: 'o3', type: 'reasoning' },
    { id: 'text-embedding-3-small', name: 'Embedding 3 Small', type: 'embedding' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', type: 'chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', type: 'chat' },
  ],
  claude: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', type: 'chat' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', type: 'chat' },
  ],
  custom: [],
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>('provider')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle')

  function handleProviderSelect(id: string) {
    setSelectedProvider(id)
    setSelectedModels([])
    setTestResult('idle')
  }

  function toggleModel(id: string) {
    setSelectedModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  async function handleTestConnection() {
    setTesting(true)
    // Simulate connection test
    await new Promise((r) => setTimeout(r, 1500))
    setTestResult('success')
    setTesting(false)
  }

  const stepIndex = ['provider', 'auth', 'models', 'complete'].indexOf(step)

  return (
    <div className={styles.wizard}>
      {/* Progress */}
      <div className={styles.progress}>
        {['Provider', 'Connect', 'Models', 'Done'].map((label, i) => (
          <div key={label} className={`${styles.progressStep} ${i <= stepIndex ? styles.progressActive : ''}`}>
            <div className={styles.progressDot}>
              {i < stepIndex ? '✓' : i + 1}
            </div>
            <span className={styles.progressLabel}>{label}</span>
          </div>
        ))}
      </div>

      {/* Step: Provider Selection */}
      {step === 'provider' && (
        <div className={styles.stepContent}>
          <h1 className={styles.stepTitle}>Welcome to Cortex Hub</h1>
          <p className={styles.stepSubtitle}>Choose your AI provider to get started</p>

          <div className={styles.providerGrid}>
            {providers.map((p) => (
              <button
                key={p.id}
                className={`${styles.providerCard} ${selectedProvider === p.id ? styles.providerSelected : ''}`}
                onClick={() => handleProviderSelect(p.id)}
              >
                <span className={styles.providerIcon}>{p.icon}</span>
                <div className={styles.providerName}>{p.name}</div>
                <div className={styles.providerDesc}>{p.desc}</div>
              </button>
            ))}
          </div>

          <button
            className="btn btn-primary btn-lg"
            disabled={!selectedProvider}
            onClick={() => setStep('auth')}
            style={{ marginTop: 'var(--space-6)', width: '100%' }}
          >
            Continue →
          </button>
        </div>
      )}

      {/* Step: OAuth */}
      {step === 'auth' && (
        <div className={styles.stepContent}>
          <h1 className={styles.stepTitle}>Connect {providers.find((p) => p.id === selectedProvider)?.name}</h1>
          <p className={styles.stepSubtitle}>
            Authenticate via OAuth — no API key needed
          </p>

          <div className={`card ${styles.authCard}`}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-4)' }}>
              You'll be redirected to your provider's login page.
              Cortex Hub uses CLIProxy to securely route requests through your existing subscription.
            </p>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => setStep('models')}
              style={{ width: '100%' }}
            >
              🔐 Authenticate with {providers.find((p) => p.id === selectedProvider)?.name}
            </button>
          </div>

          <button className="btn btn-ghost" onClick={() => setStep('provider')} style={{ marginTop: 'var(--space-4)' }}>
            ← Back
          </button>
        </div>
      )}

      {/* Step: Model Selection */}
      {step === 'models' && (
        <div className={styles.stepContent}>
          <h1 className={styles.stepTitle}>Select Models</h1>
          <p className={styles.stepSubtitle}>Choose which models to enable</p>

          <div className={styles.modelList}>
            {(modelsByProvider[selectedProvider] ?? []).map((model) => (
              <label key={model.id} className={styles.modelItem}>
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model.id)}
                  onChange={() => toggleModel(model.id)}
                  className={styles.modelCheck}
                />
                <div className={styles.modelInfo}>
                  <span className={styles.modelName}>{model.name}</span>
                  <span className={`badge badge-healthy`}>{model.type}</span>
                </div>
                <code className={styles.modelId}>{model.id}</code>
              </label>
            ))}
            {(modelsByProvider[selectedProvider] ?? []).length === 0 && (
              <div className={`card`} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Custom provider — models will be detected after connection.
                </p>
              </div>
            )}
          </div>

          {/* Test Connection */}
          <div className={styles.testSection}>
            <button
              className="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? '⏳ Testing...' : '🧪 Test Connection'}
            </button>
            {testResult === 'success' && (
              <span className={styles.testSuccess}>✓ Connection verified</span>
            )}
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={() => setStep('complete')}
            style={{ marginTop: 'var(--space-6)', width: '100%' }}
          >
            Complete Setup →
          </button>

          <button className="btn btn-ghost" onClick={() => setStep('auth')} style={{ marginTop: 'var(--space-4)' }}>
            ← Back
          </button>
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && (
        <div className={styles.stepContent} style={{ textAlign: 'center' }}>
          <div className={styles.completeIcon}>✅</div>
          <h1 className={styles.stepTitle}>You're All Set!</h1>
          <p className={styles.stepSubtitle}>
            Cortex Hub is ready. Head to the dashboard to explore.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-8)', justifyContent: 'center' }}>
            <a href="/" className="btn btn-primary btn-lg">
              Open Dashboard →
            </a>
            <a href="/keys" className="btn btn-secondary btn-lg">
              Generate API Key
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
