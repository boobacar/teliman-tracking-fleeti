export function extractArrayPayload(payload = {}, keys = ['results', 'items', 'list', 'data', 'result']) {
  if (Array.isArray(payload)) return payload
  for (const key of keys) {
    const value = payload?.[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') {
      const nested = extractArrayPayload(value, keys)
      if (nested.length) return nested
    }
  }
  return []
}

export function isCameraLike(item = {}) {
  const label = String(item?.label || item?.name || item?.cameraLabel || '').trim()
  const model = String(item?.model || item?.device_model || '').trim()
  return /(?:-cam|_cam)$/i.test(label) || /dashcam/i.test(model)
}

export function chunkIds(ids = [], size = 100) {
  const normalizedSize = Math.max(1, Number(size) || 100)
  const uniqueIds = Array.from(new Set((ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)))
  const chunks = []
  for (let index = 0; index < uniqueIds.length; index += normalizedSize) {
    chunks.push(uniqueIds.slice(index, index + normalizedSize))
  }
  return chunks
}

export function resolveScopedTrackerIds(availableTrackerIds = [], configuredTrackerIds = []) {
  const available = Array.from(new Set((availableTrackerIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)))
  const configured = Array.from(new Set((configuredTrackerIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)))

  if (!available.length) return configured
  if (!configured.length) return available

  const strict = available.filter((id) => configured.includes(id))
  return strict.length ? strict : available
}

export async function fetchAllPublicAssets({ publicApiGet, take = 500, maxPages = 100 } = {}) {
  if (typeof publicApiGet !== 'function') throw new Error('publicApiGet function is required')
  const pageSize = Math.max(1, Math.min(Number(take) || 500, 1000))
  const allRows = []

  for (let page = 0; page < maxPages; page += 1) {
    const query = { Take: pageSize, Skip: page * pageSize }
    const payload = await publicApiGet('/Asset/Search', query)
    const rows = extractArrayPayload(payload, ['results', 'items', 'list', 'data'])
    allRows.push(...rows)
    if (rows.length < pageSize) break
  }

  const byId = new Map()
  allRows.forEach((row, index) => {
    const key = row?.id ?? row?.assetId ?? row?.uuid ?? `index-${index}`
    byId.set(String(key), row)
  })
  return Array.from(byId.values())
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return null
}

export function normalizeTrackPoint(point = {}) {
  const location = point?.location || point?.position?.location || point?.gps?.location || {}
  const lat = firstFiniteNumber(point?.lat, point?.latitude, location?.lat, location?.latitude)
  const lng = firstFiniteNumber(point?.lng, point?.lon, point?.longitude, location?.lng, location?.lon, location?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    lat,
    lng,
    speed: firstFiniteNumber(point?.speed, point?.gps?.speed, point?.position?.speed) ?? 0,
    heading: firstFiniteNumber(point?.heading, point?.course, point?.bearing, point?.position?.heading) ?? 0,
    time: point?.time || point?.timestamp || point?.updatedAt || point?.updated_at || point?.date || null,
  }
}

export function normalizeTrackEvent(event = {}) {
  const location = event?.location || event?.position?.location || event?.gps?.location || {}
  const lat = firstFiniteNumber(event?.lat, event?.latitude, location?.lat, location?.latitude)
  const lng = firstFiniteNumber(event?.lng, event?.lon, event?.longitude, location?.lng, location?.lon, location?.longitude)
  return {
    ...event,
    tracker_id: firstFiniteNumber(event?.tracker_id, event?.trackerId, event?.tracker?.id),
    lat,
    lng,
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : event?.location,
    speed: firstFiniteNumber(event?.speed, event?.gps?.speed, event?.position?.speed) ?? event?.speed,
    time: event?.time || event?.timestamp || event?.updatedAt || event?.updated_at || event?.date || null,
  }
}

function isWithinRange(time, from, to) {
  const ts = Date.parse(time)
  if (!Number.isFinite(ts)) return true
  const fromTs = Date.parse(from)
  const toTs = Date.parse(to)
  if (Number.isFinite(fromTs) && ts < fromTs) return false
  if (Number.isFinite(toTs) && ts > toTs) return false
  return true
}

function computeApproxDistanceKm(points = []) {
  return points.reduce((sum, point, index) => {
    if (index === 0) return 0
    const prev = points[index - 1]
    const dLat = Number(point.lat) - Number(prev.lat)
    const dLng = Number(point.lng) - Number(prev.lng)
    return sum + Math.sqrt((dLat * 111) ** 2 + (dLng * 111) ** 2)
  }, 0)
}

export function buildTrackBundleFromTelemetryCache({ trackerId, from, to, telemetryCache = {} } = {}) {
  const trackerCache = telemetryCache.trackers?.[trackerId] || telemetryCache.trackers?.[String(trackerId)] || {}
  const points = (Array.isArray(trackerCache.points) ? trackerCache.points : [])
    .map(normalizeTrackPoint)
    .filter(Boolean)
    .filter((point) => isWithinRange(point.time, from, to))

  const events = (Array.isArray(telemetryCache.events) ? telemetryCache.events : [])
    .map(normalizeTrackEvent)
    .filter((event) => Number(event?.tracker_id) === Number(trackerId))
    .filter((event) => isWithinRange(event.time, from, to))

  const distance = computeApproxDistanceKm(points)
  const speeds = points.map((point) => Number(point.speed || 0)).filter(Number.isFinite)
  const segments = points.length >= 2
    ? [{
      length: Number(distance.toFixed(2)),
      avg_speed: Number((speeds.reduce((sum, speed) => sum + speed, 0) / Math.max(speeds.length, 1)).toFixed(1)),
      max_speed: speeds.length ? Math.max(...speeds) : 0,
      started_at: points[0]?.time || null,
      ended_at: points[points.length - 1]?.time || null,
    }]
    : []

  return { trackerId, from, to, segments, points, events }
}

export async function fetchPrivateForTrackers({ apiCall, endpoint, hash, trackerIds, payload = {}, chunkSize = 100, merge = 'array' } = {}) {
  if (typeof apiCall !== 'function') throw new Error('apiCall function is required')
  const chunks = chunkIds(trackerIds, chunkSize)
  if (!chunks.length) return merge === 'object' ? {} : []

  if (merge === 'object') {
    const merged = {}
    for (const trackers of chunks) {
      const response = await apiCall(endpoint, { hash, ...payload, trackers })
      Object.assign(merged, response?.states || response?.result || response?.data || response || {})
    }
    return merged
  }

  const rows = []
  for (const trackers of chunks) {
    const response = await apiCall(endpoint, { hash, ...payload, trackers })
    rows.push(...extractArrayPayload(response))
  }
  return rows
}
