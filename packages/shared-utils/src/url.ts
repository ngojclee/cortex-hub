export interface NormalizeCortexBaseUrlOptions {
  defaultPort?: number | string
  stripMcpPath?: boolean
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) return true
  if (/^127\./.test(host) || /^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true

  const match = host.match(/^172\.(\d+)\./)
  if (match?.[1]) {
    const secondOctet = Number(match[1])
    return secondOctet >= 16 && secondOctet <= 31
  }

  return false
}

function hasProtocol(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function normalizePort(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  const port = String(value).trim()
  return port.length > 0 ? port : undefined
}

export function normalizeCortexBaseUrl(
  value: string | null | undefined,
  options: NormalizeCortexBaseUrlOptions = {},
): string | undefined {
  const raw = value?.trim().replace(/\/+$/, '')
  if (!raw) return undefined

  const withProtocol = hasProtocol(raw) ? raw : `https://${raw}`
  let url: URL

  try {
    url = new URL(withProtocol)
  } catch {
    return undefined
  }

  if (!hasProtocol(raw) && isPrivateHost(url.hostname)) {
    url.protocol = 'http:'
  }

  const defaultPort = normalizePort(options.defaultPort)
  if (defaultPort && !url.port && url.protocol === 'http:') {
    url.port = defaultPort
  }

  if (options.stripMcpPath && url.pathname.replace(/\/+$/, '') === '/mcp') {
    url.pathname = '/'
  }

  url.hash = ''
  url.search = ''

  return url.toString().replace(/\/+$/, '')
}

export function cortexMcpEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`
}
