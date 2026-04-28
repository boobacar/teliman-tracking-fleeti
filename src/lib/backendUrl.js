export function normalizeBackendUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'http://localhost:8787'
  return raw
    .replace('api.talimanlogistique.com', 'api.telimanlogistique.com')
    .replace(/\/$/, '')
}
