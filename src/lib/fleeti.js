import { normalizeBackendUrl } from './backendUrl.js'

const BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL)
const REQUEST_TIMEOUT_MS = 12000
export const SERVICE_SUSPENSION_EVENT = 'teliman:service-suspended'

function emitServiceSuspended(message = 'impossible de joindre le serveur') {
  if (!isBrowser() || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(SERVICE_SUSPENSION_EVENT, {
    detail: {
      suspended: true,
      message,
    },
  }))
}

function isBrowser() {
  return typeof window !== 'undefined'
}

function getSessionHeaders() {
  if (!isBrowser()) return {}
  const sessionToken = localStorage.getItem('teliman_session_token') || ''
  return sessionToken ? { 'x-session-token': sessionToken } : {}
}

function createTimeoutSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  return controller.signal
}

export async function fetchJson(path, options = {}) {
  try {
    const { responseType = 'json', headers = {}, ...requestOptions } = options
    const response = await fetch(`${BACKEND_URL}${path}`, {
      signal: createTimeoutSignal(),
      ...requestOptions,
      headers: {
        ...headers,
      },
    })
    const data = responseType === 'blob'
      ? await response.blob()
      : await response.json().catch(() => ({}))
    if (!response.ok) {
      if (data?.suspended) {
        emitServiceSuspended(data?.error || 'impossible de joindre le serveur')
        const error = new Error(data?.error || 'impossible de joindre le serveur')
        error.serviceSuspended = true
        error.kind = 'suspended'
        throw error
      }
      const error = new Error(data?.error || (response.status >= 500 ? 'Erreur interne du serveur.' : 'Requête refusée.'))
      error.status = response.status
      if (response.status === 401) error.kind = 'sessionExpired'
      else if (response.status >= 500) error.kind = 'serverError'
      else error.kind = 'requestError'
      throw error
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Le serveur met trop de temps à répondre.')
      timeoutError.kind = 'timeout'
      throw timeoutError
    }
    if (error instanceof TypeError) {
      const offlineError = new Error('Impossible de joindre le serveur. Vérifiez votre connexion.')
      offlineError.kind = 'offline'
      throw offlineError
    }
    throw error
  }
}

export function resolveMediaUrl(path) {
  const value = String(path || '')
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value
  if (value.startsWith('/')) return `${BACKEND_URL}${value}`
  return value
}

export async function loadProtectedMediaObjectUrl(mediaPath) {
  const value = String(mediaPath || '').trim()
  if (!value) return ''
  if (!value.startsWith('/uploads/')) return resolveMediaUrl(value)
  const blob = await fetchJson(value, {
    responseType: 'blob',
    headers: { ...getSessionHeaders(), Accept: 'image/*' },
  })
  return URL.createObjectURL(blob)
}

async function getJson(path) {
  return fetchJson(path, { headers: { ...getSessionHeaders() } })
}

async function postJson(path, body) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(body),
  })
}

async function putJson(path, body) {
  return fetchJson(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(body),
  })
}

export async function login(email, password) {
  try {
    const data = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (isBrowser()) {
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

export async function logout() {
  if (!isBrowser()) return
  try {
    await fetchJson('/api/auth/logout', { method: 'POST', headers: { ...getSessionHeaders() } })
  } catch (error) {
    if (!['sessionExpired', 'offline', 'timeout'].includes(error?.kind)) throw error
  } finally {
    localStorage.removeItem('teliman_session_token')
    localStorage.removeItem('teliman_user_role')
    localStorage.removeItem('teliman_user_permissions')
  }
}

export async function getCurrentUser() {
  if (isBrowser() && !localStorage.getItem('teliman_session_token')) return null
  try {
    const data = await getJson('/api/auth/me')
    return data.user
  } catch (error) {
    if (isBrowser() && error?.kind === 'sessionExpired') {
      localStorage.removeItem('teliman_session_token')
      localStorage.removeItem('teliman_user_role')
      localStorage.removeItem('teliman_user_permissions')
    }
    throw error
  }
}

export const loadAdminUsers = () => getJson('/api/admin/users')
export const createAdminUser = (payload) => postJson('/api/admin/users', payload)
export const updateAdminUser = (email, payload) => fetchJson(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
export const deleteAdminUser = (email) => fetchJson(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
  })

export const loadServiceStatus = () => getJson('/api/service-status')
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
export const loadWhatsAppStatus = () => getJson('/api/whatsapp/status')
export const loadWhatsAppQr = () => getJson('/api/whatsapp/qr')
export const loadWhatsAppHistory = () => getJson('/api/whatsapp/history?limit=100')
export const reconnectWhatsApp = (clearSession = false) => postJson('/api/whatsapp/reconnect', { clearSession })
export const disconnectWhatsApp = (clearSession = true) => postJson('/api/whatsapp/disconnect', { clearSession })
export const sendWhatsAppTestMessage = (payload) => postJson('/api/whatsapp/test-message', payload)
export const loadWhatsAppTemplates = () => getJson('/api/whatsapp/templates')
export const saveWhatsAppTemplates = (templates) => putJson('/api/whatsapp/templates', { templates })
export const resetWhatsAppTemplates = () => postJson('/api/whatsapp/templates/reset', {})
export const loadDeliveryOrders = ({ page, limit } = {}) => {
  const params = new URLSearchParams()
  if (page != null) params.set('page', page)
  if (limit != null) params.set('limit', limit)
  const qs = params.toString()
  return getJson(`/api/delivery-orders${qs ? `?${qs}` : ''}`)
}
export const loadMasterData = () => getJson('/api/master-data')
export const addMasterDataItem = (listName, value, extra = {}) => postJson(`/api/master-data/${listName}`, { value, ...extra })
export const deleteMasterDataItem = async (listName, value, extra = {}) => {
  const params = new URLSearchParams({ value })
  Object.entries(extra || {}).forEach(([key, entry]) => {
    if (entry !== undefined && entry !== null && String(entry).trim()) params.set(key, String(entry))
  })
  return fetchJson(`/api/master-data/${listName}?${params.toString()}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
}
export const createDeliveryOrder = (payload) => postJson('/api/delivery-orders', payload)
export const updateDeliveryOrder = (id, payload) => fetchJson(`/api/delivery-orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
export const deleteDeliveryOrder = (id) => fetchJson(`/api/delivery-orders/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
export const loadDeliveryOrder = async (id) => {
  const data = await getJson(`/api/delivery-order/${id}`)
  return data?.item || null
}
export const loadDeliveryOrdersSummary = () => getJson('/api/delivery-orders-summary')
export const loadFuelVouchers = ({ page, limit } = {}) => {
  const params = new URLSearchParams()
  if (page != null) params.set('page', page)
  if (limit != null) params.set('limit', limit)
  const qs = params.toString()
  return getJson(`/api/fuel-vouchers${qs ? `?${qs}` : ''}`)
}
export const loadFuelVoucher = async (id) => {
  const data = await getJson(`/api/fuel-voucher/${id}`)
  return data?.item || null
}
export const loadLiveFuelLevels = () => getJson('/api/fuel-live')
export const loadCameras = () => getJson('/api/cameras')
export const createFuelVoucher = (payload) => postJson('/api/fuel-vouchers', payload)
export const updateFuelVoucher = (id, payload) => fetchJson(`/api/fuel-vouchers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
export const deleteFuelVoucher = (id) => fetchJson(`/api/fuel-vouchers/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
export const loadLiveOdometer = () => getJson('/api/live-odometer')
export const loadLivePositions = () => getJson('/api/positions-live')
export const loadDriverAssignments = () => getJson('/api/driver-assignments')
export const saveDriverAssignments = (assignments) => putJson('/api/driver-assignments', { assignments })
export const loadDriverOverrides = () => getJson('/api/driver-overrides')
export const saveDriverOverrides = (overrides) => putJson('/api/driver-overrides', { overrides })
export const patchDriverOverride = (id, data) => fetchJson(`/api/driver-overrides/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(data),
  })
export const deleteDriverOverride = (id) => fetchJson(`/api/driver-overrides/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
  })
export const loadOilChanges = () => getJson('/api/oil-changes')
export const createOilChange = (payload) => postJson('/api/oil-changes', payload)
export const updateOilChange = (id, payload) => fetchJson(`/api/oil-changes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
    body: JSON.stringify(payload),
  })
export const deleteOilChange = (id) => fetchJson(`/api/oil-changes/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
export const loadTracks = ({ trackerId, from, to }) => getJson(`/api/tracks?trackerId=${trackerId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
export const loadTracksBatch = (payload) => postJson('/api/tracks/batch', payload)
export const loadGeofences = () => getJson('/api/geofences')
export const createGeofence = (payload) => postJson('/api/geofences', payload)
export const updateGeofence = (id, payload) => fetchJson(`/api/geofences/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
  body: JSON.stringify(payload),
})
export const deleteGeofence = (id) => fetchJson(`/api/geofences/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
export const loadGeofenceEvents = (limit = 50) => getJson(`/api/geofence-events?limit=${limit}`)
export const loadAlertRecipients = () => getJson('/api/alert-recipients')
export const createAlertRecipient = (payload) => postJson('/api/alert-recipients', payload)
export const updateAlertRecipient = (id, payload) => fetchJson(`/api/alert-recipients/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...getSessionHeaders() },
  body: JSON.stringify(payload),
})
export const deleteAlertRecipient = (id) => fetchJson(`/api/alert-recipients/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getSessionHeaders() } })
export const loadVehicles = () => getJson('/api/vehicles')
export const loadEmployeesDetail = () => getJson('/api/employees-detail')
export const loadSensorsLive = () => getJson('/api/sensors-live')
export const loadRulesDetail = () => getJson('/api/rules-detail')
