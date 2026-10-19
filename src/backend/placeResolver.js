// Localisation des excès de vitesse : on nomme l'endroit exact du dépassement.
// Trois sources, dans cet ordre :
//   1. la zone déclarée dans la plateforme (aucun appel réseau, toujours disponible) ;
//   2. le géocodage inverse OpenStreetMap (Nominatim) pour les points hors zone, avec
//      cache disque et cadence d'un appel par seconde (règles d'usage OSM) ;
//   3. à défaut, les coordonnées brutes — jamais de lieu inventé.
import fs from 'node:fs'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'TelimanTracking/1.0 (suivi de flotte Teliman Logistique)'
const CACHE_MAX_ENTRIES = 5000

export function haversineKm(a, b) {
  const lat1 = Number(a?.lat)
  const lng1 = Number(a?.lng)
  const lat2 = Number(b?.lat)
  const lng2 = Number(b?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// Zone déclarée contenant le point (la plus proche si plusieurs se chevauchent).
export function findZone(point = {}, zones = []) {
  let best = null
  for (const zone of Array.isArray(zones) ? zones : []) {
    const radiusKm = Number(zone?.radiusMeters) / 1000
    const distance = haversineKm(point, { lat: Number(zone?.lat), lng: Number(zone?.lng) })
    if (distance === null || !Number.isFinite(radiusKm) || radiusKm <= 0) continue
    if (distance > radiusKm) continue
    if (!best || distance < best.distanceKm) {
      best = { name: String(zone.name || '').trim(), distanceKm: Number(distance.toFixed(2)), source: 'zone' }
    }
  }
  return best
}

function cacheKey(point = {}) {
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

export function createGeocodeCache({ filePath = '', maxEntries = CACHE_MAX_ENTRIES } = {}) {
  let entries = {}
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries = parsed
      }
    } catch { entries = {} }
  }
  let dirty = false
  const persist = () => {
    if (!filePath || !dirty) return
    try {
      const keys = Object.keys(entries)
      if (keys.length > maxEntries) {
        for (const key of keys.slice(0, keys.length - maxEntries)) delete entries[key]
      }
      fs.writeFileSync(filePath, JSON.stringify(entries))
      dirty = false
    } catch { /* cache best-effort : jamais bloquant */ }
  }
  return {
    get(point) {
      const key = cacheKey(point)
      if (!key) return null
      return entries[key] ?? null
    },
    set(point, label) {
      const key = cacheKey(point)
      if (!key || !label) return
      entries[key] = String(label)
      dirty = true
    },
    persist,
    get size() {
      return Object.keys(entries).length
    },
  }
}

// Adresse lisible et courte : « route de Korhogo, Kani » plutôt qu'une adresse complète.
function formatNominatimLabel(payload = {}) {
  const address = payload?.address || {}
  const road = address.road || address.pedestrian || address.hamlet || ''
  const locality = address.village || address.town || address.city || address.suburb || address.municipality || address.county || ''
  const parts = [road, locality].map((item) => String(item || '').trim()).filter(Boolean)
  if (parts.length) return [...new Set(parts)].join(', ')
  const display = String(payload?.display_name || '').trim()
  return display ? display.split(',').slice(0, 2).join(',').trim() : ''
}

// Géocodage inverse avec cache disque. Renvoie '' si le service ne répond pas :
// un rapport ne doit jamais être bloqué par un service externe.
export function createPlaceResolver({
  cachePath = '',
  fetchImpl = globalThis.fetch,
  minIntervalMs = 1100,
  timeoutMs = 6000,
  logger = console,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const cache = createGeocodeCache({ filePath: cachePath })
  let lastCallAt = 0

  async function reverse(point) {
    const cached = cache.get(point)
    if (cached) return cached
    if (typeof fetchImpl !== 'function') return ''
    const elapsed = now() - lastCallAt
    if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed)
    lastCallAt = now()
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const url = `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(Number(point.lat))}&lon=${encodeURIComponent(Number(point.lng))}&zoom=16&addressdetails=1&accept-language=fr`
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller?.signal,
      })
      if (!response?.ok) return ''
      const payload = await response.json()
      const label = formatNominatimLabel(payload)
      if (label) cache.set(point, label)
      return label
    } catch (error) {
      logger?.warn?.(`[lieu] géocodage indisponible (${error?.message || error})`)
      return ''
    } finally {
      if (timer) clearTimeout(timer)
      cache.persist()
    }
  }

  return {
    cache,
    // Nom de l'endroit : zone déclarée, sinon géocodage, sinon coordonnées.
    async describe(point, { zones = [] } = {}) {
      const zone = findZone(point, zones)
      if (zone?.name) return { label: zone.name, source: 'zone', precisionKm: zone.distanceKm }
      const label = await reverse(point)
      if (label) return { label, source: 'geocode', precisionKm: null }
      const lat = Number(point?.lat)
      const lng = Number(point?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { label: '', source: 'unknown', precisionKm: null }
      return { label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, source: 'coords', precisionKm: null }
    },
  }
}

// Enrichit les excès de vitesse avec leur lieu. Seuls les dépassements au-delà du seuil
// demandé (90 km/h par défaut) reçoivent un lieu : en dessous, aucun endroit n'est affiché.
export async function describeSpeedBreaches(breaches = [], { zones = [], resolver, minSpeedKmh = 90, logger = console } = {}) {
  const out = []
  for (const breach of Array.isArray(breaches) ? breaches : []) {
    const speed = Number(breach?.speed)
    const enrichi = { ...breach }
    if (Number.isFinite(speed) && speed > Number(minSpeedKmh) && Number.isFinite(Number(breach?.lat)) && Number.isFinite(Number(breach?.lng))) {
      try {
        const place = resolver
          ? await resolver.describe({ lat: Number(breach.lat), lng: Number(breach.lng) }, { zones })
          : null
        if (place?.label) {
          enrichi.place = place.label
          enrichi.placeSource = place.source
        }
      } catch (error) {
        logger?.warn?.(`[lieu] endroit du dépassement indisponible (${error?.message || error})`)
      }
    }
    out.push(enrichi)
  }
  return out
}
