const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

async function getJson(path) {
  const response = await fetch(`${BACKEND_URL}${path}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}

async function postJson(path, body) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}

export const loadFleetData = () => getJson('/api/dashboard')
export const loadTrackers = () => getJson('/api/trackers')
export const loadDrivers = () => getJson('/api/drivers')
export const loadAlerts = () => getJson('/api/alerts')
export const loadReports = () => getJson('/api/reports')
export const loadReportSummary = (query = '') => getJson(`/api/reports/summary${query ? `?${query}` : ''}`)
export const loadReportFleet = (query = '') => getJson(`/api/reports/fleet${query ? `?${query}` : ''}`)
export const loadReportAlerts = (query = '') => getJson(`/api/reports/alerts${query ? `?${query}` : ''}`)
export const loadReportMissions = (query = '') => getJson(`/api/reports/missions${query ? `?${query}` : ''}`)
export const loadReportPivot = (query = '') => getJson(`/api/reports/pivot${query ? `?${query}` : ''}`)
export const loadDeliveryOrders = () => getJson('/api/delivery-orders')
export const loadMasterData = () => getJson('/api/master-data')
export const addMasterDataItem = (listName, value) => postJson(`/api/master-data/${listName}`, { value })
export const deleteMasterDataItem = async (listName, value) => {
  const response = await fetch(`${BACKEND_URL}/api/master-data/${listName}?value=${encodeURIComponent(value)}`, { method: 'DELETE' })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const createDeliveryOrder = (payload) => postJson('/api/delivery-orders', payload)
export const updateDeliveryOrder = async (id, payload) => {
  const response = await fetch(`${BACKEND_URL}/api/delivery-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const deleteDeliveryOrder = async (id) => {
  const response = await fetch(`${BACKEND_URL}/api/delivery-orders/${id}`, { method: 'DELETE' })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const loadDeliveryOrder = (id) => getJson(`/api/delivery-order/${id}`)
export const loadDeliveryOrdersSummary = () => getJson('/api/delivery-orders-summary')
export const loadTracks = ({ trackerId, from, to }) => getJson(`/api/tracks?trackerId=${trackerId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
export const loadTracksBatch = (payload) => postJson('/api/tracks/batch', payload)
