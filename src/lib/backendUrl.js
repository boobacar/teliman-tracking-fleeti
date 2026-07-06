const LOCAL_DEFAULT_BACKEND_URL = 'http://localhost:8787'
const PUBLIC_DEFAULT_BACKEND_URL = 'https://home-server-1.tail660cfd.ts.net'

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase()
}

function isPrivateHostname(host) {
  const value = normalizeHost(host)
  if (!value) return false
  if (value === 'localhost' || value === '127.0.0.1' || value === '0.0.0.0') return true
  if (value.endsWith('.ts.net')) return true
  if (/^10\./.test(value)) return true
  if (/^192\.168\./.test(value)) return true
  if (/^100\./.test(value)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true
  return false
}

function isPublicFrontendHost(host) {
  const value = normalizeHost(host)
  if (!value) return false
  return !isPrivateHostname(value)
}

function sanitizeBackendUrl(value) {
  return String(value || '')
    .trim()
    .replace('api.talimanlogistique.com', 'api.telimanlogistique.com')
    .replace(/\/$/, '')
}

function readCurrentFrontendHost(explicitHost) {
  if (explicitHost) return normalizeHost(explicitHost)
  if (typeof window === 'undefined') return ''
  return normalizeHost(window.location?.hostname)
}

export function normalizeBackendUrl(value, options = {}) {
  const currentFrontendHost = readCurrentFrontendHost(options.currentFrontendHost)
  const raw = sanitizeBackendUrl(value)

  if (!raw) {
    return isPublicFrontendHost(currentFrontendHost)
      ? PUBLIC_DEFAULT_BACKEND_URL
      : LOCAL_DEFAULT_BACKEND_URL
  }

  try {
    const url = new URL(raw)
    if (isPrivateHostname(url.hostname) && isPublicFrontendHost(currentFrontendHost)) {
      return PUBLIC_DEFAULT_BACKEND_URL
    }
  } catch {
    return raw
  }

  return raw
}
