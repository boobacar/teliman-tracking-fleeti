const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

async function getJson(path) {
  const response = await fetch(`${BACKEND_URL}${path}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}

export const loadFleetData = () => getJson('/api/dashboard')
export const loadTrackers = () => getJson('/api/trackers')
export const loadDrivers = () => getJson('/api/drivers')
export const loadAlerts = () => getJson('/api/alerts')
