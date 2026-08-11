const LOCAL_DEFAULT_BACKEND_URL = 'http://localhost:8787'
const PUBLIC_DEFAULT_BACKEND_URL = 'https://home-server-1.tail660cfd.ts.net'
// Hôtes publics dont le proxy même-origine /api → backend est FIABLE.
// teliman-tracking-fleeti.vercel.app en a été retiré : son proxy Vercel résout
// mal le Funnel Tailscale (502 DNS_HOSTNAME_NOT_FOUND/EMPTY intermittents) —
// la SPA appelle donc directement le backend public (CORS déjà autorisé).
const SAME_ORIGIN_PROXY_HOSTS = new Set([
  'www.telimanlogistique.com',
  'telimanlogistique.com',
])

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

  // Tailscale Funnel reverse-proxyfie déjà l'application et ses API.
  // Toute origine explicite contournerait le Funnel et serait inaccessible au navigateur.
  if (currentFrontendHost.endsWith('.ts.net')) return ''

  // Vercel (teliman-tracking-fleeti.vercel.app) : le proxy /api → backend est
  // instable (502 DNS_HOSTNAME_* intermittents). Appeler DIRECTEMENT le backend
  // public (Funnel) — le CORS du serveur autorise déjà cette origine.
  if (SAME_ORIGIN_PROXY_HOSTS.has(currentFrontendHost)) return ''

  // Hôte privé (localhost, LAN, Tailscale) : la SPA et l'API sont servies par le
  // même serveur Express sur le même port. Renvoyer '' évite d'utiliser une
  // VITE_BACKEND_URL périmée (ex. ancienne IP Tailscale hors ligne) qui ferait
  // échouer toutes les requêtes API.
  if (isPrivateHostname(currentFrontendHost)) return ''

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
