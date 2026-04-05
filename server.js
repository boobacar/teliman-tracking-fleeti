import crypto from 'crypto'
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

const PORT = Number(process.env.PORT || 8787)
const API_BASE = process.env.FLEETI_API_BASE
const LOGIN = process.env.FLEETI_LOGIN
const PASSWORD = process.env.FLEETI_PASSWORD
const DEALER_ID = Number(process.env.FLEETI_DEALER_ID || 0)
const LOCALE = process.env.FLEETI_LOCALE || 'fr'
const TRACKER_IDS = parseNumberList(process.env.FLEETI_TRACKER_IDS) || [3487533, 3487539, 3488325, 3488326, 3511635, 3537761, 3537762, 3537766]
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60 * 1000)
const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS)
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || ''
const REQUIRE_API_TOKEN = process.env.REQUIRE_API_TOKEN === 'true'

validateRequiredEnv()

const app = express()
let dashboardCache = { data: null, ts: 0 }

app.disable('x-powered-by')
app.use(cors(buildCorsOptions()))
app.use(express.json({ limit: '250kb' }))
app.use(requestLogger)
app.use(protectApi)

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseNumberList(value) {
  const items = parseCsv(value).map((item) => Number(item)).filter(Number.isFinite)
  return items.length ? items : null
}

function validateRequiredEnv() {
  const missing = []
  if (!API_BASE) missing.push('FLEETI_API_BASE')
  if (!LOGIN) missing.push('FLEETI_LOGIN')
  if (!PASSWORD) missing.push('FLEETI_PASSWORD')
  if (!DEALER_ID) missing.push('FLEETI_DEALER_ID')
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}

function buildCorsOptions() {
  if (!ALLOWED_ORIGINS.length) {
    return { origin: false }
  }

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
      return callback(new Error('Origin not allowed by CORS'))
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
  }
}

function requestLogger(req, _res, next) {
  console.log(`[route] ${req.method} ${req.url}`)
  next()
}

function secureCompare(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function protectApi(req, res, next) {
  if (!req.path.startsWith('/api/')) return next()
  if (!REQUIRE_API_TOKEN) return next()
  const providedToken = req.get('x-api-key') || req.query.api_key || ''
  if (INTERNAL_API_TOKEN && secureCompare(providedToken, INTERNAL_API_TOKEN)) return next()
  return res.status(401).json({ ok: false, error: 'Unauthorized' })
}

function getDateRange(period = '48h') {
  const now = new Date()
  const fromDate = new Date(now)

  if (period === '1h') fromDate.setHours(now.getHours() - 1)
  else if (period === '6h') fromDate.setHours(now.getHours() - 6)
  else if (period === '24h') fromDate.setHours(now.getHours() - 24)
  else if (period === 'today') fromDate.setHours(0, 0, 0, 0)
  else if (period === '7d') fromDate.setDate(now.getDate() - 7)
  else fromDate.setHours(now.getHours() - 48)

  return {
    from: formatApiDate(fromDate),
    to: formatApiDate(now),
    todayKey: formatDayKey(now),
    yesterdayKey: formatDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  }
}

function formatApiDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ')
}

function formatDayKey(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function pickMileageValue(mileageByDay = {}, preferredKeys = []) {
  for (const key of preferredKeys) {
    const value = Number(mileageByDay?.[key]?.mileage)
    if (Number.isFinite(value)) return value
  }

  const fallback = Object.entries(mileageByDay)
    .sort(([a], [b]) => String(b).localeCompare(String(a)))
    .map(([, row]) => Number(row?.mileage))
    .find(Number.isFinite)

  return fallback || 0
}

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

function ensureValidTrackerId(value) {
  const trackerId = Number(value)
  return Number.isInteger(trackerId) && trackerId > 0 ? trackerId : null
}

function sanitizeDeliveryOrderPayload(body = {}, current = null) {
  const trackerId = ensureValidTrackerId(body.trackerId ?? current?.trackerId)
  if (!trackerId) {
    throw new Error('trackerId invalide')
  }

  return {
    id: current?.id || Date.now(),
    trackerId,
    truckLabel: String(body.truckLabel ?? current?.truckLabel ?? '').trim(),
    driver: String(body.driver ?? current?.driver ?? '').trim(),
    reference: String(body.reference ?? current?.reference ?? '').trim(),
    client: String(body.client ?? current?.client ?? '').trim(),
    loadingPoint: String(body.loadingPoint ?? current?.loadingPoint ?? '').trim(),
    destination: String(body.destination ?? current?.destination ?? '').trim(),
    goods: String(body.goods ?? current?.goods ?? '').trim(),
    quantity: String(body.quantity ?? current?.quantity ?? '').trim(),
    status: String(body.status ?? current?.status ?? 'Prévu').trim(),
    date: body.date || current?.date || new Date().toISOString(),
    notes: String(body.notes ?? current?.notes ?? '').trim(),
    active: body.active ?? current?.active ?? true,
    completedAt: body.status === 'Livré' ? (body.completedAt || current?.completedAt || new Date().toISOString()) : (body.completedAt ?? current?.completedAt ?? null),
    proofNote: String(body.proofNote ?? current?.proofNote ?? '').trim(),
    proofStatus: String(body.proofStatus ?? current?.proofStatus ?? 'En attente').trim(),
  }
}

async function apiCall(endpoint, payload = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'NVX-ISO-DateTime': 'true' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
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
    return (sensors.list ?? []).filter((sensor) => {
      const text = JSON.stringify(sensor).toLowerCase()
      return text.includes('fuel') || text.includes('consum') || text.includes('carb')
    })
  } catch {
    return []
  }
}

async function getDashboardData(forceRefresh = false) {
  if (!forceRefresh && dashboardCache.data && Date.now() - dashboardCache.ts < CACHE_TTL_MS) {
    return dashboardCache.data
  }

  const { from, to, todayKey, yesterdayKey } = getDateRange('48h')
  const hash = await authenticate()
  const [trackers, states, employees, unreadCount, rules, tariffs, history, mileage] = await Promise.all([
    apiCall('tracker/list', { hash }),
    apiCall('tracker/get_states', { hash, trackers: TRACKER_IDS }),
    apiCall('employee/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/unread/count', { hash }).catch(() => ({ value: 0 })),
    apiCall('tracker/rule/list', { hash }).catch(() => ({ list: [] })),
    apiCall('tariff/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/tracker/list', { hash, trackers: TRACKER_IDS, from, to, limit: 200 }).catch(() => ({ list: [] })),
    apiCall('tracker/stats/mileage/read', { hash, trackers: TRACKER_IDS, from, to }).catch(() => ({ result: {} })),
  ])

  const payload = {
    trackers: sanitizeTrackers(trackers.list ?? []).filter((tracker) => TRACKER_IDS.includes(Number(tracker.id))),
    states: states.states ?? {},
    employees: sanitizeEmployees(employees.list ?? []),
    unreadCount: unreadCount.value ?? unreadCount.count ?? 0,
    rules: rules.list ?? [],
    tariffs: tariffs.list ?? [],
    history: sanitizeHistory(history.list ?? []),
    mileage: mileage.result ?? {},
    dateKeys: { todayKey, yesterdayKey },
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
    res.json({ trackers: data.trackers, states: data.states, mileage: data.mileage, dateKeys: data.dateKeys })
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
    const trackerId = ensureValidTrackerId(req.params.id)
    if (!trackerId) return res.status(400).json({ ok: false, error: 'Tracker invalide' })

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
      dateKeys: data.dateKeys,
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
    const preferredKeys = [data.dateKeys?.todayKey, data.dateKeys?.yesterdayKey].filter(Boolean)

    const enriched = trackers.map((tracker) => {
      const trackerHistory = history.filter((event) => event.tracker_id === tracker.id)
      const mileage = pickMileageValue(data.mileage?.[tracker.id] ?? {}, preferredKeys)
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
    res.json({
      offlineUnits: trackers.filter((tracker) => states?.[tracker.id]?.connection_status === 'offline').map((tracker) => tracker.label),
      movingUnits: trackers.filter((tracker) => states?.[tracker.id]?.movement_status === 'moving').map((tracker) => tracker.label),
      criticalAlerts: alerts.filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event)).slice(0, 10),
    })
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
    const preferredKeys = [data.dateKeys?.todayKey, data.dateKeys?.yesterdayKey].filter(Boolean)

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
      const ranked = trackers
        .map((tracker) => ({ label: tracker.label, mileage: pickMileageValue(data.mileage?.[tracker.id] ?? {}, preferredKeys) }))
        .sort((a, b) => b.mileage - a.mileage)
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
  const trackerId = ensureValidTrackerId(req.params.trackerId)
  if (!trackerId) return res.status(400).json({ ok: false, error: 'Tracker invalide' })
  const items = readDeliveryOrders().filter((item) => Number(item.trackerId) === trackerId)
  res.json({ items })
})

app.get('/api/delivery-order/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })
  const item = readDeliveryOrders().find((entry) => Number(entry.id) === id)
  if (!item) return res.status(404).json({ ok: false, error: 'Bon introuvable' })
  res.json({ item })
})

app.get('/api/delivery-orders-summary', (_req, res) => {
  const items = readDeliveryOrders()
  res.json({
    total: items.length,
    active: items.filter((item) => item.active).length,
    delivered: items.filter((item) => item.status === 'Livré').length,
    byTruck: items.reduce((acc, item) => {
      acc[item.truckLabel] = (acc[item.truckLabel] || 0) + 1
      return acc
    }, {}),
  })
})

app.post('/api/delivery-orders', (req, res) => {
  try {
    const items = readDeliveryOrders()
    const payload = sanitizeDeliveryOrderPayload(req.body)
    const normalized = items.map((item) => Number(item.trackerId) === Number(payload.trackerId) && payload.active ? { ...item, active: false } : item)
    normalized.unshift(payload)
    writeDeliveryOrders(normalized)
    res.status(201).json({ ok: true, item: payload })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.patch('/api/delivery-orders/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })

    const items = readDeliveryOrders()
    const current = items.find((item) => Number(item.id) === id)
    if (!current) return res.status(404).json({ ok: false, error: 'Bon introuvable' })

    const updatedItem = sanitizeDeliveryOrderPayload(req.body, current)
    const updatedItems = items.map((item) => {
      if (Number(item.id) !== id) {
        if (updatedItem.active && Number(item.trackerId) === Number(current.trackerId)) {
          return { ...item, active: false }
        }
        return item
      }
      return updatedItem
    })

    writeDeliveryOrders(updatedItems)
    res.json({ ok: true, item: updatedItem })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.delete('/api/delivery-orders/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })
  const items = readDeliveryOrders()
  const filtered = items.filter((item) => Number(item.id) !== id)
  writeDeliveryOrders(filtered)
  res.json({ ok: true })
})

async function readTrackBundle(hash, trackerId, from, to) {
  const [segments, points, events] = await Promise.all([
    apiCall('track/list', { hash, tracker_id: trackerId, from, to }).catch(() => ({ list: [] })),
    apiCall('track/read', { hash, tracker_id: trackerId, from, to }).catch(() => ({ list: [] })),
    apiCall('history/tracker/list', { hash, trackers: [trackerId], from, to, limit: 300 }).catch(() => ({ list: [] })),
  ])

  return {
    trackerId,
    from,
    to,
    segments: segments.list ?? [],
    points: points.list ?? [],
    events: events.list ?? [],
  }
}

app.get('/api/tracks', async (req, res) => {
  try {
    const trackerId = ensureValidTrackerId(req.query.trackerId)
    if (!trackerId) return res.status(400).json({ ok: false, error: 'Tracker invalide' })
    const from = req.query.from || getDateRange('1h').from
    const to = req.query.to || getDateRange('1h').to
    const hash = await authenticate()
    res.json(await readTrackBundle(hash, trackerId, from, to))
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.post('/api/tracks/batch', async (req, res) => {
  try {
    const trackerIds = Array.isArray(req.body.trackerIds) ? req.body.trackerIds.map((value) => ensureValidTrackerId(value)).filter(Boolean).slice(0, 8) : []
    if (!trackerIds.length) return res.status(400).json({ ok: false, error: 'Aucun tracker valide fourni' })

    const period = String(req.body.period || '1h')
    const range = getDateRange(period)
    const from = req.body.from || range.from
    const to = req.body.to || range.to
    const hash = await authenticate()
    const items = await Promise.all(trackerIds.map(async (trackerId) => {
      const bundle = await readTrackBundle(hash, trackerId, from, to).catch(() => ({ trackerId, from, to, segments: [], points: [], events: [] }))
      const points = bundle.points || []
      const lastTwoPoints = points.length >= 2 ? points.slice(-2) : []
      return { ...bundle, lastTwoPoints }
    }))
    res.json({ from, to, period, items })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports', async (_req, res) => {
  try {
    const data = await getDashboardData()
    const hash = await authenticate()
    const preferredKeys = [data.dateKeys?.todayKey, data.dateKeys?.yesterdayKey].filter(Boolean)

    const rows = await Promise.all((data.trackers ?? []).map(async (tracker) => {
      const state = data.states?.[tracker.id] ?? {}
      const employee = (data.employees ?? []).find((item) => item.tracker_id === tracker.id)
      const history = (data.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const distance = pickMileageValue(data.mileage?.[tracker.id] ?? {}, preferredKeys)
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

app.listen(PORT, () => {
  console.log(`Teliman Tracking Fleeti API running on http://localhost:${PORT}`)
})
