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
const FUEL_VOUCHERS_FILE = path.join(__dirname, 'fuel-vouchers.json')
const MASTER_DATA_FILE = path.join(__dirname, 'master-data.json')

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
  const fallbackOrigins = [
    'https://teliman-tracking-fleeti.vercel.app',
    'https://www.telimanlogistique.com',
    'https://telimanlogistique.com',
  ]
  const allowedOrigins = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : fallbackOrigins

  function isAllowedOrigin(origin) {
    if (allowedOrigins.includes(origin)) return true
    try {
      const url = new URL(origin)
      const host = url.hostname.toLowerCase()
      if (host === 'teliman-tracking-fleeti.vercel.app') return true
      if (host.endsWith('.vercel.app') && host.includes('teliman-tracking-fleeti')) return true
      if (host === 'telimanlogistique.com' || host === 'www.telimanlogistique.com') return true
      return false
    } catch {
      return false
    }
  }

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (isAllowedOrigin(origin)) return callback(null, true)
      return callback(new Error(`Origin not allowed by CORS: ${origin}`))
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
    if (Number.isFinite(value) && value > 0) return value
  }

  const datedEntries = Object.entries(mileageByDay)
    .map(([key, row]) => ({
      key,
      mileage: Number(row?.mileage),
      ts: Date.parse(`${key}T00:00:00Z`),
    }))
    .filter((entry) => Number.isFinite(entry.mileage))
    .sort((a, b) => b.ts - a.ts)

  const latestPositive = datedEntries.find((entry) => entry.mileage > 0)
  if (latestPositive) return latestPositive.mileage

  return datedEntries[0]?.mileage || 0
}

function getAlertSeverity(eventType) {
  if (eventType === 'speedup') return 'Critique'
  if (eventType === 'fuel_level_leap') return 'Surveillance'
  if (eventType === 'excessive_parking') return 'Exploitation'
  return 'Info'
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

function readFuelVouchers() {
  try {
    return JSON.parse(fs.readFileSync(FUEL_VOUCHERS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeFuelVouchers(rows) {
  fs.writeFileSync(FUEL_VOUCHERS_FILE, JSON.stringify(rows, null, 2))
}

function readMasterData() {
  try {
    const payload = JSON.parse(fs.readFileSync(MASTER_DATA_FILE, 'utf8'))
    return {
      clients: Array.isArray(payload.clients) ? payload.clients : [],
      goods: Array.isArray(payload.goods) ? payload.goods : [],
      destinations: Array.isArray(payload.destinations) ? payload.destinations : [],
    }
  } catch {
    return { clients: [], goods: [], destinations: [] }
  }
}

function writeMasterData(data) {
  const payload = {
    clients: Array.from(new Set((data.clients || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    goods: Array.from(new Set((data.goods || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    destinations: Array.from(new Set((data.destinations || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
  }
  fs.writeFileSync(MASTER_DATA_FILE, JSON.stringify(payload, null, 2))
}

function ensureValidTrackerId(value) {
  const trackerId = Number(value)
  return Number.isInteger(trackerId) && trackerId > 0 ? trackerId : null
}

function sanitizeFuelVoucherPayload(body = {}, current = null) {
  const trackerId = ensureValidTrackerId(body.trackerId ?? current?.trackerId)
  if (!trackerId) throw new Error('trackerId invalide')

  const quantityLiters = Number(String(body.quantityLiters ?? current?.quantityLiters ?? '').replace(',', '.'))
  const unitPrice = Number(String(body.unitPrice ?? current?.unitPrice ?? '').replace(',', '.'))
  if (!Number.isFinite(quantityLiters) || quantityLiters <= 0) throw new Error('Quantité invalide')
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Prix unitaire invalide')

  const amount = Number((quantityLiters * unitPrice).toFixed(2))

  return {
    id: current?.id || Date.now(),
    trackerId,
    truckLabel: String(body.truckLabel ?? current?.truckLabel ?? '').trim(),
    driver: String(body.driver ?? current?.driver ?? '').trim(),
    voucherNumber: String(body.voucherNumber ?? current?.voucherNumber ?? '').trim(),
    dateTime: body.dateTime || current?.dateTime || new Date().toISOString(),
    quantityLiters,
    unitPrice,
    amount,
    createdAt: current?.createdAt || new Date().toISOString(),
  }
}

function sanitizeProofPhotoDataUrl(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim()
  if (!raw) return ''
  const isAllowed = /^data:image\/(png|jpe?g|webp);base64,/i.test(raw)
  if (!isAllowed) throw new Error('Format photo invalide (png, jpg, jpeg, webp)')
  // ~5MB max encoded payload
  if (raw.length > 7_000_000) throw new Error('Photo trop volumineuse (max 5MB)')
  return raw
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
    departureDateTime: body.departureDateTime || current?.departureDateTime || null,
    arrivalDateTime: body.arrivalDateTime || current?.arrivalDateTime || null,
    notes: String(body.notes ?? current?.notes ?? '').trim(),
    active: body.active ?? current?.active ?? true,
    completedAt: body.status === 'Livré' ? (body.completedAt || current?.completedAt || new Date().toISOString()) : (body.completedAt ?? current?.completedAt ?? null),
    proofNote: String(body.proofNote ?? current?.proofNote ?? '').trim(),
    proofStatus: String(body.proofStatus ?? current?.proofStatus ?? 'En attente').trim(),
    proofPhotoDataUrl: sanitizeProofPhotoDataUrl(body.proofPhotoDataUrl, current?.proofPhotoDataUrl),
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

function parseReportFilters(query = {}) {
  return {
    period: String(query.period || '48h'),
    trackerId: ensureValidTrackerId(query.trackerId),
    driver: String(query.driver || '').trim().toLowerCase(),
    status: String(query.status || '').trim().toLowerCase(),
    eventType: String(query.eventType || '').trim().toLowerCase(),
    client: String(query.client || '').trim().toLowerCase(),
    destination: String(query.destination || '').trim().toLowerCase(),
    goods: String(query.goods || '').trim().toLowerCase(),
    project: String(query.project || '').trim().toLowerCase(),
    targetQuantity: Number(String(query.targetQuantity || '').replace(',', '.')) || 0,
    pivotRows: String(query.pivotRows || 'tracker').trim().toLowerCase(),
    pivotCols: String(query.pivotCols || 'event').trim().toLowerCase(),
    metric: String(query.metric || 'count').trim().toLowerCase(),
  }
}

function buildLookupMaps(data) {
  const employeesByTracker = Object.fromEntries((data.employees ?? []).map((employee) => [Number(employee.tracker_id), employee]))
  const trackersById = Object.fromEntries((data.trackers ?? []).map((tracker) => [Number(tracker.id), tracker]))
  return { employeesByTracker, trackersById }
}

function buildReportDataset(data, filters = {}) {
  const preferredKeys = [data.dateKeys?.todayKey, data.dateKeys?.yesterdayKey].filter(Boolean)
  const { employeesByTracker } = buildLookupMaps(data)
  const deliveryOrders = readDeliveryOrders()

  const trackerRows = (data.trackers ?? []).map((tracker) => {
    const state = data.states?.[tracker.id] ?? {}
    const employee = employeesByTracker[tracker.id]
    const history = (data.history ?? []).filter((event) => Number(event.tracker_id) === Number(tracker.id))
    const distance = pickMileageValue(data.mileage?.[tracker.id] ?? {}, preferredKeys)
    const speed = Number(state?.gps?.speed ?? 0)
    const inactivityHours = history.filter((event) => event.event === 'excessive_parking').length * 1.5
    const tripCount = Math.max(history.filter((event) => event.event === 'speedup').length, history.length ? 1 : 0)
    const driverName = employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Non assigné'
    const activeMission = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active)
    return {
      trackerId: Number(tracker.id),
      immatriculation: tracker.label,
      trackerLabel: tracker.label,
      model: tracker.model || 'Modèle inconnu',
      conducteur: driverName,
      driverName,
      phone: employee?.phone || 'N/A',
      status: state?.connection_status || 'unknown',
      movementStatus: state?.movement_status || 'unknown',
      speed,
      speedMax: Math.max(speed, ...history.map((event) => Number(event.speed || 0)).filter(Number.isFinite), 0),
      alertCount: history.length,
      trajets: tripCount,
      distanceKm: Number(distance.toFixed?.(1) ? distance.toFixed(1) : distance),
      tempsTrajetH: Number((distance / 45).toFixed(2)),
      inactiviteH: Number(inactivityHours.toFixed(2)),
      inactiviteParTrajet: Number((inactivityHours / Math.max(tripCount, 1)).toFixed(2)),
      activeMission: activeMission || null,
      lastUpdate: state?.last_update || null,
      location: state?.gps?.location || null,
      batteryLevel: state?.battery_level ?? null,
      rawState: state,
      rawTracker: tracker,
    }
  })

  const filteredTrackerRows = trackerRows.filter((row) => {
    if (filters.trackerId && Number(row.trackerId) !== Number(filters.trackerId)) return false
    if (filters.driver && !String(row.driverName || '').toLowerCase().includes(filters.driver)) return false
    if (filters.status && String(row.status || '').toLowerCase() !== filters.status) return false
    if (filters.client && !String(row.activeMission?.client || '').toLowerCase().includes(filters.client)) return false
    if (filters.destination && !String(row.activeMission?.destination || '').toLowerCase().includes(filters.destination)) return false
    return true
  })

  const allowedTrackerIds = new Set(filteredTrackerRows.map((row) => Number(row.trackerId)))

  const alertRows = (data.history ?? [])
    .filter((event) => allowedTrackerIds.has(Number(event.tracker_id)))
    .map((event, index) => {
      const trackerRow = filteredTrackerRows.find((row) => Number(row.trackerId) === Number(event.tracker_id))
      return {
        id: `${event.tracker_id}-${event.time}-${index}`,
        trackerId: Number(event.tracker_id),
        immatriculation: trackerRow?.trackerLabel || event.label || event.extra?.tracker_label || `Tracker ${event.tracker_id}`,
        conducteur: trackerRow?.driverName || 'Non assigné',
        eventType: event.event || 'unknown',
        severity: getAlertSeverity(event.event),
        message: event.message || 'Événement sans description',
        address: event.address || 'Adresse indisponible',
        time: event.time,
        date: event.time ? String(event.time).slice(0, 10) : null,
        raw: event,
      }
    })
    .filter((row) => !filters.eventType || String(row.eventType).toLowerCase() === filters.eventType)

  const missionRows = deliveryOrders
    .map((item) => {
      const trackerRow = trackerRows.find((row) => Number(row.trackerId) === Number(item.trackerId))
      return {
        id: Number(item.id),
        trackerId: Number(item.trackerId),
        immatriculation: item.truckLabel || trackerRow?.trackerLabel || `Tracker ${item.trackerId}`,
        conducteur: item.driver || trackerRow?.driverName || 'Non assigné',
        reference: item.reference || '',
        client: item.client || '',
        destination: item.destination || '',
        loadingPoint: item.loadingPoint || '',
        goods: item.goods || '',
        quantity: item.quantity || '',
        status: item.status || 'Prévu',
        active: Boolean(item.active),
        date: item.date || null,
        departureDateTime: item.departureDateTime || null,
        arrivalDateTime: item.arrivalDateTime || null,
        completedAt: item.completedAt || null,
        proofStatus: item.proofStatus || 'En attente',
        proofNote: item.proofNote || '',
      }
    })
    .filter((row) => !filters.trackerId || Number(row.trackerId) === Number(filters.trackerId))
    .filter((row) => !filters.driver || String(row.conducteur).toLowerCase().includes(filters.driver))
    .filter((row) => !filters.client || String(row.client).toLowerCase().includes(filters.client))
    .filter((row) => !filters.project || String(row.client).toLowerCase().includes(filters.project) || String(row.destination).toLowerCase().includes(filters.project))
    .filter((row) => !filters.destination || String(row.destination).toLowerCase().includes(filters.destination))
    .filter((row) => !filters.goods || String(row.goods).toLowerCase().includes(filters.goods))
    .filter((row) => !filters.status || String(row.status).toLowerCase() === filters.status)

  return { trackerRows: filteredTrackerRows, alertRows, missionRows, preferredKeys }
}

function toNumber(value) {
  return Number(String(value ?? '0').replace(',', '.')) || 0
}

function formatDateKey(value) {
  if (!value) return 'Sans date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sans date'
  return date.toISOString().slice(0, 10)
}

function diffHours(start, end) {
  if (!start || !end) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  return Number(((endDate.getTime() - startDate.getTime()) / 3600000).toFixed(2))
}

function buildBusinessReports(missionRows = [], fleetRows = []) {
  const detailed = missionRows.map((row) => ({
    reference: row.reference,
    camion: row.immatriculation,
    chauffeur: row.conducteur,
    client: row.client,
    destination: row.destination,
    marchandise: row.goods,
    quantite: row.quantity,
    depart: row.departureDateTime || null,
    arrivee: row.arrivalDateTime || null,
    statut: row.status,
    date: row.date,
    actif: row.active,
    preuve: row.proofStatus,
  }))

  const byClient = Object.values(missionRows.reduce((acc, row) => {
    const key = row.client || 'Non renseigné'
    acc[key] ||= { client: key, bons: 0, quantite: 0, actifs: 0, livres: 0 }
    acc[key].bons += 1
    acc[key].quantite += toNumber(row.quantity)
    acc[key].actifs += row.active ? 1 : 0
    acc[key].livres += row.status === 'Livré' ? 1 : 0
    return acc
  }, {})).sort((a, b) => b.bons - a.bons)

  const byGoods = Object.values(missionRows.reduce((acc, row) => {
    const key = row.goods || 'Non renseigné'
    acc[key] ||= { marchandise: key, bons: 0, quantite: 0, clients: new Set(), destinations: new Set() }
    acc[key].bons += 1
    acc[key].quantite += toNumber(row.quantity)
    if (row.client) acc[key].clients.add(row.client)
    if (row.destination) acc[key].destinations.add(row.destination)
    return acc
  }, {})).map((row) => ({
    ...row,
    clients: row.clients.size,
    destinations: row.destinations.size,
  })).sort((a, b) => b.bons - a.bons)

  const byTruck = Object.values(missionRows.reduce((acc, row) => {
    const key = row.immatriculation || 'Non renseigné'
    acc[key] ||= { camion: key, chauffeur: row.conducteur || 'Non assigné', bons: 0, quantite: 0, actifs: 0, livres: 0, destinations: new Set() }
    acc[key].bons += 1
    acc[key].quantite += toNumber(row.quantity)
    acc[key].actifs += row.active ? 1 : 0
    acc[key].livres += row.status === 'Livré' ? 1 : 0
    if (row.destination) acc[key].destinations.add(row.destination)
    return acc
  }, {})).map((row) => ({
    ...row,
    destinations: row.destinations.size,
  })).sort((a, b) => b.bons - a.bons)

  const byDestination = Object.values(missionRows.reduce((acc, row) => {
    const key = row.destination || 'Non renseigné'
    acc[key] ||= { destination: key, bons: 0, quantite: 0, clients: new Set(), camions: new Set(), livres: 0 }
    acc[key].bons += 1
    acc[key].quantite += toNumber(row.quantity)
    if (row.client) acc[key].clients.add(row.client)
    if (row.immatriculation) acc[key].camions.add(row.immatriculation)
    acc[key].livres += row.status === 'Livré' ? 1 : 0
    return acc
  }, {})).map((row) => ({
    ...row,
    clients: row.clients.size,
    camions: row.camions.size,
  })).sort((a, b) => b.quantite - a.quantite)

  const performanceByDriver = Object.values(missionRows.reduce((acc, row) => {
    const key = row.conducteur || 'Non assigné'
    const durationH = diffHours(row.departureDateTime, row.arrivalDateTime)
    acc[key] ||= { chauffeur: key, rotations: 0, quantite: 0, livres: 0, camions: new Set(), clients: new Set(), dureeTotaleH: 0, dureeCount: 0 }
    acc[key].rotations += 1
    acc[key].quantite += toNumber(row.quantity)
    acc[key].livres += row.status === 'Livré' ? 1 : 0
    if (row.immatriculation) acc[key].camions.add(row.immatriculation)
    if (row.client) acc[key].clients.add(row.client)
    if (durationH !== null && durationH >= 0) {
      acc[key].dureeTotaleH += durationH
      acc[key].dureeCount += 1
    }
    return acc
  }, {})).map((row) => ({
    chauffeur: row.chauffeur,
    rotations: row.rotations,
    quantite: Number(row.quantite.toFixed(2)),
    livres: row.livres,
    camions: row.camions.size,
    clients: row.clients.size,
    dureeMoyenneH: row.dureeCount ? Number((row.dureeTotaleH / row.dureeCount).toFixed(2)) : null,
  })).sort((a, b) => b.rotations - a.rotations)

  const performanceByDay = Object.values(missionRows.reduce((acc, row) => {
    const key = formatDateKey(row.departureDateTime || row.date || row.arrivalDateTime)
    acc[key] ||= { date: key, rotations: 0, quantite: 0, livres: 0, clients: new Set(), destinations: new Set() }
    acc[key].rotations += 1
    acc[key].quantite += toNumber(row.quantity)
    acc[key].livres += row.status === 'Livré' ? 1 : 0
    if (row.client) acc[key].clients.add(row.client)
    if (row.destination) acc[key].destinations.add(row.destination)
    return acc
  }, {})).map((row) => ({
    date: row.date,
    rotations: row.rotations,
    quantite: Number(row.quantite.toFixed(2)),
    livres: row.livres,
    clients: row.clients.size,
    destinations: row.destinations.size,
  })).sort((a, b) => a.date.localeCompare(b.date))

  const fuelSummary = (fleetRows || []).map((row) => ({
    camion: row.immatriculation,
    chauffeur: row.conducteur,
    statut: row.status,
    distanceKm: row.distanceKm,
    trajets: row.trajets,
    carburant: row.carburantL,
  })).sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))

  const batches = Object.values(missionRows.reduce((acc, row) => {
    const key = row.goods || 'Non renseigné'
    acc[key] ||= { produit: key, quantiteLivree: 0, rotations: 0, camions: new Set(), clients: new Set() }
    acc[key].quantiteLivree += toNumber(row.quantity)
    acc[key].rotations += 1
    if (row.immatriculation) acc[key].camions.add(row.immatriculation)
    if (row.client) acc[key].clients.add(row.client)
    return acc
  }, {})).map((row) => ({
    produit: row.produit,
    quantiteLivree: Number(row.quantiteLivree.toFixed(2)),
    rotations: row.rotations,
    camions: row.camions.size,
    clients: row.clients.size,
  })).sort((a, b) => b.quantiteLivree - a.quantiteLivree)

  const projects = Object.values(missionRows.reduce((acc, row) => {
    const key = row.client || row.destination || 'Non renseigné'
    acc[key] ||= { projet: key, client: row.client || 'Non renseigné', destination: row.destination || 'Non renseigné', bons: 0, quantiteLivree: 0, camions: new Set(), chauffeurs: new Set(), marchandises: new Set() }
    acc[key].bons += 1
    acc[key].quantiteLivree += toNumber(row.quantity)
    if (row.immatriculation) acc[key].camions.add(row.immatriculation)
    if (row.conducteur) acc[key].chauffeurs.add(row.conducteur)
    if (row.goods) acc[key].marchandises.add(row.goods)
    return acc
  }, {})).map((row) => ({
    projet: row.projet,
    client: row.client,
    destination: row.destination,
    bons: row.bons,
    quantiteLivree: Number(row.quantiteLivree.toFixed(2)),
    camions: row.camions.size,
    chauffeurs: row.chauffeurs.size,
    marchandises: row.marchandises.size,
  })).sort((a, b) => b.quantiteLivree - a.quantiteLivree)

  return { detailed, byClient, byGoods, byTruck, byDestination, performanceByDriver, performanceByDay, fuelSummary, batches, projects }
}

function buildFleetSummary(rows = []) {
  return {
    totalVehicles: rows.length,
    activeVehicles: rows.filter((row) => row.status === 'active').length,
    offlineVehicles: rows.filter((row) => row.status === 'offline').length,
    movingVehicles: rows.filter((row) => row.movementStatus === 'moving').length,
    totalTrips: rows.reduce((sum, row) => sum + (row.trajets || 0), 0),
    totalDistanceKm: Number(rows.reduce((sum, row) => sum + (row.distanceKm || 0), 0).toFixed(1)),
    totalInactivityH: Number(rows.reduce((sum, row) => sum + (row.inactiviteH || 0), 0).toFixed(2)),
    averageSpeed: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.speed || 0), 0) / rows.length) : 0,
    maxSpeed: rows.length ? Math.max(...rows.map((row) => row.speedMax || 0)) : 0,
    activeMissions: rows.filter((row) => row.activeMission).length,
  }
}

function buildPivotTable({ trackerRows = [], alertRows = [], missionRows = [] }, filters = {}) {
  const rowsKey = filters.pivotRows || 'tracker'
  const colsKey = filters.pivotCols || 'event'
  const metric = filters.metric || 'count'

  const source = colsKey === 'status' || rowsKey === 'status' || metric === 'distance' ? trackerRows : alertRows.length ? alertRows : missionRows

  const pickDimension = (item, key) => {
    if (key === 'tracker') return item.immatriculation || item.trackerLabel || 'N/A'
    if (key === 'driver') return item.conducteur || item.driverName || 'Non assigné'
    if (key === 'event') return item.eventType || 'N/A'
    if (key === 'status') return item.status || 'N/A'
    if (key === 'destination') return item.destination || 'N/A'
    if (key === 'client') return item.client || 'N/A'
    if (key === 'date') return item.date || (item.time ? String(item.time).slice(0, 10) : 'N/A')
    return item[key] || 'N/A'
  }

  const matrix = new Map()
  const rowLabels = new Set()
  const colLabels = new Set()

  source.forEach((item) => {
    const rowLabel = pickDimension(item, rowsKey)
    const colLabel = pickDimension(item, colsKey)
    rowLabels.add(rowLabel)
    colLabels.add(colLabel)
    const key = `${rowLabel}:::${colLabel}`
    const previous = matrix.get(key) || 0
    const increment = metric === 'distance' ? Number(item.distanceKm || 0) : 1
    matrix.set(key, previous + increment)
  })

  const columns = Array.from(colLabels)
  const rows = Array.from(rowLabels).map((label) => {
    const values = Object.fromEntries(columns.map((column) => [column, Number((matrix.get(`${label}:::${column}`) || 0).toFixed?.(1) ? (matrix.get(`${label}:::${column}`) || 0).toFixed(1) : (matrix.get(`${label}:::${column}`) || 0))]))
    const total = Object.values(values).reduce((sum, value) => sum + Number(value || 0), 0)
    return { label, values, total: Number(total.toFixed?.(1) ? total.toFixed(1) : total) }
  })

  return { rowsKey, colsKey, metric, columns, rows }
}

async function buildReportsPayload(filters = {}) {
  const data = await getDashboardData(filters.forceRefresh === true)
  const dataset = buildReportDataset(data, filters)
  const includeFuelSensors = filters.includeFuelSensors === true

  let hash = null
  if (includeFuelSensors && dataset.trackerRows.length) {
    hash = await authenticate()
  }

  const fleetRows = await Promise.all(dataset.trackerRows.map(async (row) => {
    let carburantL = 'N/A'
    if (includeFuelSensors && hash) {
      const fuelSensors = await getFuelSensorInfo(hash, row.trackerId)
      const preferredFuelSensor = fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_consumption')) || fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_fuel_litres')) || fuelSensors[0]
      carburantL = preferredFuelSensor ? `Capteur détecté: ${preferredFuelSensor.name}` : 'N/A'
    }

    return {
      ...row,
      carburantL,
      vitesseMoy: Math.round(row.speed || 0),
      vitesseMax: Math.round(row.speedMax || 0),
    }
  }))

  const fleetSummary = buildFleetSummary(fleetRows)
  const alertsSummary = {
    totalAlerts: dataset.alertRows.length,
    criticalAlerts: dataset.alertRows.filter((row) => row.severity === 'Critique').length,
    surveillanceAlerts: dataset.alertRows.filter((row) => row.severity === 'Surveillance').length,
    exploitationAlerts: dataset.alertRows.filter((row) => row.severity === 'Exploitation').length,
    byType: dataset.alertRows.reduce((acc, row) => {
      acc[row.eventType] = (acc[row.eventType] || 0) + 1
      return acc
    }, {}),
  }
  const missionsSummary = {
    totalMissions: dataset.missionRows.length,
    activeMissions: dataset.missionRows.filter((row) => row.active).length,
    deliveredMissions: dataset.missionRows.filter((row) => row.status === 'Livré').length,
    pendingProofs: dataset.missionRows.filter((row) => row.proofStatus === 'En attente').length,
    byStatus: dataset.missionRows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1
      return acc
    }, {}),
  }

  return {
    filters,
    generatedAt: new Date().toISOString(),
    summary: {
      trajetsTotal: fleetSummary.totalTrips,
      distanceTotaleKm: fleetSummary.totalDistanceKm,
      tempsTrajetTotalH: Number(fleetRows.reduce((sum, row) => sum + (row.tempsTrajetH || 0), 0).toFixed(2)),
      tempsInactiviteTotalH: fleetSummary.totalInactivityH,
      vitesseMoyenneFlotte: fleetSummary.averageSpeed,
      vitesseMaxFlotte: fleetSummary.maxSpeed,
      carburantTotalL: fleetRows.some((row) => row.carburantL !== 'N/A') ? 'Mesure numérique indisponible via API actuelle' : 'N/A',
    },
    fleet: { summary: fleetSummary, rows: fleetRows },
    alerts: { summary: alertsSummary, rows: dataset.alertRows },
    missions: { summary: missionsSummary, rows: dataset.missionRows },
    business: buildBusinessReports(dataset.missionRows, fleetRows),
    pivot: buildPivotTable({ trackerRows: fleetRows, alertRows: dataset.alertRows, missionRows: dataset.missionRows }, filters),
  }
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

app.get('/api/master-data', (_req, res) => {
  res.json(readMasterData())
})

app.post('/api/master-data/:listName', (req, res) => {
  const listName = String(req.params.listName || '')
  if (!['clients', 'goods', 'destinations'].includes(listName)) return res.status(400).json({ ok: false, error: 'Liste invalide' })

  const value = String(req.body?.value || '').trim()
  if (!value) return res.status(400).json({ ok: false, error: 'Valeur obligatoire' })

  const data = readMasterData()
  data[listName] = Array.from(new Set([...(data[listName] || []), value]))
  writeMasterData(data)
  res.status(201).json({ ok: true, data })
})

app.delete('/api/master-data/:listName', (req, res) => {
  const listName = String(req.params.listName || '')
  if (!['clients', 'goods', 'destinations'].includes(listName)) return res.status(400).json({ ok: false, error: 'Liste invalide' })

  const value = String(req.query.value || '').trim()
  if (!value) return res.status(400).json({ ok: false, error: 'Valeur obligatoire' })

  const data = readMasterData()
  data[listName] = (data[listName] || []).filter((item) => item !== value)
  writeMasterData(data)
  res.json({ ok: true, data })
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

app.get('/api/fuel-vouchers', (_req, res) => {
  res.json({ items: readFuelVouchers() })
})

app.post('/api/fuel-vouchers', (req, res) => {
  try {
    const items = readFuelVouchers()
    const payload = sanitizeFuelVoucherPayload(req.body)
    items.unshift(payload)
    writeFuelVouchers(items)
    res.status(201).json({ ok: true, item: payload })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
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

app.get('/api/reports', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: true }
    const payload = await buildReportsPayload(filters)
    const rows = payload.fleet.rows.map((row) => ({
      immatriculation: row.immatriculation,
      conducteur: row.conducteur,
      trajets: row.trajets,
      distanceKm: row.distanceKm,
      tempsTrajetH: row.tempsTrajetH,
      inactiviteH: row.inactiviteH,
      vitesseMoy: row.vitesseMoy,
      vitesseMax: row.vitesseMax,
      carburantL: row.carburantL,
      inactiviteParTrajet: row.inactiviteParTrajet,
    }))
    res.json({ summary: payload.summary, rows })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/summary', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ summary: payload.summary, fleet: payload.fleet.summary, alerts: payload.alerts.summary, missions: payload.missions.summary, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/fleet', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: true }
    const payload = await buildReportsPayload(filters)
    res.json({ summary: payload.fleet.summary, rows: payload.fleet.rows, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/alerts', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ summary: payload.alerts.summary, rows: payload.alerts.rows, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/missions', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ summary: payload.missions.summary, rows: payload.missions.rows, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/pivot', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ pivot: payload.pivot, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/detailed-deliveries', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.detailed, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/by-client', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.byClient, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/by-goods', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.byGoods, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/by-truck', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.byTruck, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/by-destination', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.byDestination, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/performance-drivers', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.performanceByDriver, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/performance-days', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.performanceByDay, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/fuel-summary', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: true }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.fuelSummary, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/batches', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    const targetQuantity = Number(filters.targetQuantity || 0)
    const rows = payload.business.batches.map((row) => ({
      ...row,
      objectif: targetQuantity > 0 ? targetQuantity : null,
      restant: targetQuantity > 0 ? Number(Math.max(targetQuantity - Number(row.quantiteLivree || 0), 0).toFixed(2)) : null,
      completion: targetQuantity > 0 ? Number(((Number(row.quantiteLivree || 0) / targetQuantity) * 100).toFixed(2)) : null,
    }))
    res.json({ rows, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.get('/api/reports/projects', async (req, res) => {
  try {
    const filters = { ...parseReportFilters(req.query), includeFuelSensors: false }
    const payload = await buildReportsPayload(filters)
    res.json({ rows: payload.business.projects, generatedAt: payload.generatedAt, filters: payload.filters })
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Teliman Tracking Fleeti API running on http://localhost:${PORT}`)
})
