import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DELIVERY_ORDERS_FILE = path.join(__dirname, 'delivery-orders.json')

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 8787
const API_BASE = process.env.FLEETI_API_BASE || 'https://tracking.ci.fleeti.co/api-v2'
const LOGIN = process.env.FLEETI_LOGIN || 'boubsfal@gmail.com'
const PASSWORD = process.env.FLEETI_PASSWORD || 'Azerty123456#'
const DEALER_ID = Number(process.env.FLEETI_DEALER_ID || 23241)
const LOCALE = process.env.FLEETI_LOCALE || 'fr'
const TRACKER_IDS = [3487533, 3487539, 3488325, 3488326, 3511635, 3537761, 3537762, 3537766]
const CACHE_TTL_MS = 60 * 1000
let dashboardCache = { data: null, ts: 0 }

function readDeliveryOrders() {
  try {
    return JSON.parse(fs.readFileSync(DELIVERY_ORDERS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeDeliveryOrders(rows) {
  fs.writeFileSync(DELIVERY_ORDERS_FILE, JSON.stringify(rows, null, 2))
}

async function apiCall(endpoint, payload = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'NVX-ISO-DateTime': 'true' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok || data.success === false) {
    throw new Error(data?.status?.description || 'Fleeti API error')
  }
  return data
}

async function authenticate() {
  const auth = await apiCall('user/auth', {
    login: LOGIN,
    password: PASSWORD,
    dealer_id: DEALER_ID,
    locale: LOCALE,
  })
  return auth.hash
}

function sanitizeTrackers(trackers = []) {
  return trackers.filter(Boolean).map((tracker) => ({
    ...tracker,
    label: tracker.label || tracker.name || `Tracker ${tracker.id}`,
    model: tracker.model || 'Modèle inconnu',
  }))
}

function sanitizeEmployees(employees = []) {
  return employees.filter(Boolean).map((employee) => ({
    ...employee,
    first_name: employee.first_name || '',
    last_name: employee.last_name || '',
    phone: employee.phone || 'N/A',
  }))
}

function sanitizeHistory(history = []) {
  return history.filter(Boolean).map((event) => ({
    ...event,
    event: event.event || 'unknown',
    time: event.time || new Date().toISOString(),
    message: event.message || 'Événement sans description',
    address: event.address || 'Adresse indisponible',
  }))
}

async function getFuelSensorInfo(hash, trackerId) {
  try {
    const sensors = await apiCall('tracker/sensor/list', { hash, tracker_id: trackerId })
    const fuelSensors = (sensors.list ?? []).filter((sensor) => {
      const text = JSON.stringify(sensor).toLowerCase()
      return text.includes('fuel') || text.includes('consum') || text.includes('carb')
    })
    return fuelSensors
  } catch {
    return []
  }
}

async function getDashboardData(forceRefresh = false) {
  if (!forceRefresh && dashboardCache.data && Date.now() - dashboardCache.ts < CACHE_TTL_MS) {
    return dashboardCache.data
  }

  const hash = await authenticate()
  const [trackers, states, employees, unreadCount, rules, tariffs, history, mileage] = await Promise.all([
    apiCall('tracker/list', { hash }),
    apiCall('tracker/get_states', { hash, trackers: TRACKER_IDS }),
    apiCall('employee/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/unread/count', { hash }).catch(() => ({ value: 0 })),
    apiCall('tracker/rule/list', { hash }).catch(() => ({ list: [] })),
    apiCall('tariff/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/tracker/list', { hash, trackers: TRACKER_IDS, from: '2026-04-01 00:00:00', to: '2026-04-02 23:59:59', limit: 200 }).catch(() => ({ list: [] })),
    apiCall('tracker/stats/mileage/read', { hash, trackers: TRACKER_IDS, from: '2026-04-01 00:00:00', to: '2026-04-02 23:59:59' }).catch(() => ({ result: {} })),
  ])

  const payload = {
    trackers: sanitizeTrackers(trackers.list ?? []),
    states: states.states ?? {},
    employees: sanitizeEmployees(employees.list ?? []),
    unreadCount: unreadCount.value ?? unreadCount.count ?? 0,
    rules: rules.list ?? [],
    tariffs: tariffs.list ?? [],
    history: sanitizeHistory(history.list ?? []),
    mileage: mileage.result ?? {},
  }

  dashboardCache = { data: payload, ts: Date.now() }
  return payload
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'teliman-tracking-fleeti-v3', cacheTtlMs: CACHE_TTL_MS, timestamp: new Date().toISOString() })
})

app.get('/api/dashboard', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1'
    res.json(await getDashboardData(forceRefresh))
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/trackers', async (_req, res) => {
  try {
    const data = await getDashboardData()
    res.json({ trackers: data.trackers, states: data.states, mileage: data.mileage })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/drivers', async (_req, res) => {
  try {
    const data = await getDashboardData()
    res.json({ drivers: data.employees, history: data.history })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/alerts', async (_req, res) => {
  try {
    const data = await getDashboardData()
    res.json({ alerts: data.history, unreadCount: data.unreadCount, rules: data.rules })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/summary', async (_req, res) => {
  try {
    const data = await getDashboardData()
    const trackers = data.trackers ?? []
    const states = data.states ?? {}
    const history = data.history ?? []
    res.json({
      totalTrackers: trackers.length,
      active: trackers.filter((tracker) => states?.[tracker.id]?.connection_status === 'active').length,
      offline: trackers.filter((tracker) => states?.[tracker.id]?.connection_status === 'offline').length,
      moving: trackers.filter((tracker) => states?.[tracker.id]?.movement_status === 'moving').length,
      alerts: history.length,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim()
    const data = await getDashboardData()
    const employeesByTracker = Object.fromEntries((data.employees ?? []).map((employee) => [employee.tracker_id, employee]))
    const results = (data.trackers ?? []).filter((tracker) => {
      const employee = employeesByTracker[tracker.id]
      const text = `${tracker.label} ${employee?.first_name || ''} ${employee?.last_name || ''}`.toLowerCase()
      return q ? text.includes(q) : true
    }).map((tracker) => ({
      id: tracker.id,
      label: tracker.label,
      employee: employeesByTracker[tracker.id] ? `${employeesByTracker[tracker.id].first_name} ${employeesByTracker[tracker.id].last_name}`.trim() : 'Non assigné',
      state: data.states?.[tracker.id] ?? {},
    }))
    res.json({ query: q, results })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/tracker/:id', async (req, res) => {
  try {
    const trackerId = Number(req.params.id)
    const data = await getDashboardData()
    const tracker = (data.trackers ?? []).find((item) => item.id === trackerId)
    if (!tracker) return res.status(404).json({ ok: false, error: 'Tracker not found' })
    const employee = (data.employees ?? []).find((item) => item.tracker_id === trackerId)
    const history = (data.history ?? []).filter((event) => event.tracker_id === trackerId)
    res.json({
      tracker,
      state: data.states?.[trackerId] ?? {},
      employee: employee ?? null,
      mileage: data.mileage?.[trackerId] ?? {},
      history,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/analytics', async (_req, res) => {
  try {
    const data = await getDashboardData()
    const trackers = data.trackers ?? []
    const history = data.history ?? []
    const states = data.states ?? {}
    const enriched = trackers.map((tracker) => {
      const trackerHistory = history.filter((event) => event.tracker_id === tracker.id)
      const mileage = data.mileage?.[tracker.id]?.['2026-04-02']?.mileage ?? data.mileage?.[tracker.id]?.['2026-04-01']?.mileage ?? 0
      return {
        id: tracker.id,
        label: tracker.label,
        mileage,
        alerts: trackerHistory.length,
        speed: states?.[tracker.id]?.gps?.speed ?? 0,
        status: states?.[tracker.id]?.connection_status ?? 'unknown',
      }
    })
    res.json({
      topMileage: [...enriched].sort((a, b) => b.mileage - a.mileage).slice(0, 5),
      topAlerts: [...enriched].sort((a, b) => b.alerts - a.alerts).slice(0, 5),
      offline: enriched.filter((item) => item.status === 'offline'),
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/questions/today', async (_req, res) => {
  try {
    const data = await getDashboardData()
    const states = data.states ?? {}
    const alerts = data.history ?? []
    const trackers = data.trackers ?? []
    const answerPack = {
      offlineUnits: trackers.filter((tracker) => states?.[tracker.id]?.connection_status === 'offline').map((tracker) => tracker.label),
      movingUnits: trackers.filter((tracker) => states?.[tracker.id]?.movement_status === 'moving').map((tracker) => tracker.label),
      criticalAlerts: alerts.filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event)).slice(0, 10),
    }
    res.json(answerPack)
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/ask', async (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim()
    const data = await getDashboardData()
    const states = data.states ?? {}
    const trackers = data.trackers ?? []
    const alerts = data.history ?? []

    if (q.includes('offline')) {
      return res.json({ question: q, answer: trackers.filter((tracker) => states?.[tracker.id]?.connection_status === 'offline').map((tracker) => tracker.label) })
    }

    if (q.includes('bouge') || q.includes('moving')) {
      return res.json({ question: q, answer: trackers.filter((tracker) => states?.[tracker.id]?.movement_status === 'moving').map((tracker) => ({ label: tracker.label, speed: states?.[tracker.id]?.gps?.speed ?? 0 })) })
    }

    if (q.includes('alerte')) {
      return res.json({ question: q, answer: alerts.filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event)).slice(0, 10) })
    }

    if (q.includes('plus roul')) {
      const ranked = trackers.map((tracker) => ({ label: tracker.label, mileage: data.mileage?.[tracker.id]?.['2026-04-02']?.mileage ?? data.mileage?.[tracker.id]?.['2026-04-01']?.mileage ?? 0 })).sort((a, b) => b.mileage - a.mileage)
      return res.json({ question: q, answer: ranked.slice(0, 5) })
    }

    return res.json({ question: q, answer: 'Question non encore modélisée dans C3' })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/fleeti/live', async (_req, res) => {
  try {
    const data = await getDashboardData(true)
    res.json({
      timestamp: new Date().toISOString(),
      trackers: (data.trackers ?? []).map((tracker) => ({
        id: tracker.id,
        label: tracker.label,
        status: data.states?.[tracker.id]?.connection_status ?? 'unknown',
        movement: data.states?.[tracker.id]?.movement_status ?? 'unknown',
        speed: data.states?.[tracker.id]?.gps?.speed ?? 0,
        location: data.states?.[tracker.id]?.gps?.location ?? null,
      })),
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/delivery-orders', (_req, res) => {
  res.json({ items: readDeliveryOrders() })
})

app.get('/api/delivery-orders/:trackerId', (req, res) => {
  const trackerId = Number(req.params.trackerId)
  const items = readDeliveryOrders().filter((item) => Number(item.trackerId) === trackerId)
  res.json({ items })
})

app.get('/api/delivery-order/:id', (req, res) => {
  const id = Number(req.params.id)
  const item = readDeliveryOrders().find((entry) => Number(entry.id) === id)
  if (!item) return res.status(404).json({ ok: false, error: 'Bon introuvable' })
  res.json({ item })
})

app.post('/api/delivery-orders', (req, res) => {
  const items = readDeliveryOrders()
  const payload = {
    id: Date.now(),
    trackerId: Number(req.body.trackerId),
    truckLabel: req.body.truckLabel || '',
    driver: req.body.driver || '',
    reference: req.body.reference || '',
    client: req.body.client || '',
    loadingPoint: req.body.loadingPoint || '',
    destination: req.body.destination || '',
    goods: req.body.goods || '',
    quantity: req.body.quantity || '',
    status: req.body.status || 'Prévu',
    date: req.body.date || new Date().toISOString(),
    notes: req.body.notes || '',
    active: req.body.active !== false,
  }
  const normalized = items.map((item) => Number(item.trackerId) === Number(payload.trackerId) && payload.active ? { ...item, active: false } : item)
  normalized.unshift(payload)
  writeDeliveryOrders(normalized)
  res.status(201).json({ ok: true, item: payload })
})

app.patch('/api/delivery-orders/:id', (req, res) => {
  const id = Number(req.params.id)
  const items = readDeliveryOrders()
  const current = items.find((item) => Number(item.id) === id)
  if (!current) return res.status(404).json({ ok: false, error: 'Bon introuvable' })

  const updatedItems = items.map((item) => {
    if (Number(item.id) !== id) {
      if (req.body.active && Number(item.trackerId) === Number(current.trackerId)) {
        return { ...item, active: false }
      }
      return item
    }
    return { ...item, ...req.body }
  })

  writeDeliveryOrders(updatedItems)
  res.json({ ok: true, item: updatedItems.find((item) => Number(item.id) === id) })
})

app.delete('/api/delivery-orders/:id', (req, res) => {
  const id = Number(req.params.id)
  const items = readDeliveryOrders()
  const filtered = items.filter((item) => Number(item.id) !== id)
  writeDeliveryOrders(filtered)
  res.json({ ok: true })
})

app.get('/api/reports', async (_req, res) => {
  try {
    const data = await getDashboardData()
    const hash = await authenticate()
    const rows = await Promise.all((data.trackers ?? []).map(async (tracker) => {
      const state = data.states?.[tracker.id] ?? {}
      const employee = (data.employees ?? []).find((item) => item.tracker_id === tracker.id)
      const history = (data.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const distance = data.mileage?.[tracker.id]?.['2026-04-02']?.mileage ?? data.mileage?.[tracker.id]?.['2026-04-01']?.mileage ?? 0
      const speed = state?.gps?.speed ?? 0
      const inactivityHours = history.filter((event) => event.event === 'excessive_parking').length * 1.5
      const tripCount = Math.max(history.filter((event) => event.event === 'speedup').length, 1)
      const fuelSensors = await getFuelSensorInfo(hash, tracker.id)
      const preferredFuelSensor = fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_consumption')) || fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_fuel_litres')) || fuelSensors[0]
      const fuelValue = preferredFuelSensor ? `Capteur détecté: ${preferredFuelSensor.name}` : 'N/A'

      return {
        immatriculation: tracker.label,
        conducteur: employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Non assigné',
        trajets: tripCount,
        distanceKm: Number(distance.toFixed?.(1) ? distance.toFixed(1) : distance),
        tempsTrajetH: Number((distance / 45).toFixed(2)),
        inactiviteH: Number(inactivityHours.toFixed(2)),
        vitesseMoy: Math.round(speed || 0),
        vitesseMax: Math.max(Math.round(speed || 0), 80),
        carburantL: fuelValue,
        inactiviteParTrajet: Number((inactivityHours / tripCount).toFixed(2)),
      }
    }))

    const summary = {
      trajetsTotal: rows.reduce((sum, row) => sum + row.trajets, 0),
      distanceTotaleKm: Number(rows.reduce((sum, row) => sum + row.distanceKm, 0).toFixed(1)),
      tempsTrajetTotalH: Number(rows.reduce((sum, row) => sum + row.tempsTrajetH, 0).toFixed(2)),
      tempsInactiviteTotalH: Number(rows.reduce((sum, row) => sum + row.inactiviteH, 0).toFixed(2)),
      vitesseMoyenneFlotte: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.vitesseMoy, 0) / rows.length) : 0,
      vitesseMaxFlotte: rows.length ? Math.max(...rows.map((row) => row.vitesseMax)) : 0,
      carburantTotalL: rows.some((row) => row.carburantL !== 'N/A') ? 'Mesure numérique indisponible via API actuelle' : 'N/A',
    }

    res.json({ summary, rows })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.use((req, res, next) => {
  console.log(`[route] ${req.method} ${req.url}`)
  next()
})

app.listen(PORT, () => {
  console.log(`Teliman Tracking Fleeti API running on http://localhost:${PORT}`)
})
