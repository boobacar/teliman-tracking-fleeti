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
