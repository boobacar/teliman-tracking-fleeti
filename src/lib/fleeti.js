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
export const loadDeliveryOrders = () => getJson('/api/delivery-orders')
export const createDeliveryOrder = (payload) => postJson('/api/delivery-orders', payload)
