const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

function isBrowser() {
  return typeof window !== 'undefined'
}

function getSessionHeaders() {
  if (!isBrowser()) return {}
  const email = localStorage.getItem('teliman_user_email') || ''
  const sessionToken = localStorage.getItem('teliman_session_token') || ''
  return email && sessionToken ? { 'x-user-email': email, 'x-session-token': sessionToken } : {}
}

export function resolveMediaUrl(path) {
  const value = String(path || '')
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value
  if (value.startsWith('/')) return `${BACKEND_URL}${value}`
  return value
}

async function getJson(path) {
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, { headers: { ...getSessionHeaders() } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || 'Erreur serveur')
    return data
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Impossible de joindre le serveur. Vérifiez la connexion ou la configuration CORS.')
    throw error
  }
}

async function postJson(path, body) {
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || 'Erreur serveur')
    return data
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Impossible de joindre le serveur. Vérifiez la connexion ou la configuration CORS.')
    throw error
  }
}

export async function login(email, password) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || 'Connexion impossible. Veuillez réessayer.')
    if (isBrowser()) {
      localStorage.setItem('teliman_user_email', data.user.email)
      localStorage.setItem('teliman_session_token', data.sessionToken)
      localStorage.setItem('teliman_user_role', data.user.role || '')
      localStorage.setItem('teliman_user_permissions', JSON.stringify(data.user.permissions || []))
    }
    return data
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Impossible de joindre le serveur. Vérifiez votre connexion ou réessayez plus tard.')
    }
    throw error
  }
}

export function logout() {
  if (!isBrowser()) return
  localStorage.removeItem('teliman_user_email')
  localStorage.removeItem('teliman_session_token')
  localStorage.removeItem('teliman_user_role')
  localStorage.removeItem('teliman_user_permissions')
}

export async function getCurrentUser() {
  const response = await fetch(`${BACKEND_URL}/api/auth/me`, { headers: { ...getSessionHeaders() } })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Session invalide')
  return data.user
}

export const loadAdminUsers = () => getJson('/api/admin/users')
export const createAdminUser = (payload) => postJson('/api/admin/users', payload)
export const updateAdminUser = async (email, payload) => {
  const response = await fetch(`${BACKEND_URL}/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Erreur de mise à jour')
  return data
}
export const deleteAdminUser = async (email) => {
  const response = await fetch(`${BACKEND_URL}/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { ...getSessionHeaders() },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Erreur de suppression')
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
export const loadReportDetailedDeliveries = (query = '') => getJson(`/api/reports/detailed-deliveries${query ? `?${query}` : ''}`)
export const loadReportByClient = (query = '') => getJson(`/api/reports/by-client${query ? `?${query}` : ''}`)
export const loadReportByGoods = (query = '') => getJson(`/api/reports/by-goods${query ? `?${query}` : ''}`)
export const loadReportByTruck = (query = '') => getJson(`/api/reports/by-truck${query ? `?${query}` : ''}`)
export const loadReportByDestination = (query = '') => getJson(`/api/reports/by-destination${query ? `?${query}` : ''}`)
export const loadReportPerformanceDrivers = (query = '') => getJson(`/api/reports/performance-drivers${query ? `?${query}` : ''}`)
export const loadReportPerformanceDays = (query = '') => getJson(`/api/reports/performance-days${query ? `?${query}` : ''}`)
export const loadReportFuelSummary = (query = '') => getJson(`/api/reports/fuel-summary${query ? `?${query}` : ''}`)
export const loadReportBatches = (query = '') => getJson(`/api/reports/batches${query ? `?${query}` : ''}`)
export const loadReportProjects = (query = '') => getJson(`/api/reports/projects${query ? `?${query}` : ''}`)
export const loadDeliveryOrders = () => getJson('/api/delivery-orders')
export const loadMasterData = () => getJson('/api/master-data')
export const addMasterDataItem = (listName, value, extra = {}) => postJson(`/api/master-data/${listName}`, { value, ...extra })
export const deleteMasterDataItem = async (listName, value) => {
  const response = await fetch(`${BACKEND_URL}/api/master-data/${listName}?value=${encodeURIComponent(value)}`, { method: 'DELETE', headers: { ...getSessionHeaders() } })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const createDeliveryOrder = (payload) => postJson('/api/delivery-orders', payload)
export const updateDeliveryOrder = async (id, payload) => {
  const response = await fetch(`${BACKEND_URL}/api/delivery-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const deleteDeliveryOrder = async (id) => {
  const response = await fetch(`${BACKEND_URL}/api/delivery-orders/${id}`, { method: 'DELETE', headers: { ...getSessionHeaders() } })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const loadDeliveryOrder = async (id) => {
  const data = await getJson(`/api/delivery-order/${id}`)
  return data?.item || null
}
export const loadDeliveryOrdersSummary = () => getJson('/api/delivery-orders-summary')
export const loadFuelVouchers = () => getJson('/api/fuel-vouchers')
export const loadLiveFuelLevels = () => getJson('/api/fuel-live')
export const loadCameras = () => getJson('/api/cameras')
export const createFuelVoucher = (payload) => postJson('/api/fuel-vouchers', payload)
export const updateFuelVoucher = async (id, payload) => {
  const response = await fetch(`${BACKEND_URL}/api/fuel-vouchers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const deleteFuelVoucher = async (id) => {
  const response = await fetch(`${BACKEND_URL}/api/fuel-vouchers/${id}`, { method: 'DELETE', headers: { ...getSessionHeaders() } })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}
export const loadTracks = ({ trackerId, from, to }) => getJson(`/api/tracks?trackerId=${trackerId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
export const loadTracksBatch = (payload) => postJson('/api/tracks/batch', payload)
