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

function computeDistanceKm(pointA = {}, pointB = {}) {
  const lat1 = Number(pointA.lat)
  const lng1 = Number(pointA.lng)
  const lat2 = Number(pointB.lat)
  const lng2 = Number(pointB.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0

  const toRad = (value) => (value * Math.PI) / 180
  const radiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * radiusKm * Math.asin(Math.sqrt(a))
}

function computeApproxDistanceKm(points = []) {
  return points.reduce((sum, point, index) => {
    if (index === 0) return 0
    return sum + computeDistanceKm(points[index - 1], point)
  }, 0)
}

function comparePointTime(a, b) {
  const aTs = Date.parse(a?.time)
  const bTs = Date.parse(b?.time)
  if (Number.isFinite(aTs) && Number.isFinite(bTs)) return aTs - bTs
  if (Number.isFinite(aTs)) return -1
  if (Number.isFinite(bTs)) return 1
  return 0
}

function splitPointsIntoTripSegments(points = [], maxGapMinutes = 45) {
  const sorted = [...points].sort(comparePointTime)
  if (sorted.length < 2) return []

  const MIN_MOVEMENT_STEP_KM = 0.15
  const MIN_MOVING_SPEED_KMH = 5
  const movingIndexes = new Set()

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const point = sorted[index]
    const previousTs = Date.parse(previous?.time)
    const pointTs = Date.parse(point?.time)
    const gapMinutes = Number.isFinite(previousTs) && Number.isFinite(pointTs)
      ? (pointTs - previousTs) / 60000
      : 0

    if (gapMinutes <= 0 || gapMinutes > maxGapMinutes) continue

    const stepDistanceKm = computeDistanceKm(previous, point)
    const previousMoving = Number(previous?.speed || 0) >= MIN_MOVING_SPEED_KMH
    const currentMoving = Number(point?.speed || 0) >= MIN_MOVING_SPEED_KMH
    const coordinateMoved = stepDistanceKm >= MIN_MOVEMENT_STEP_KM
    const moving = previousMoving || currentMoving || coordinateMoved
    if (!moving) continue

    if (previousMoving || (coordinateMoved && !currentMoving)) movingIndexes.add(index - 1)
    if (currentMoving || coordinateMoved) movingIndexes.add(index)
  }

  const indexes = Array.from(movingIndexes).sort((a, b) => a - b)
  if (!indexes.length) return []

  const segments = []
  let current = [sorted[indexes[0]]]

  for (let cursor = 1; cursor < indexes.length; cursor += 1) {
    const previousPoint = current[current.length - 1]
    const point = sorted[indexes[cursor]]
    const previousTs = Date.parse(previousPoint?.time)
    const pointTs = Date.parse(point?.time)
    const gapMinutes = Number.isFinite(previousTs) && Number.isFinite(pointTs)
      ? (pointTs - previousTs) / 60000
      : 0

    if (gapMinutes > 0 && gapMinutes <= maxGapMinutes) {
      current.push(point)
      continue
    }

    if (current.length >= 2) segments.push(current)
    current = [point]
  }

  if (current.length >= 2) segments.push(current)
  return segments
}

function buildSegmentFromPoints(segmentPoints = [], trackerId, index) {
  const distance = computeApproxDistanceKm(segmentPoints)
  const speeds = segmentPoints.map((point) => Number(point.speed || 0)).filter(Number.isFinite)
  return {
    id: `${trackerId}-cache-segment-${index + 1}`,
    length: Number(distance.toFixed(2)),
    avg_speed: Number((speeds.reduce((sum, speed) => sum + speed, 0) / Math.max(speeds.length, 1)).toFixed(1)),
    max_speed: speeds.length ? Math.max(...speeds) : 0,
    started_at: segmentPoints[0]?.time || null,
    ended_at: segmentPoints[segmentPoints.length - 1]?.time || null,
  }
}

export function buildTrackBundleFromTelemetryCache({ trackerId, from, to, telemetryCache = {} } = {}) {
  const trackerCache = telemetryCache.trackers?.[trackerId] || telemetryCache.trackers?.[String(trackerId)] || {}
  const points = (Array.isArray(trackerCache.points) ? trackerCache.points : [])
    .map(normalizeTrackPoint)
    .filter(Boolean)
    .filter((point) => isWithinRange(point.time, from, to))
    .sort(comparePointTime)

  const events = (Array.isArray(telemetryCache.events) ? telemetryCache.events : [])
    .map(normalizeTrackEvent)
    .filter((event) => Number(event?.tracker_id) === Number(trackerId))
    .filter((event) => isWithinRange(event.time, from, to))

  const segments = splitPointsIntoTripSegments(points)
    .map((segmentPoints, index) => buildSegmentFromPoints(segmentPoints, trackerId, index))

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
