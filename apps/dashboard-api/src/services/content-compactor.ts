export type CompactionMode = 'technical_full' | 'technical_ultra' | 'wenyan_experimental'
export type ContentMode = 'compact' | 'raw'

export interface CompressionMetadata {
  mode: CompactionMode | 'raw'
  ratio: number
  version: string
  model: string
  createdAt: string
  rawChars: number
  compactChars: number
  preservedTokens: string[]
  valid: boolean
  warnings: string[]
}

export interface ContentContract {
  raw_content: string
  compact_content: string
  facts: string[]
  embedding_text: string
  compression: CompressionMetadata
}

export interface CompactionOptions {
  enabled?: boolean
  mode?: CompactionMode
  createdAt?: string
}

const COMPACTOR_VERSION = 'content-compactor-v1'
const COMPACTOR_MODEL = 'deterministic-technical-v1'
const DEFAULT_MODE: CompactionMode = 'technical_full'
const MAX_PRESERVED_TOKENS = 80
const COMMAND_PATTERN = /(?:^|\n)\s*(?:[$>]\s*)?(?:pnpm|npm|npx|yarn|node|tsx|tsc|git|docker|docker-compose|curl|wget|python|python3|pip|pytest|turbo|rtk)\b[^\n]*/gi
const URL_PATTERN = /https?:\/\/[^\s)\]}>,"']+/gi
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s`'"<>|]+/g
const POSIX_PATH_PATTERN = /(?:^|[\s(])((?:\.{1,2}\/|\/)?[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+){1,})/g
const VERSION_NUMBER_PATTERN = /\b[vV]?\d+(?:\.\d+){1,4}(?:[-+][A-Za-z0-9_.-]+)?\b|\b\d+(?:\.\d+)?%?\b/g
const IDENTIFIER_PATTERN = /\b[A-Za-z_$][\w$]*(?:[.#:][A-Za-z_$][\w$]*|_[A-Za-z0-9]+){1,}\b/g
const INLINE_CODE_PATTERN = /`([^`\n]{1,240})`/g
const FENCE_PATTERN = /```[\s\S]*?```/g

export function isContentCompactionEnabled(): boolean {
  const raw = process.env['CONTENT_COMPACTION_ENABLED'] ?? process.env['CORTEX_CONTENT_COMPACTION_ENABLED'] ?? 'false'
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

export function resolveCompactionMode(value: unknown): CompactionMode {
  if (value === 'technical_ultra' || value === 'wenyan_experimental' || value === 'technical_full') {
    return value
  }
  const envMode = process.env['CONTENT_COMPACTION_MODE'] ?? process.env['CORTEX_CONTENT_COMPACTION_MODE']
  if (envMode === 'technical_ultra' || envMode === 'wenyan_experimental' || envMode === 'technical_full') {
    return envMode
  }
  return DEFAULT_MODE
}

export function normalizeContentMode(value: unknown): ContentMode {
  return value === 'raw' ? 'raw' : 'compact'
}

export function buildContentContract(content: string, options: CompactionOptions = {}): ContentContract {
  const enabled = options.enabled ?? isContentCompactionEnabled()
  const mode: CompactionMode | 'raw' = enabled ? options.mode ?? DEFAULT_MODE : 'raw'
  const createdAt = options.createdAt ?? new Date().toISOString()
  const rawContent = normalizeWhitespace(content)
  const preservedTokens = extractPreservedTokens(rawContent)

  if (!enabled) {
    return {
      raw_content: content,
      compact_content: content,
      facts: extractFacts(rawContent, 6),
      embedding_text: content,
      compression: {
        mode,
        ratio: 1,
        version: COMPACTOR_VERSION,
        model: 'none',
        createdAt,
        rawChars: content.length,
        compactChars: content.length,
        preservedTokens,
        valid: true,
        warnings: ['compaction disabled; raw content used for compact and embedding text'],
      },
    }
  }

  const activeMode: CompactionMode = options.mode ?? DEFAULT_MODE
  const facts = extractFacts(rawContent, activeMode === 'technical_full' ? 8 : 5)
  const compactBody = compactTechnical(rawContent, facts, activeMode)
  const { text: compactWithTokens, missingTokens } = ensurePreservedTokens(compactBody, preservedTokens)
  const warnings = missingTokens.length > 0
    ? [`appended ${missingTokens.length} preserved token(s) that compaction omitted`]
    : []

  if (mode === 'wenyan_experimental') {
    warnings.push('wenyan_experimental is opt-in; deterministic technical fallback is used until retrieval quality is benchmarked')
  }

  const compactContent = compactWithTokens.trim()

  return {
    raw_content: content,
    compact_content: compactContent,
    facts,
    embedding_text: facts.length > 0 ? `${facts.join('\n')}\n${compactContent}`.trim() : compactContent,
    compression: {
      mode,
      ratio: safeRatio(content.length, compactContent.length),
      version: COMPACTOR_VERSION,
      model: COMPACTOR_MODEL,
      createdAt,
      rawChars: content.length,
      compactChars: compactContent.length,
      preservedTokens,
      valid: missingTokens.every((token) => compactContent.includes(token)),
      warnings,
    },
  }
}

export function selectContentForCaller(
  payload: ContentContract | Record<string, unknown>,
  options: { includeRaw?: boolean; contentMode?: ContentMode; fallbackKey?: 'memory' | 'content' } = {},
): Record<string, unknown> {
  const payloadRecord = payload as Record<string, unknown>
  const fallbackKey = options.fallbackKey ?? 'content'
  const rawContent = asString(payloadRecord['raw_content']) ?? asString(payloadRecord[fallbackKey]) ?? ''
  const compactContent = asString(payloadRecord['compact_content']) ?? rawContent
  const wantsRaw = options.includeRaw || options.contentMode === 'raw'
  const selectedContent = wantsRaw ? rawContent : compactContent
  const compression = asRecord(payloadRecord['compression'])

  return {
    content: selectedContent,
    contentMode: wantsRaw ? 'raw' : compression ? 'compact' : 'raw',
    ...(fallbackKey === 'memory' ? { memory: selectedContent } : {}),
    ...(options.includeRaw ? { raw_content: rawContent } : {}),
    ...(compression ? { compact_content: compactContent, compression } : {}),
    ...(Array.isArray(payloadRecord['facts']) ? { facts: payloadRecord['facts'] } : {}),
  }
}

function compactTechnical(content: string, facts: string[], mode: CompactionMode): string {
  const maxChars = mode === 'technical_full' ? 4000 : 1800
  const sections: string[] = []

  if (facts.length > 0) {
    sections.push(`Facts:\n${facts.map((fact) => `- ${fact}`).join('\n')}`)
  }

  const codeFences = content.match(FENCE_PATTERN) ?? []
  if (codeFences.length > 0) {
    sections.push(`Code:\n${codeFences.slice(0, 3).join('\n')}`)
  }

  const commands = uniqueMatches(content.match(COMMAND_PATTERN) ?? [])
  if (commands.length > 0) {
    sections.push(`Commands:\n${commands.slice(0, 10).join('\n')}`)
  }

  const remaining = maxChars - sections.join('\n\n').length
  if (remaining > 300) {
    sections.push(`Context:\n${shorten(content, remaining)}`)
  }

  return shorten(sections.join('\n\n'), maxChars)
}

function extractFacts(content: string, maxFacts: number): string[] {
  const candidates = content
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => cleanupSentence(part))
    .filter((part) => part.length >= 12)

  const scored = candidates.map((text, index) => ({ text, index, score: scoreFact(text) }))
  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const selected = uniqueMatches(scored.map((item) => item.text)).slice(0, maxFacts)
  if (selected.length > 0) return selected

  return content ? [shorten(content, 240)] : []
}

function scoreFact(text: string): number {
  let score = 0
  if (/\b(decision|fix|fixed|bug|error|root cause|endpoint|schema|contract|route|api|migration|deploy|auth|token|preserve|fallback)\b/i.test(text)) score += 4
  if (URL_PATTERN.test(text) || WINDOWS_PATH_PATTERN.test(text) || IDENTIFIER_PATTERN.test(text)) score += 3
  if (VERSION_NUMBER_PATTERN.test(text)) score += 2
  if (/^[#*-]/.test(text)) score += 1
  URL_PATTERN.lastIndex = 0
  WINDOWS_PATH_PATTERN.lastIndex = 0
  IDENTIFIER_PATTERN.lastIndex = 0
  VERSION_NUMBER_PATTERN.lastIndex = 0
  return score
}

function extractPreservedTokens(content: string): string[] {
  const tokens: string[] = []
  collectRegexGroup(content, FENCE_PATTERN, tokens)
  collectRegexGroup(content, INLINE_CODE_PATTERN, tokens, 1)
  collectRegexGroup(content, URL_PATTERN, tokens)
  collectRegexGroup(content, WINDOWS_PATH_PATTERN, tokens)
  collectRegexGroup(content, POSIX_PATH_PATTERN, tokens, 1)
  collectRegexGroup(content, COMMAND_PATTERN, tokens)
  collectRegexGroup(content, IDENTIFIER_PATTERN, tokens)
  collectRegexGroup(content, VERSION_NUMBER_PATTERN, tokens)
  return uniqueMatches(tokens.map((token) => token.trim()).filter(Boolean)).slice(0, MAX_PRESERVED_TOKENS)
}

function collectRegexGroup(content: string, regex: RegExp, target: string[], group = 0): void {
  regex.lastIndex = 0
  for (const match of content.matchAll(regex)) {
    const value = match[group]
    if (value) target.push(value)
  }
  regex.lastIndex = 0
}

function ensurePreservedTokens(text: string, tokens: string[]): { text: string; missingTokens: string[] } {
  const missingTokens = tokens.filter((token) => !text.includes(token))
  if (missingTokens.length === 0) return { text, missingTokens }
  return {
    text: `${text}\n\nPreserved tokens: ${missingTokens.join(', ')}`,
    missingTokens,
  }
}

function cleanupSentence(value: string): string {
  return value
    .replace(/^[-*#>\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim()
}

function shorten(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const trimmed = value.slice(0, Math.max(0, maxChars - 20))
  const boundary = Math.max(trimmed.lastIndexOf('\n'), trimmed.lastIndexOf('. '), trimmed.lastIndexOf('; '))
  return `${trimmed.slice(0, boundary > maxChars * 0.6 ? boundary + 1 : trimmed.length).trim()}...`
}

function safeRatio(rawChars: number, compactChars: number): number {
  if (rawChars <= 0) return 1
  return Number((compactChars / rawChars).toFixed(4))
}

function uniqueMatches(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
