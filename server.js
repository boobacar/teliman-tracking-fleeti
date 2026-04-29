import crypto from 'crypto'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildTrackBundleFromTelemetryCache, chunkIds, fetchAllPublicAssets, isCameraLike, normalizeTrackEvent, normalizeTrackPoint, resolveScopedTrackerIds } from './src/backend/fleetiBackend.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = process.env.TELIMAN_DATA_DIR || __dirname
fs.mkdirSync(DATA_DIR, { recursive: true })
const DELIVERY_ORDERS_FILE = path.join(DATA_DIR, 'delivery-orders.json')
const FUEL_VOUCHERS_FILE = path.join(DATA_DIR, 'fuel-vouchers.json')
const MASTER_DATA_FILE = path.join(DATA_DIR, 'master-data.json')
const UPLOADS_BASE_DIR = process.env.TELIMAN_UPLOADS_DIR || path.join(DATA_DIR, 'uploads')
const UPLOADS_DIR = path.join(UPLOADS_BASE_DIR, 'delivery-proofs')
const PUBLIC_TELEMETRY_CACHE_FILE = path.join(DATA_DIR, 'public-telemetry-cache.json')

const PORT = Number(process.env.PORT || 8787)
const APP_SESSION_TOKEN = process.env.APP_SESSION_TOKEN || 'teliman-admin-session-token'
const AUTH_PBKDF2_ITERATIONS = Number(process.env.AUTH_PBKDF2_ITERATIONS || 120000)
const AUTH_USERS_FILE = path.join(__dirname, 'auth-users.json')
const AUTH_USERS = loadAuthUsers()
const API_BASE = process.env.FLEETI_API_BASE
const PUBLIC_API_BASE = process.env.FLEETI_PUBLIC_API_BASE || 'https://api.fleeti.co/v1'
const PUBLIC_API_KEY = process.env.FLEETI_PUBLIC_API_KEY || ''
const LOGIN = process.env.FLEETI_LOGIN
const PASSWORD = process.env.FLEETI_PASSWORD
const DEALER_ID = Number(process.env.FLEETI_DEALER_ID || 0)
const LOCALE = process.env.FLEETI_LOCALE || 'fr'
// Empty by default: we must ingest the full Fleeti fleet. Set FLEETI_TRACKER_IDS only to intentionally restrict scope.
const TRACKER_IDS = parseNumberList(process.env.FLEETI_TRACKER_IDS) || []
const FLEETI_PAGE_SIZE = Number(process.env.FLEETI_PAGE_SIZE || 500)
const FLEETI_TRACKER_CHUNK_SIZE = Number(process.env.FLEETI_TRACKER_CHUNK_SIZE || 100)
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60 * 1000)
const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS)
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || ''
const REQUIRE_API_TOKEN = process.env.REQUIRE_API_TOKEN === 'true'
const PRIVATE_API_CONFIGURED = Boolean(API_BASE && LOGIN && PASSWORD && DEALER_ID)

validateRequiredEnv()

const app = express()
let dashboardCache = { data: null, ts: 0 }
let authCache = { hash: '', ts: 0 }
let tracksBatchCache = new Map()
const AUTH_CACHE_TTL_MS = Number(process.env.FLEETI_AUTH_CACHE_TTL_MS || 50 * 60 * 1000)
const TRACKS_BATCH_CACHE_TTL_MS = Number(process.env.TRACKS_BATCH_CACHE_TTL_MS || 45 * 1000)

app.disable('x-powered-by')
app.use(cors(buildCorsOptions()))
app.use(express.json({ limit: '10mb' }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
app.use(requestLogger)
app.use(protectApi)
app.use(protectAppSession)

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
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'x-user-email', 'x-session-token'],
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

function parseAuthUsers(raw) {
  const fallbackHash = 'ac8412f2775cc339fe63c96e8a876611d35cd941d5325ba962b336b78f131734'
  const fallbackSalt = 'e36f6f8132d2389d746a4f6e052c7fc0'
  const fallbackUsers = [
    'finances@telimanlogistique.com',
    'coordination@telimanlogistique.com',
    'marie@telimanlogistique.com',
    'boubsfal@gmail.com',
  ].map((email) => ({ email, role: 'admin', permissions: ['*'], salt: fallbackSalt, passwordHash: fallbackHash }))
  if (!String(raw || '').trim()) return fallbackUsers
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallbackUsers
    return parsed
      .map((item) => ({
        email: String(item?.email || '').trim().toLowerCase(),
        role: String(item?.role || 'user').trim().toLowerCase(),
        permissions: Array.isArray(item?.permissions) ? item.permissions.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
        salt: String(item?.salt || '').trim(),
        passwordHash: String(item?.passwordHash || '').trim(),
      }))
      .filter((item) => item.email && item.salt && item.passwordHash)
  } catch {
    return fallbackUsers
  }
}

function loadAuthUsers() {
  try {
    const payload = JSON.parse(fs.readFileSync(AUTH_USERS_FILE, 'utf8'))
    const parsed = parseAuthUsers(JSON.stringify(payload))
    return parsed.length ? parsed : parseAuthUsers('')
  } catch {
    const fallback = parseAuthUsers('')
    try { fs.writeFileSync(AUTH_USERS_FILE, JSON.stringify(fallback, null, 2)) } catch {}
    return fallback
  }
}

function saveAuthUsers(users) {
  const normalized = parseAuthUsers(JSON.stringify(users))
  fs.writeFileSync(AUTH_USERS_FILE, JSON.stringify(normalized, null, 2))
  AUTH_USERS.length = 0
  AUTH_USERS.push(...normalized)
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), String(salt || ''), AUTH_PBKDF2_ITERATIONS, 32, 'sha256').toString('hex')
}

function findAuthUser(email) {
  const normalized = String(email || '').trim().toLowerCase()
  return AUTH_USERS.find((item) => item.email === normalized) || null
}

function getSessionUser(req) {
  const email = String(req.get('x-user-email') || req.get('x-user_email') || '').trim().toLowerCase()
  const sessionToken = String(req.get('x-session-token') || '').trim()
  const user = findAuthUser(email)
  if (!user || !secureCompare(sessionToken, APP_SESSION_TOKEN)) return null
  return user
}

function hasPermission(user, permission) {
  if (!user) return false
  const permissions = Array.isArray(user.permissions) ? user.permissions : []
  if (permissions.includes('*')) return true
  return permissions.includes(permission)
}

function normalizeUserPermissions(role, permissions = []) {
  const basePages = ['page_dashboard', 'page_map', 'page_fleet', 'page_alerts', 'page_analytics', 'page_reports']
  if (role === 'admin') return ['*']
  const normalized = Array.from(new Set((permissions || []).map((entry) => String(entry || '').trim()).filter(Boolean)))
  const withBase = Array.from(new Set([...basePages, ...normalized]))
  return withBase
}

function sanitizeUserOutput(user) {
  return {
    email: user.email,
    role: user.role,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
  }
}

function protectAppSession(req, res, next) {
  if (!req.path.startsWith('/api/')) return next()
  if (req.path === '/api/auth/login' || req.path === '/api/auth/me' || req.path === '/api/health') return next()
  const user = getSessionUser(req)
  if (user) {
    req.authUser = user
    return next()
  }
  return res.status(401).json({ ok: false, error: 'Session invalide. Merci de vous reconnecter.' })
}

function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.authUser || getSessionUser(req)
    if (!hasPermission(user, permission)) {
      return res.status(403).json({ ok: false, error: 'Accès refusé. Vous n’avez pas les droits nécessaires.' })
    }
    return next()
  }
}

function getDateRange(period = '48h') {
  const now = new Date()
  const fromDate = new Date(now)

  if (period === '1h') fromDate.setHours(now.getHours() - 1)
  else if (period === '6h') fromDate.setHours(now.getHours() - 6)
  else if (period === '12h') fromDate.setHours(now.getHours() - 12)
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

function normalizePurchaseOrdersMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([client, purchaseOrderNumber]) => [String(client || '').trim(), String(purchaseOrderNumber || '').trim()])
      .filter(([client, purchaseOrderNumber]) => client && purchaseOrderNumber)
      .sort((a, b) => a[0].localeCompare(b[0]))
  )
}

function normalizeManualTrackers(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const id = Number(item?.id)
      const label = String(item?.label || '').trim()
      const driver = String(item?.driver || '').trim()
      const normalizedId = Number.isInteger(id) && id > 0 ? id : (9000000 + index + 1)
      if (!label || !driver) return null
      return { id: normalizedId, label, driver }
    })
    .filter(Boolean)
    .reduce((acc, item) => {
      if (acc.some((entry) => Number(entry.id) === Number(item.id))) return acc
      return [...acc, item]
    }, [])
    .sort((a, b) => a.label.localeCompare(b.label))
}

function readMasterData() {
  try {
    const payload = JSON.parse(fs.readFileSync(MASTER_DATA_FILE, 'utf8'))
    return {
      clients: Array.isArray(payload.clients) ? payload.clients : [],
      goods: Array.isArray(payload.goods) ? payload.goods : [],
      destinations: Array.isArray(payload.destinations) ? payload.destinations : [],
      suppliers: Array.isArray(payload.suppliers) ? payload.suppliers : [],
      purchaseOrders: normalizePurchaseOrdersMap(payload.purchaseOrders),
      manualTrackers: normalizeManualTrackers(payload.manualTrackers),
    }
  } catch {
    return { clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] }
  }
}

function writeMasterData(data) {
  const payload = {
    clients: Array.from(new Set((data.clients || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    goods: Array.from(new Set((data.goods || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    destinations: Array.from(new Set((data.destinations || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    suppliers: Array.from(new Set((data.suppliers || []).map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    purchaseOrders: normalizePurchaseOrdersMap(data.purchaseOrders),
    manualTrackers: normalizeManualTrackers(data.manualTrackers),
  }
  fs.writeFileSync(MASTER_DATA_FILE, JSON.stringify(payload, null, 2))
}

function ensureValidTrackerId(value) {
  const trackerId = Number(value)
  return Number.isInteger(trackerId) && trackerId > 0 ? trackerId : null
}

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

function persistDeliveryProofPhoto(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return raw
  const match = raw.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
  if (!match) return raw

  ensureUploadsDir()
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
  const base64Payload = match[2]
  const fileName = `proof-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const filePath = path.join(UPLOADS_DIR, fileName)
  fs.writeFileSync(filePath, Buffer.from(base64Payload, 'base64'))
  return `/uploads/delivery-proofs/${fileName}`
}

function preprocessDeliveryProofPhotos(body = {}, current = null) {
  const normalized = { ...(body || {}) }
  const currentList = Array.isArray(current?.proofPhotoDataUrls)
    ? current.proofPhotoDataUrls
    : (current?.proofPhotoDataUrl ? [current.proofPhotoDataUrl] : [])

  if (Array.isArray(normalized.proofPhotoDataUrls)) {
    normalized.proofPhotoDataUrls = normalized.proofPhotoDataUrls.map((item) => persistDeliveryProofPhoto(item)).filter(Boolean)
  } else if (currentList.length) {
    normalized.proofPhotoDataUrls = currentList
  }

  if (typeof normalized.proofPhotoDataUrl === 'string' && normalized.proofPhotoDataUrl.trim()) {
    normalized.proofPhotoDataUrl = persistDeliveryProofPhoto(normalized.proofPhotoDataUrl)
  } else if (normalized.proofPhotoDataUrls?.length) {
    normalized.proofPhotoDataUrl = normalized.proofPhotoDataUrls[0]
  } else if (current?.proofPhotoDataUrl) {
    normalized.proofPhotoDataUrl = current.proofPhotoDataUrl
  }

  return normalized
}

function sanitizeFuelPhotoDataUrl(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim()
  if (!raw) return ''
  const isAllowed = /^data:image\/(png|jpe?g|webp);base64,/i.test(raw)
  if (!isAllowed) throw new Error('Format photo invalide (png, jpg, jpeg, webp)')
  if (raw.length > 7_000_000) throw new Error('Photo trop volumineuse (max 5MB)')
  return raw
}

function sanitizeFuelPhotoList(value, fallback = []) {
  const input = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : [])
  return input
    .map((item) => sanitizeFuelPhotoDataUrl(item, ''))
    .filter(Boolean)
    .slice(0, 10)
}

function sanitizeFuelVoucherPayload(body = {}, current = null) {
  const trackerId = ensureValidTrackerId(body.trackerId ?? current?.trackerId)
  if (!trackerId) throw new Error('trackerId invalide')

  const quantityLiters = Number(String(body.quantityLiters ?? current?.quantityLiters ?? '').replace(',', '.'))
  const unitPrice = Number(String(body.unitPrice ?? current?.unitPrice ?? '').replace(',', '.'))
  if (!Number.isFinite(quantityLiters) || quantityLiters <= 0) throw new Error('Quantité invalide')
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Prix unitaire invalide')

  const amount = Number((quantityLiters * unitPrice).toFixed(2))
  const proofPhotoDataUrls = sanitizeFuelPhotoList(body.proofPhotoDataUrls, current?.proofPhotoDataUrls)
  const proofPhotoDataUrl = sanitizeFuelPhotoDataUrl(body.proofPhotoDataUrl, current?.proofPhotoDataUrl)

  return {
    id: current?.id || Date.now(),
    trackerId,
    truckLabel: String(body.truckLabel ?? current?.truckLabel ?? '').trim(),
    driver: String(body.driver ?? current?.driver ?? '').trim(),
    client: String(body.client ?? current?.client ?? '').trim(),
    voucherNumber: String(body.voucherNumber ?? current?.voucherNumber ?? '').trim(),
    supplier: String(body.supplier ?? current?.supplier ?? '').trim(),
    dateTime: body.dateTime || current?.dateTime || new Date().toISOString(),
    quantityLiters,
    unitPrice,
    amount,
    createdAt: current?.createdAt || new Date().toISOString(),
    proofPhotoDataUrl: proofPhotoDataUrl || proofPhotoDataUrls[0] || '',
    proofPhotoDataUrls: proofPhotoDataUrls.length ? proofPhotoDataUrls : (proofPhotoDataUrl ? [proofPhotoDataUrl] : []),
  }
}

function sanitizeProofPhotoDataUrl(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('/uploads/')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  const isAllowed = /^data:image\/(png|jpe?g|webp);base64,/i.test(raw)
  if (!isAllowed) throw new Error('Format photo invalide (png, jpg, jpeg, webp)')
  // ~5MB max encoded payload
  if (raw.length > 7_000_000) throw new Error('Photo trop volumineuse (max 5MB)')
  return raw
}

function sanitizeProofPhotoList(value, fallback = []) {
  const input = Array.isArray(value) ? value : (Array.isArray(fallback) ? fallback : [])
  return input
    .map((item) => sanitizeProofPhotoDataUrl(item, ''))
    .filter(Boolean)
    .slice(0, 10)
}

function sanitizeOptionalDateField(value, fallback = null, { defaultNow = false } = {}) {
  if (value === null || value === '') return null
  if (value !== undefined) return value
  if (fallback !== undefined && fallback !== null) return fallback
  return defaultNow ? new Date().toISOString() : null
}

function sanitizeDeliveryOrderPayload(body = {}, current = null) {
  const trackerId = ensureValidTrackerId(body.trackerId ?? current?.trackerId)
  if (!trackerId) {
    throw new Error('trackerId invalide')
  }

  const date = sanitizeOptionalDateField(body.date, current?.date, { defaultNow: !current })
  const departureDateTime = sanitizeOptionalDateField(body.departureDateTime, current?.departureDateTime)
  const arrivalDateTime = sanitizeOptionalDateField(body.arrivalDateTime, current?.arrivalDateTime)

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
    date,
    departureDateTime,
    arrivalDateTime,
    notes: String(body.notes ?? current?.notes ?? '').trim(),
    active: body.active ?? current?.active ?? true,
    completedAt: body.status === 'Livré' ? (body.completedAt || current?.completedAt || new Date().toISOString()) : (body.completedAt ?? current?.completedAt ?? null),
    proofNote: String(body.proofNote ?? current?.proofNote ?? '').trim(),
    proofStatus: String(body.proofStatus ?? current?.proofStatus ?? 'En attente').trim(),
    proofPhotoDataUrl: sanitizeProofPhotoDataUrl(body.proofPhotoDataUrl, current?.proofPhotoDataUrl),
    proofPhotoDataUrls: sanitizeProofPhotoList(body.proofPhotoDataUrls, current?.proofPhotoDataUrls),
  }
}

async function apiCall(endpoint, payload = {}) {
  if (!API_BASE) {
    throw new Error('FLEETI_API_BASE non configuré')
  }
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

function extractAuthHash(auth = {}) {
  return String(
    auth?.hash
      ?? auth?.result?.hash
      ?? auth?.data?.hash
      ?? auth?.user?.hash
      ?? auth?.session?.hash
      ?? '',
  ).trim()
}

async function authenticate() {
  const now = Date.now()
  if (authCache.hash && (now - authCache.ts) < AUTH_CACHE_TTL_MS) {
    return authCache.hash
  }

  const payloadVariants = [
    { login: LOGIN, password: PASSWORD, dealer_id: DEALER_ID, locale: LOCALE },
    { email: LOGIN, password: PASSWORD, dealer_id: DEALER_ID, locale: LOCALE },
    { login: LOGIN, password: PASSWORD, locale: LOCALE },
  ]

  let lastError = null

  for (const payload of payloadVariants) {
    try {
      const auth = await apiCall('user/auth', payload)
      const hash = extractAuthHash(auth)
      if (hash) {
        authCache = { hash, ts: Date.now() }
        return hash
      }
      lastError = new Error('Réponse user/auth sans hash exploitable')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Authentification Fleeti impossible')
}

function mapVehicleRowsToTrackers(rows = []) {
  return rows
    .map((row, index) => {
      const trackerId = Number(
        row?.tracker_id
        ?? row?.trackerId
        ?? row?.tracker?.id
        ?? row?.device_id
        ?? row?.gateway_id
        ?? row?.gatewayId,
      )
      const vehicleId = Number(row?.id)
      const normalizedId = Number.isFinite(trackerId) && trackerId > 0
        ? trackerId
        : (Number.isFinite(vehicleId) && vehicleId > 0 ? -vehicleId : -(index + 1))
      return {
        id: normalizedId,
        trackerId: Number.isFinite(trackerId) && trackerId > 0 ? trackerId : null,
        label: row?.name || row?.label || row?.plate || row?.license_plate || `Véhicule ${Math.abs(normalizedId)}`,
        model: row?.model || row?.brand || row?.type || 'Modèle inconnu',
        source: Number.isFinite(trackerId) && trackerId > 0 ? 'tracker' : 'vehicle',
      }
    })
    .filter(Boolean)
}

async function fetchTrackersPrivate(hash) {
  const calls = [
    () => apiCall('tracker/list', { hash }),
    () => apiCall('tracker/list', { hash, dealer_id: DEALER_ID }),
    () => apiCall('tracker/list', { hash, dealerId: DEALER_ID }),
    () => apiCall('tracker/list', { hash, dealer: DEALER_ID }),
  ]

  let lastError = null
  for (const run of calls) {
    try {
      const response = await run()
      const rows = extractArrayPayload(response, ['list', 'trackers', 'items', 'results', 'result', 'data'])
      const sanitized = sanitizeTrackers(rows)
        .filter((tracker) => Number.isFinite(Number(tracker?.id)) && Number(tracker.id) > 0)
      if (sanitized.length) return sanitized
      lastError = new Error('Liste trackers vide')
    } catch (error) {
      lastError = error
    }
  }

  const fallbackCalls = [
    () => apiCall('vehicle/read', { hash }),
    () => apiCall('vehicle/read', { hash, dealer_id: DEALER_ID }),
    () => apiCall('tracker/read', { hash, trackers: TRACKER_IDS.length ? TRACKER_IDS : undefined }),
  ]

  for (const run of fallbackCalls) {
    try {
      const response = await run()
      const rows = extractArrayPayload(response, ['list', 'vehicles', 'trackers', 'items', 'results', 'result', 'data'])
      const mapped = mapVehicleRowsToTrackers(rows)
      if (mapped.length) return mapped
      lastError = new Error('Aucun tracker exploitable via vehicle/read|tracker/read')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Impossible de récupérer tracker/list')
}

async function publicApiGet(pathname, query = {}) {
  if (!PUBLIC_API_KEY) throw new Error('Missing FLEETI_PUBLIC_API_KEY')
  const url = new URL(`${PUBLIC_API_BASE}${pathname}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      value.filter((item) => item !== undefined && item !== null && item !== '').forEach((item) => url.searchParams.append(key, String(item)))
    } else {
      url.searchParams.append(key, String(value))
    }
  }
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': PUBLIC_API_KEY,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.isSuccess === false) throw new Error(data?.message || 'Fleeti public API error')
  return data
}

function getFuelSensorPriority(sensor = {}) {
  const inputName = String(sensor.inputName || '').toLowerCase()
  if (inputName === 'avl_io_89') return 100
  if (inputName === 'can_fuel_litres') return 80
  if (inputName.includes('fuel')) return 50
  return 0
}

function collectGatewayFuelSensors(gateway = {}) {
  const directSensors = gateway?.providerSensors || []
  const accessorySensors = (gateway?.accessories || []).flatMap((accessory) => accessory?.providerSensors || [])
  return [...directSensors, ...accessorySensors]
}

function formatFuelSnapshot(asset = {}) {
  const gateway = (asset.gateways || []).find((item) => item?.provider?.gatewayId) || asset.gateways?.[0]
  const gatewaySensors = collectGatewayFuelSensors(gateway)
  const preferredFuelSensors = gatewaySensors.filter((sensor) => {
    const inputName = String(sensor.inputName || '').toLowerCase()
    const units = String(sensor.units || '').toLowerCase()
    return inputName.includes('fuel') || inputName.includes('lls_level') || inputName === 'avl_io_89' || units === 'l'
  })
  const allValueSensors = gatewaySensors.filter((sensor) => Number.isFinite(sensor?.value))
  const sortedSensors = [...preferredFuelSensors].sort((a, b) => getFuelSensorPriority(b) - getFuelSensorPriority(a))
  const fallbackSensor = allValueSensors.find((sensor) => {
    const inputName = String(sensor.inputName || '').toLowerCase()
    const units = String(sensor.units || '').toLowerCase()
    return units === 'l' || inputName.includes('litre') || inputName.includes('fuel') || inputName.includes('lls_level') || inputName === 'avl_io_89' || inputName === 'avl_io_90'
  }) || null
  const preferredSensor = sortedSensors.find((sensor) => Number.isFinite(sensor?.value)) || sortedSensors[0] || fallbackSensor || null
  const sensors = preferredFuelSensors.length ? preferredFuelSensors : (fallbackSensor ? [fallbackSensor] : [])
  return {
    assetId: asset.id || '',
    trackerId: gateway?.provider?.gatewayId ? Number(gateway.provider.gatewayId) : null,
    sourceId: gateway?.provider?.sourceId ? Number(gateway.provider.sourceId) : null,
    truckLabel: asset.name || gateway?.name || asset.properties?.licensePlate || 'Camion sans nom',
    imei: gateway?.imei || '',
    isOnline: Boolean(gateway?.isOnline),
    movementStatus: gateway?.state?.movementStatus ?? null,
    connectionStatus: gateway?.state?.connectionStatus ?? null,
    fuelLevel: Number.isFinite(preferredSensor?.value) ? preferredSensor.value : null,
    fuelUnits: preferredSensor?.units || 'L',
    fuelUpdatedAt: preferredSensor?.valueUpdatedAt || null,
    fuelInputName: preferredSensor?.inputName || null,
    sensorId: preferredSensor?.id || null,
    sensors: sensors.map((sensor) => ({
      id: sensor.id,
      inputName: sensor.inputName || null,
      value: Number.isFinite(sensor.value) ? sensor.value : null,
      valueUpdatedAt: sensor.valueUpdatedAt || null,
      units: sensor.units || null,
      isCan: Boolean(sensor.isCan),
    })),
  }
}

async function loadCameraAssets() {
  if (!PRIVATE_API_CONFIGURED) {
    throw new Error('API privée Fleeti non configurée')
  }

  const hash = await authenticate()
  const trackersResponse = await apiCall('tracker/list', { hash })
  const trackers = sanitizeTrackers(extractArrayPayload(trackersResponse, ['list', 'trackers', 'items', 'results', 'result', 'data']))

  const isCameraLike = (tracker) => {
    const label = String(tracker?.label || tracker?.name || '').trim()
    const model = String(tracker?.model || '').trim()
    return /(?:-cam|_cam)$/i.test(label) || /dashcam/i.test(model)
  }

  const items = trackers
    .filter(isCameraLike)
    .map((tracker) => ({
      truckLabel: tracker.label,
      truckAssetId: null,
      truckGatewayId: Number(tracker.id) || null,
      cameraLabel: tracker.label,
      cameraAssetId: null,
      cameraGatewayId: Number(tracker.id) || null,
      liveViewAvailable: false,
      liveViewReason: 'Aucun flux live exploitable renvoyé par l’API privée Fleeti actuellement.',
      imei: tracker.imei || null,
      model: tracker.model || null,
      supplier: null,
      isOnline: null,
      connectionStatus: null,
      movementStatus: null,
      updatedAt: null,
      location: null,
    }))
    .sort((a, b) => String(a.truckLabel || '').localeCompare(String(b.truckLabel || ''), 'fr'))

  return { items, generatedAt: new Date().toISOString(), source: 'private' }
}

async function loadLiveFuelLevels() {
  if (!PRIVATE_API_CONFIGURED) {
    throw new Error('API privée Fleeti non configurée')
  }

  const hash = await authenticate()
  const trackersResponse = await apiCall('tracker/list', { hash })
  const trackers = sanitizeTrackers(extractArrayPayload(trackersResponse, ['list', 'trackers', 'items', 'results', 'result', 'data']))

  const trackerIds = trackers
    .map((tracker) => Number(tracker.id))
    .filter((trackerId) => Number.isFinite(trackerId) && (!TRACKER_IDS.length || TRACKER_IDS.includes(trackerId)))

  const statesResponse = trackerIds.length
    ? await apiCall('tracker/get_states', { hash, trackers: trackerIds }).catch(() => ({ states: {} }))
    : { states: {} }
  const states = extractObjectPayload(statesResponse, ['states', 'result', 'data'])

  const items = await Promise.all(trackerIds.map(async (trackerId) => {
    const tracker = trackers.find((entry) => Number(entry.id) === trackerId)
    const state = states?.[trackerId] || states?.[String(trackerId)] || {}
    const fuelSensors = await getFuelSensorInfo(hash, trackerId)
    const preferredFuelSensor = fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_consumption'))
      || fuelSensors.find((sensor) => String(sensor.input_name || '').includes('can_fuel_litres'))
      || fuelSensors[0]

    return {
      trackerId,
      sourceId: null,
      truckLabel: tracker?.label || `Tracker ${trackerId}`,
      imei: tracker?.imei || '',
      isOnline: null,
      movementStatus: state?.movement_status ?? state?.movementStatus ?? null,
      connectionStatus: state?.connection_status ?? state?.connectionStatus ?? null,
      fuelLevel: extractFuelSensorValue(preferredFuelSensor),
      fuelUnits: preferredFuelSensor?.units || 'L',
      fuelUpdatedAt: preferredFuelSensor?.updated_at || preferredFuelSensor?.value_updated_at || null,
      fuelInputName: preferredFuelSensor?.input_name || preferredFuelSensor?.inputName || null,
      sensorId: preferredFuelSensor?.id || null,
      sensors: fuelSensors.map((sensor) => ({
        id: sensor.id,
        inputName: sensor.input_name || sensor.inputName || null,
        value: Number.isFinite(Number(sensor.value)) ? Number(sensor.value) : null,
        valueUpdatedAt: sensor.updated_at || sensor.value_updated_at || null,
        units: sensor.units || null,
        isCan: Boolean(sensor.is_can || sensor.isCan),
      })),
    }
  }))

  return {
    items: items.sort((a, b) => String(a.truckLabel || '').localeCompare(String(b.truckLabel || ''), 'fr')),
    generatedAt: new Date().toISOString(),
    source: 'private',
  }
}

function extractObjectCollection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const entries = Object.values(value)
  if (!entries.length) return []
  if (entries.every((entry) => entry && typeof entry === 'object')) return entries
  return []
}

function extractArrayPayload(payload, candidateKeys = ['list', 'items', 'results', 'data', 'result']) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of candidateKeys) {
    if (Array.isArray(payload[key])) return payload[key]
    if (payload[key] && typeof payload[key] === 'object') {
      if (Array.isArray(payload[key].list)) return payload[key].list
      if (Array.isArray(payload[key].items)) return payload[key].items
      if (Array.isArray(payload[key].results)) return payload[key].results
      if (Array.isArray(payload[key].data)) return payload[key].data
      const fromCollection = extractObjectCollection(payload[key])
      if (fromCollection.length) return fromCollection
    }
  }
  const fromPayloadCollection = extractObjectCollection(payload)
  if (fromPayloadCollection.length) return fromPayloadCollection
  return []
}

function extractObjectPayload(payload, candidateKeys = ['states', 'result', 'data']) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const key of candidateKeys) {
      const value = payload[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    }
  }
  return {}
}

function sanitizeTrackers(trackers = []) {
  return trackers.filter(Boolean).map((tracker) => {
    const resolvedId = Number(
      tracker.id
      ?? tracker.tracker_id
      ?? tracker.trackerId
      ?? tracker.gateway_id
      ?? tracker.gatewayId
      ?? 0,
    )
    const normalizedId = Number.isFinite(resolvedId) && resolvedId > 0 ? resolvedId : tracker.id
    return {
      ...tracker,
      id: normalizedId,
      label: tracker.label || tracker.name || tracker.license_plate || tracker.plate || `Tracker ${normalizedId || 'N/A'}`,
      model: tracker.model || tracker.device_model || tracker.type || 'Modèle inconnu',
    }
  })
}

function extractEmployeeTrackerIds(employee = {}) {
  const candidates = [
    employee?.tracker_id,
    employee?.trackerId,
    employee?.trackerID,
    employee?.tracker,
    employee?.tracker_ids,
    employee?.trackerIds,
    employee?.trackers,
  ]

  const ids = candidates
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .flatMap((value) => {
      if (value && typeof value === 'object') {
        return [
          value.id,
          value.tracker_id,
          value.trackerId,
        ]
      }
      return [value]
    })
    .map((value) => Number(value))
    .filter(Number.isFinite)

  return Array.from(new Set(ids))
}

function sanitizeEmployees(employees = []) {
  return employees.filter(Boolean).map((employee) => {
    const trackerIds = extractEmployeeTrackerIds(employee)
    const firstName = String(employee.first_name || employee.firstname || employee.firstName || employee.name || '').trim()
    const lastName = String(employee.last_name || employee.lastname || employee.lastName || '').trim()
    return {
      ...employee,
      tracker_id: trackerIds[0] ?? (Number(employee?.tracker_id || employee?.trackerId) || null),
      tracker_ids: trackerIds,
      first_name: firstName,
      last_name: lastName,
      phone: employee.phone || employee.mobile || employee.tel || 'N/A',
    }
  })
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

function normalizeConnectionStatus(rawStatus, isOnline) {
  const numeric = Number(rawStatus)
  if (Number.isFinite(numeric)) {
    if (numeric === 50 || numeric === 20) return 'active'
    if (numeric === 30 || numeric === 10) return 'offline'
  }

  const value = String(rawStatus || '').trim().toLowerCase()
  if (value.includes('offline') || value.includes('disconnect')) return 'offline'
  if (value.includes('online') || value.includes('active') || value.includes('connect')) return 'active'
  if (typeof isOnline === 'boolean') return isOnline ? 'active' : 'offline'
  return 'unknown'
}

function normalizeMovementStatus(rawStatus, speed = 0, isOnline = true) {
  const numeric = Number(rawStatus)
  if (Number.isFinite(numeric)) {
    if (numeric === 20) return 'moving'
    if (numeric === 10) return isOnline ? 'idle' : 'offline'
    if (numeric === 30) return isOnline ? 'idle' : 'offline'
  }

  const value = String(rawStatus || '').trim().toLowerCase()
  if (value.includes('mov')) return 'moving'
  if (value.includes('idle') || value.includes('stop') || value.includes('park')) return 'idle'
  if (!isOnline) return 'offline'
  if (Number(speed) > 0) return 'moving'
  return 'idle'
}

function pickFirstFinite(...values) {
  for (const candidate of values) {
    const num = Number(candidate)
    if (Number.isFinite(num)) return num
  }
  return 0
}

function readPublicTelemetryCache() {
  try {
    const payload = JSON.parse(fs.readFileSync(PUBLIC_TELEMETRY_CACHE_FILE, 'utf8'))
    return {
      trackers: payload?.trackers && typeof payload.trackers === 'object' ? payload.trackers : {},
      events: Array.isArray(payload?.events) ? payload.events : [],
    }
  } catch {
    return { trackers: {}, events: [] }
  }
}

function writePublicTelemetryCache(payload = {}) {
  const normalized = {
    trackers: payload?.trackers && typeof payload.trackers === 'object' ? payload.trackers : {},
    events: Array.isArray(payload?.events) ? payload.events : [],
  }
  fs.writeFileSync(PUBLIC_TELEMETRY_CACHE_FILE, JSON.stringify(normalized, null, 2))
}

function pickPublicOdometerKm(asset = {}, gateway = {}) {
  const state = gateway?.state || {}
  const providerSensors = Array.isArray(gateway?.providerSensors) ? gateway.providerSensors : []
  const counterValues = (Array.isArray(gateway?.counters) ? gateway.counters : [])
    .filter((counter) => String(counter?.unitType || '').toLowerCase() === 'km' || Number(counter?.counterType) === 1)
    .map((counter) => Number(counter?.value))
    .filter(Number.isFinite)

  const sensorValues = providerSensors
    .filter((sensor) => {
      const name = String(sensor?.inputName || '').toLowerCase()
      const units = String(sensor?.units || '').toLowerCase()
      return units === 'km' || name.includes('mileage') || name.includes('odometer') || name.includes('distance')
    })
    .map((sensor) => Number(sensor?.value))
    .filter(Number.isFinite)

  const directCandidates = [
    state.mileageKm,
    state.mileage,
    state.totalDistanceKm,
    asset.mileageKm,
    asset.totalDistanceKm,
    ...sensorValues,
    ...counterValues,
  ]
    .map((value) => Number(value))
    .filter(Number.isFinite)

  if (!directCandidates.length) return null
  return Math.max(...directCandidates)
}

function buildPublicAddress(location = {}) {
  const lat = Number(location?.lat)
  const lng = Number(location?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Position indisponible'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function buildTrackBundleFromPublicCache(trackerId, from, to) {
  return buildTrackBundleFromTelemetryCache({
    trackerId,
    from,
    to,
    telemetryCache: readPublicTelemetryCache(),
  })
}

function buildPublicCacheTrackBundle(trackerId, from, to, extra = {}) {
  const bundle = buildTrackBundleFromPublicCache(trackerId, from, to)
  const points = bundle.points || []
  const lastTwoPoints = points.length >= 2 ? points.slice(-2) : []
  return { ...bundle, lastTwoPoints, source: 'public-cache', degraded: true, ...extra }
}

async function buildDashboardDataFromPublicApi(todayKey, yesterdayKey) {
  const rows = await fetchAllPublicAssets({ publicApiGet, take: FLEETI_PAGE_SIZE })
  const fleetRows = rows.filter((asset) => {
    if (isCameraLike({ label: asset?.name || asset?.properties?.licensePlate, model: asset?.model })) return false
    if (asset?.assetType === 10) return true
    if (asset?.assetType != null) return false
    return Array.isArray(asset?.gateways) && asset.gateways.length > 0
  })

  const telemetryCache = readPublicTelemetryCache()
  const trackersMap = new Map()
  const states = {}
  const mileage = {}
  const retentionMs = 72 * 3600 * 1000
  const now = Date.now()

  telemetryCache.events = (Array.isArray(telemetryCache.events) ? telemetryCache.events : []).filter((event) => {
    const ts = Date.parse(event?.time)
    return Number.isFinite(ts) ? (now - ts) <= retentionMs : true
  })

  for (const asset of fleetRows) {
    const gateway = (asset?.gateways || []).find((item) => item?.provider?.gatewayId) || asset?.gateways?.[0] || {}
    const trackerId = Number(gateway?.provider?.gatewayId ?? gateway?.id ?? asset?.id)
    if (!Number.isFinite(trackerId)) continue

    const label = String(asset?.name || gateway?.name || asset?.properties?.licensePlate || `Tracker ${trackerId}`).trim()
    const model = String(gateway?.model || asset?.model || 'Modèle inconnu').trim()
    const state = gateway?.state || {}
    const speed = pickFirstFinite(state?.speed, state?.position?.speed, state?.position?.location?.speed)
    const location = state?.position?.location
    const normalizedLocation = location ? { lat: Number(location.latitude), lng: Number(location.longitude) } : null
    const lastUpdate = state?.updatedAt || state?.lastUpdate || gateway?.updatedAt || new Date().toISOString()
    const connectionStatus = normalizeConnectionStatus(state?.connectionStatus, gateway?.isOnline)
    const movementStatus = normalizeMovementStatus(state?.movementStatus, speed, connectionStatus !== 'offline')

    trackersMap.set(trackerId, { id: trackerId, label: label || `Tracker ${trackerId}`, model })
    states[trackerId] = {
      connection_status: connectionStatus,
      movement_status: movementStatus,
      gps: {
        speed,
        location: normalizedLocation,
      },
      last_update: lastUpdate,
    }

    const cacheEntry = telemetryCache.trackers?.[trackerId] || telemetryCache.trackers?.[String(trackerId)] || {}
    const previousDayMileage = Number(cacheEntry?.todayMileage || 0)
    const dayChanged = cacheEntry?.dayKey && cacheEntry.dayKey !== todayKey
    const odometer = pickPublicOdometerKm(asset, gateway)

    const hasPreviousDayStart = Number.isFinite(Number(cacheEntry?.dayStartOdometer)) && !dayChanged
    let dayStartOdometer = Number(cacheEntry?.dayStartOdometer)
    if (!Number.isFinite(dayStartOdometer) || dayChanged) {
      dayStartOdometer = Number.isFinite(odometer) ? odometer : 0
    }

    const todayMileageFromState = Math.max(0, pickFirstFinite(
      state?.mileageTodayKm,
      state?.dailyMileageKm,
      state?.distanceTodayKm,
      state?.distanceToday,
      state?.tripDistanceTodayKm,
      asset?.mileageTodayKm,
      asset?.dailyMileageKm,
    ))

    const todayMileageValue = Number.isFinite(odometer)
      ? (hasPreviousDayStart
        ? Math.max(0, Number((odometer - dayStartOdometer).toFixed(2)))
        : Math.max(todayMileageFromState, odometer))
      : Math.max(0, Number(cacheEntry?.todayMileage || 0), todayMileageFromState)

    mileage[trackerId] = {
      [todayKey]: { mileage: todayMileageValue },
      [yesterdayKey]: { mileage: dayChanged ? Math.max(0, previousDayMileage) : Math.max(0, Number(cacheEntry?.yesterdayMileage || 0)) },
    }

    const previousStatus = String(cacheEntry?.connection_status || '')
    if (previousStatus && previousStatus !== connectionStatus) {
      telemetryCache.events.push({
        tracker_id: trackerId,
        event: connectionStatus === 'offline' ? 'gateway_offline' : 'gateway_online',
        speed,
        location: normalizedLocation,
        lat: normalizedLocation?.lat,
        lng: normalizedLocation?.lng,
        time: lastUpdate,
        message: connectionStatus === 'offline' ? `${label} est hors ligne` : `${label} est reconnecté`,
        address: buildPublicAddress(normalizedLocation),
      })
    }

    const previousSpeed = Number(cacheEntry?.speed || 0)
    if (speed >= 80 && previousSpeed < 80) {
      telemetryCache.events.push({
        tracker_id: trackerId,
        event: 'speedup',
        speed,
        location: normalizedLocation,
        lat: normalizedLocation?.lat,
        lng: normalizedLocation?.lng,
        time: lastUpdate,
        message: `${label} dépasse 80 km/h`,
        address: buildPublicAddress(normalizedLocation),
      })
    }

    const previousMovement = String(cacheEntry?.movement_status || '')
    if (movementStatus === 'idle' && previousMovement === 'moving' && connectionStatus === 'active') {
      telemetryCache.events.push({
        tracker_id: trackerId,
        event: 'excessive_parking',
        speed,
        location: normalizedLocation,
        lat: normalizedLocation?.lat,
        lng: normalizedLocation?.lng,
        time: lastUpdate,
        message: `${label} vient de passer à l'arrêt`,
        address: buildPublicAddress(normalizedLocation),
      })
    }

    const existingPoints = Array.isArray(cacheEntry?.points) ? cacheEntry.points : []
    const nextPoints = [...existingPoints]
    if (Number.isFinite(normalizedLocation?.lat) && Number.isFinite(normalizedLocation?.lng)) {
      const lastPoint = nextPoints[nextPoints.length - 1]
      if (!lastPoint || Number(lastPoint.lat) !== Number(normalizedLocation.lat) || Number(lastPoint.lng) !== Number(normalizedLocation.lng) || String(lastPoint.time || '') !== String(lastUpdate || '')) {
        nextPoints.push({ lat: normalizedLocation.lat, lng: normalizedLocation.lng, speed, time: lastUpdate })
      }
    }

    telemetryCache.trackers[trackerId] = {
      ...cacheEntry,
      trackerId,
      label,
      model,
      dayKey: todayKey,
      odometer: Number.isFinite(odometer) ? odometer : (Number(cacheEntry?.odometer) || null),
      dayStartOdometer,
      todayMileage: todayMileageValue,
      yesterdayMileage: dayChanged ? Math.max(0, previousDayMileage) : Math.max(0, Number(cacheEntry?.yesterdayMileage || 0)),
      connection_status: connectionStatus,
      movement_status: movementStatus,
      speed,
      location: normalizedLocation,
      last_update: lastUpdate,
      points: nextPoints.filter((point) => {
        const ts = Date.parse(point.time)
        return Number.isFinite(ts) ? (now - ts) <= retentionMs : true
      }).slice(-2000),
    }
  }

  const availableTrackers = Array.from(trackersMap.values())
  const availableIds = availableTrackers.map((tracker) => Number(tracker.id)).filter(Number.isFinite)
  const scopedIds = resolveScopedTrackerIds(availableIds, TRACKER_IDS)

  const scopedTrackers = availableTrackers.filter((tracker) => scopedIds.includes(Number(tracker.id)))
  const scopedStates = Object.fromEntries(Object.entries(states).filter(([id]) => scopedIds.includes(Number(id))))
  const scopedMileage = Object.fromEntries(Object.entries(mileage).filter(([id]) => scopedIds.includes(Number(id))))
  const scopedHistory = telemetryCache.events
    .filter((event) => scopedIds.includes(Number(event?.tracker_id)))
    .sort((a, b) => Date.parse(b?.time || '') - Date.parse(a?.time || ''))
    .slice(0, 400)

  writePublicTelemetryCache(telemetryCache)

  return {
    trackers: sanitizeTrackers(scopedTrackers),
    states: scopedStates,
    employees: [],
    unreadCount: 0,
    rules: [],
    tariffs: [],
    history: sanitizeHistory(scopedHistory),
    mileage: scopedMileage,
    dateKeys: { todayKey, yesterdayKey },
  }
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
  const employeesByTracker = {}
  for (const employee of (data.employees ?? [])) {
    const trackerIds = extractEmployeeTrackerIds(employee)
    for (const trackerId of trackerIds) {
      if (!Number.isFinite(trackerId)) continue
      employeesByTracker[trackerId] = employee
    }
  }
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
      const fuelValue = extractFuelSensorValue(preferredFuelSensor)
      carburantL = fuelValue ?? (preferredFuelSensor ? `Capteur détecté: ${preferredFuelSensor.name}` : 'N/A')
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

function extractFuelSensorValue(sensor) {
  if (!sensor || typeof sensor !== 'object') return null
  const candidates = [
    sensor.value,
    sensor.last_value,
    sensor.current_value,
    sensor.val,
    sensor.liters,
    sensor.fuel_level,
    sensor.fuel,
    sensor.count,
    sensor.total,
  ]
  for (const candidate of candidates) {
    const num = Number(String(candidate ?? '').replace(',', '.'))
    if (Number.isFinite(num) && String(candidate ?? '').trim() !== '') {
      return num
    }
  }
  if (sensor.additional && typeof sensor.additional === 'object') {
    for (const value of Object.values(sensor.additional)) {
      const num = Number(String(value ?? '').replace(',', '.'))
      if (Number.isFinite(num) && String(value ?? '').trim() !== '') {
        return num
      }
    }
  }
  return null
}

async function fetchPrivateStates(hash, trackerIds) {
  const merged = {}
  for (const trackers of chunkIds(trackerIds, FLEETI_TRACKER_CHUNK_SIZE)) {
    try {
      const response = await apiCall('tracker/get_states', { hash, trackers })
      Object.assign(merged, extractObjectPayload(response, ['states', 'result', 'data']))
    } catch (error) {
      console.warn(`[fleeti] tracker/get_states chunk failed: ${error?.message || error}`)
    }
  }
  return { states: merged }
}

async function fetchPrivateHistory(hash, trackerIds, from, to) {
  const rows = []
  for (const trackers of chunkIds(trackerIds, FLEETI_TRACKER_CHUNK_SIZE)) {
    try {
      const response = await apiCall('history/tracker/list', { hash, trackers, from, to, limit: 1000 })
      rows.push(...extractArrayPayload(response))
    } catch (error) {
      console.warn(`[fleeti] history/tracker/list chunk failed: ${error?.message || error}`)
    }
  }
  return { list: rows }
}

async function fetchPrivateMileage(hash, trackerIds, from, to) {
  const merged = {}
  for (const trackers of chunkIds(trackerIds, FLEETI_TRACKER_CHUNK_SIZE)) {
    try {
      const response = await apiCall('tracker/stats/mileage/read', { hash, trackers, from, to })
      Object.assign(merged, extractObjectPayload(response, ['result', 'mileage', 'data']))
    } catch (error) {
      console.warn(`[fleeti] tracker/stats/mileage/read chunk failed: ${error?.message || error}`)
    }
  }
  return { result: merged }
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

  if (!PRIVATE_API_CONFIGURED) {
    throw new Error('API privée Fleeti non configurée')
  }

  const { from, to, todayKey, yesterdayKey } = getDateRange('48h')

  const hash = await authenticate()

  const sanitizedTrackers = await fetchTrackersPrivate(hash).catch((error) => {
    console.warn(`[dashboard] tracker/list indisponible: ${error?.message || error}`)
    return []
  })

  const availableTrackerIds = sanitizedTrackers
    .map((tracker) => Number(tracker.trackerId ?? tracker.id))
    .filter((value) => Number.isFinite(value) && value > 0)
  const scopedTrackerIds = resolveScopedTrackerIds(availableTrackerIds, TRACKER_IDS)

  if (!availableTrackerIds.length && !TRACKER_IDS.length && PUBLIC_API_KEY) {
    console.warn('[dashboard] API privée sans trackers exploitables; fallback Asset/Search paginé pour charger toute la flotte.')
    const payload = await buildDashboardDataFromPublicApi(todayKey, yesterdayKey)
    dashboardCache = { data: payload, ts: Date.now() }
    return payload
  }

  if (!availableTrackerIds.length && TRACKER_IDS.length) {
    console.warn('[dashboard] tracker/list vide; fallback sur FLEETI_TRACKER_IDS explicite pour charger states/history.')
  } else if (TRACKER_IDS.length && scopedTrackerIds.length === availableTrackerIds.length) {
    console.warn('[dashboard] Aucun tracker configuré trouvé chez Fleeti. Fallback automatique sur tous les trackers disponibles.')
  }

  const [states, employees, unreadCount, rules, tariffs, history, mileage] = await Promise.all([
    scopedTrackerIds.length
      ? fetchPrivateStates(hash, scopedTrackerIds)
      : Promise.resolve({ states: {} }),
    apiCall('employee/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/unread/count', { hash }).catch(() => ({ value: 0 })),
    apiCall('tracker/rule/list', { hash }).catch(() => ({ list: [] })),
    apiCall('tariff/list', { hash }).catch(() => ({ list: [] })),
    scopedTrackerIds.length
      ? fetchPrivateHistory(hash, scopedTrackerIds, from, to)
      : Promise.resolve({ list: [] }),
    scopedTrackerIds.length
      ? fetchPrivateMileage(hash, scopedTrackerIds, from, to)
      : Promise.resolve({ result: {} }),
  ])

  const normalizedStates = extractObjectPayload(states, ['states', 'result', 'data'])
  const normalizedHistory = sanitizeHistory(extractArrayPayload(history))

  const historyLabelByTrackerId = new Map()
  normalizedHistory.forEach((event) => {
    const trackerId = Number(event?.tracker_id ?? event?.trackerId)
    if (!Number.isFinite(trackerId)) return
    const label = String(event?.label || event?.tracker_label || event?.extra?.tracker_label || '').trim()
    if (label && !historyLabelByTrackerId.has(trackerId)) {
      historyLabelByTrackerId.set(trackerId, label)
    }
  })

  const fallbackTrackers = scopedTrackerIds.map((trackerId) => {
    const state = normalizedStates?.[trackerId] ?? normalizedStates?.[String(trackerId)] ?? {}
    const stateLabel = String(
      state?.label
      || state?.name
      || state?.tracker_label
      || state?.vehicle_name
      || state?.extra?.tracker_label
      || '',
    ).trim()

    return {
      id: trackerId,
      label: stateLabel || historyLabelByTrackerId.get(trackerId) || `Tracker ${trackerId}`,
      model: String(state?.model || state?.device_model || 'Modèle inconnu').trim(),
    }
  })

  const scopedTrackers = sanitizedTrackers.filter((tracker) => {
    if (isCameraLike(tracker)) return false
    const numericId = Number(tracker.id)
    if (!Number.isFinite(numericId) || numericId <= 0) return true
    return scopedTrackerIds.includes(numericId)
  })
  const effectiveTrackers = scopedTrackers.length ? scopedTrackers : fallbackTrackers

  const payload = {
    trackers: effectiveTrackers,
    states: normalizedStates,
    employees: sanitizeEmployees(extractArrayPayload(employees)),
    unreadCount: unreadCount.value ?? unreadCount.count ?? 0,
    rules: extractArrayPayload(rules),
    tariffs: extractArrayPayload(tariffs),
    history: normalizedHistory,
    mileage: extractObjectPayload(mileage, ['result', 'mileage', 'data']),
    dateKeys: { todayKey, yesterdayKey },
  }

  dashboardCache = { data: payload, ts: Date.now() }
  return payload
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'teliman-tracking-fleeti-v3',
    cacheTtlMs: CACHE_TTL_MS,
    privateApiConfigured: PRIVATE_API_CONFIGURED,
    timestamp: new Date().toISOString(),
  })
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
    const employeesByTracker = {}
    for (const employee of (data.employees ?? [])) {
      for (const trackerId of extractEmployeeTrackerIds(employee)) {
        if (!Number.isFinite(trackerId)) continue
        employeesByTracker[trackerId] = employee
      }
    }
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email et mot de passe obligatoires.' })
  }
  const user = findAuthUser(email)
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Adresse email non autorisée.' })
  }
  const passwordHash = hashPassword(password, user.salt)
  if (!secureCompare(passwordHash, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' })
  }
  return res.json({ ok: true, sessionToken: APP_SESSION_TOKEN, user: { email: user.email, role: user.role, permissions: user.permissions || [] } })
})

app.get('/api/auth/me', (req, res) => {
  const email = String(req.get('x-user-email') || '').trim().toLowerCase()
  const sessionToken = String(req.get('x-session-token') || '').trim()
  const user = findAuthUser(email)
  if (!user || !secureCompare(sessionToken, APP_SESSION_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'Session invalide. Merci de vous reconnecter.' })
  }
  return res.json({ ok: true, user: { email: user.email, role: user.role, permissions: user.permissions || [] } })
})

app.get('/api/admin/users', requirePermission('manage_users'), (_req, res) => {
  return res.json({ ok: true, items: AUTH_USERS.map(sanitizeUserOutput) })
})

app.post('/api/admin/users', requirePermission('manage_users'), (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const role = String(req.body?.role || 'user').trim().toLowerCase()
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.map((entry) => String(entry || '').trim()).filter(Boolean) : []
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email et mot de passe obligatoires.' })
  if (findAuthUser(email)) return res.status(409).json({ ok: false, error: 'Cet utilisateur existe déjà.' })
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)
  const nextUsers = [...AUTH_USERS, { email, role, permissions: normalizeUserPermissions(role, permissions), salt, passwordHash }]
  saveAuthUsers(nextUsers)
  return res.status(201).json({ ok: true, user: sanitizeUserOutput(findAuthUser(email)) })
})

app.patch('/api/admin/users/:email', requirePermission('manage_users'), (req, res) => {
  const actor = req.authUser || null
  const targetEmail = String(req.params.email || '').trim().toLowerCase()
  const existing = findAuthUser(targetEmail)
  if (!existing) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' })

  const role = String(req.body?.role || existing.role).trim().toLowerCase()
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions.map((entry) => String(entry || '').trim()).filter(Boolean) : existing.permissions
  const password = String(req.body?.password || '')

  if (targetEmail === actor?.email && role !== 'admin') {
    return res.status(400).json({ ok: false, error: 'Vous ne pouvez pas retirer vos propres droits administrateur.' })
  }

  const updatedUsers = AUTH_USERS.map((item) => {
    if (item.email !== targetEmail) return item
    const next = { ...item, role, permissions: normalizeUserPermissions(role, permissions) }
    if (password) {
      const salt = crypto.randomBytes(16).toString('hex')
      next.salt = salt
      next.passwordHash = hashPassword(password, salt)
    }
    return next
  })
  saveAuthUsers(updatedUsers)
  return res.json({ ok: true, user: sanitizeUserOutput(findAuthUser(targetEmail)) })
})

app.delete('/api/admin/users/:email', requirePermission('manage_users'), (req, res) => {
  const actor = req.authUser || null
  const targetEmail = String(req.params.email || '').trim().toLowerCase()
  if (!findAuthUser(targetEmail)) return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' })
  if (targetEmail === actor?.email) {
    return res.status(400).json({ ok: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' })
  }
  saveAuthUsers(AUTH_USERS.filter((item) => item.email !== targetEmail))
  return res.json({ ok: true })
})

app.get('/api/master-data', (_req, res) => {
  res.json(readMasterData())
})

app.post('/api/master-data/:listName', requirePermission('manage_data'), (req, res) => {
  const listName = String(req.params.listName || '')
  if (!['clients', 'goods', 'destinations', 'suppliers', 'purchaseOrders', 'manualTrackers'].includes(listName)) return res.status(400).json({ ok: false, error: 'Liste invalide' })

  const data = readMasterData()

  if (listName === 'purchaseOrders') {
    const client = String(req.body?.client || '').trim()
    const purchaseOrderNumber = String(req.body?.purchaseOrderNumber || req.body?.value || '').trim()
    if (!client || !purchaseOrderNumber) return res.status(400).json({ ok: false, error: 'Client et numéro de bon de commande obligatoires' })
    data.purchaseOrders = { ...(data.purchaseOrders || {}), [client]: purchaseOrderNumber }
    writeMasterData(data)
    return res.status(201).json({ ok: true, data })
  }

  if (listName === 'manualTrackers') {
    const label = String(req.body?.label || req.body?.value || '').trim()
    const driver = String(req.body?.driver || '').trim()
    if (!label || !driver) return res.status(400).json({ ok: false, error: 'Camion et chauffeur obligatoires' })
    const current = normalizeManualTrackers(data.manualTrackers)
    const duplicate = current.find((item) => item.label.toLowerCase() === label.toLowerCase() && item.driver.toLowerCase() === driver.toLowerCase())
    if (duplicate) return res.status(409).json({ ok: false, error: 'Ce camion/chauffeur existe déjà' })
    const nextId = current.length ? Math.max(...current.map((item) => Number(item.id) || 9000000)) + 1 : 9000001
    data.manualTrackers = [...current, { id: nextId, label, driver }]
    writeMasterData(data)
    return res.status(201).json({ ok: true, data })
  }

  const value = String(req.body?.value || '').trim()
  if (!value) return res.status(400).json({ ok: false, error: 'Valeur obligatoire' })

  data[listName] = Array.from(new Set([...(data[listName] || []), value]))
  writeMasterData(data)
  res.status(201).json({ ok: true, data })
})

app.delete('/api/master-data/:listName', requirePermission('manage_data'), (req, res) => {
  const listName = String(req.params.listName || '')
  if (!['clients', 'goods', 'destinations', 'suppliers', 'purchaseOrders', 'manualTrackers'].includes(listName)) return res.status(400).json({ ok: false, error: 'Liste invalide' })

  const data = readMasterData()

  if (listName === 'purchaseOrders') {
    const client = String(req.query.client || req.query.value || '').trim()
    if (!client) return res.status(400).json({ ok: false, error: 'Client obligatoire' })
    const next = { ...(data.purchaseOrders || {}) }
    delete next[client]
    data.purchaseOrders = next
    writeMasterData(data)
    return res.json({ ok: true, data })
  }

  if (listName === 'manualTrackers') {
    const targetId = Number(req.query.id || req.query.value)
    if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ ok: false, error: 'Identifiant camion invalide' })
    data.manualTrackers = normalizeManualTrackers(data.manualTrackers).filter((item) => Number(item.id) !== targetId)
    writeMasterData(data)
    return res.json({ ok: true, data })
  }

  const value = String(req.query.value || '').trim()
  if (!value) return res.status(400).json({ ok: false, error: 'Valeur obligatoire' })

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

app.post('/api/delivery-orders', requirePermission('manage_delivery_orders'), (req, res) => {
  try {
    const items = readDeliveryOrders()
    const preparedBody = preprocessDeliveryProofPhotos(req.body)
    const payload = sanitizeDeliveryOrderPayload(preparedBody)
    const normalized = items.map((item) => Number(item.trackerId) === Number(payload.trackerId) && payload.active ? { ...item, active: false } : item)
    normalized.unshift(payload)
    writeDeliveryOrders(normalized)
    res.status(201).json({ ok: true, item: payload })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.patch('/api/delivery-orders/:id', requirePermission('manage_delivery_orders'), (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })

    const items = readDeliveryOrders()
    const current = items.find((item) => Number(item.id) === id)
    if (!current) return res.status(404).json({ ok: false, error: 'Bon introuvable' })

    const preparedBody = preprocessDeliveryProofPhotos(req.body, current)
    const updatedItem = sanitizeDeliveryOrderPayload(preparedBody, current)
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

app.delete('/api/delivery-orders/:id', requirePermission('manage_delivery_orders'), (req, res) => {
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

app.get('/api/fuel-voucher/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })
  const item = readFuelVouchers().find((entry) => Number(entry.id) === id)
  if (!item) return res.status(404).json({ ok: false, error: 'Bon carburant introuvable' })
  res.json({ item })
})

app.get('/api/fuel-live', async (_req, res) => {
  try {
    res.json(await loadLiveFuelLevels())
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Impossible de charger les niveaux de carburant live.' })
  }
})

app.get('/api/cameras', async (_req, res) => {
  try {
    res.json(await loadCameraAssets())
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Impossible de charger les caméras.' })
  }
})

app.post('/api/fuel-vouchers', requirePermission('manage_fuel_vouchers'), (req, res) => {
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

app.patch('/api/fuel-vouchers/:id', requirePermission('manage_fuel_vouchers'), (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })

    const items = readFuelVouchers()
    const current = items.find((item) => Number(item.id) === id)
    if (!current) return res.status(404).json({ ok: false, error: 'Bon carburant introuvable' })

    const updated = sanitizeFuelVoucherPayload(req.body, current)
    const next = items.map((item) => Number(item.id) === id ? updated : item)
    writeFuelVouchers(next)
    res.json({ ok: true, item: updated })
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message })
  }
})

app.delete('/api/fuel-vouchers/:id', requirePermission('manage_fuel_vouchers'), (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identifiant invalide' })
  const items = readFuelVouchers()
  const filtered = items.filter((item) => Number(item.id) !== id)
  writeFuelVouchers(filtered)
  res.json({ ok: true })
})

function flattenTrackSegments(payload = null) {
  const queue = [...extractArrayPayload(payload, ['list', 'segments', 'tracks', 'items', 'results', 'data', 'result'])]
  const flattened = []

  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue

    const nested = [
      ...(Array.isArray(current?.segments) ? current.segments : []),
      ...(Array.isArray(current?.tracks) ? current.tracks : []),
      ...(Array.isArray(current?.list) ? current.list : []),
      ...(Array.isArray(current?.items) ? current.items : []),
      ...(Array.isArray(current?.results) ? current.results : []),
      ...(Array.isArray(current?.data) ? current.data : []),
      ...(Array.isArray(current?.result) ? current.result : []),
    ]
    if (nested.length) queue.push(...nested)

    const hasTripMarkers = Boolean(
      current?.from || current?.to || current?.start || current?.end || current?.started_at || current?.ended_at || current?.start_time || current?.end_time || current?.date_from || current?.date_to,
    )
    if (hasTripMarkers) flattened.push(current)
  }

  return flattened
}

async function readTrackBundle(hash, trackerId, from, to) {
  const [segmentsPayload, pointsPayload, eventsPayload] = await Promise.all([
    apiCall('track/list', { hash, tracker_id: trackerId, from, to }).catch(() => ({ list: [] })),
    apiCall('track/read', { hash, tracker_id: trackerId, from, to }).catch(() => ({ list: [] })),
    apiCall('history/tracker/list', { hash, trackers: [trackerId], from, to, limit: 300 }).catch(() => ({ list: [] })),
  ])

  const segments = flattenTrackSegments(segmentsPayload)
  const points = extractArrayPayload(pointsPayload, ['list', 'points', 'tracks', 'items', 'results', 'data', 'result'])
    .map(normalizeTrackPoint)
    .filter(Boolean)
  const events = extractArrayPayload(eventsPayload, ['list', 'events', 'items', 'results', 'data', 'result'])
    .map(normalizeTrackEvent)
    .filter((event) => {
      const eventTrackerId = Number(event?.tracker_id ?? event?.trackerId ?? event?.tracker?.id ?? trackerId)
      return Number.isFinite(eventTrackerId) ? eventTrackerId === Number(trackerId) : true
    })

  return {
    trackerId,
    from,
    to,
    segments,
    points,
    events,
  }
}

app.get('/api/tracks', async (req, res) => {
  try {
    const trackerId = ensureValidTrackerId(req.query.trackerId)
    if (!trackerId) return res.status(400).json({ ok: false, error: 'Tracker invalide' })
    const from = req.query.from || getDateRange('1h').from
    const to = req.query.to || getDateRange('1h').to

    if (!PRIVATE_API_CONFIGURED) {
      return res.status(503).json({ ok: false, error: 'API privée Fleeti non configurée.' })
    }

    let hash = ''
    try {
      hash = await authenticate()
    } catch (authError) {
      const bundle = buildPublicCacheTrackBundle(trackerId, from, to, { authFallback: true })
      return res.json({
        ...bundle,
        warning: `Trajets calculés depuis la télémétrie Fleeti publique collectée, car l’API privée track/list est temporairement indisponible (${authError.message || 'erreur API'}).`,
      })
    }

    const privateBundle = await readTrackBundle(hash, trackerId, from, to)
    const hasPrivateData = (privateBundle.points?.length || 0) + (privateBundle.events?.length || 0) + (privateBundle.segments?.length || 0) > 0
    const bundle = hasPrivateData ? privateBundle : buildTrackBundleFromPublicCache(trackerId, from, to)
    return res.json({ ...bundle, source: hasPrivateData ? 'private' : 'public-cache', degraded: !hasPrivateData })
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message || 'Impossible de récupérer les trajets depuis l’API privée Fleeti.' })
  }
})

app.post('/api/tracks/batch', async (req, res) => {
  try {
    const trackerIds = Array.isArray(req.body.trackerIds)
      ? Array.from(new Set(req.body.trackerIds.map((value) => ensureValidTrackerId(value)).filter(Boolean))).slice(0, 100)
      : []
    if (!trackerIds.length) return res.status(400).json({ ok: false, error: 'Aucun tracker valide fourni' })

    const period = String(req.body.period || '1h')
    const range = getDateRange(period)
    const from = req.body.from || range.from
    const to = req.body.to || range.to
    const cacheKey = JSON.stringify({ trackerIds: [...trackerIds].sort((a, b) => a - b), from, to, period })
    const cached = tracksBatchCache.get(cacheKey)
    if (cached && (Date.now() - cached.ts) < TRACKS_BATCH_CACHE_TTL_MS) {
      return res.json({ ...cached.data, cached: true })
    }

    if (!PRIVATE_API_CONFIGURED) {
      return res.status(503).json({ ok: false, error: 'API privée Fleeti non configurée.' })
    }

    let hash = ''
    try {
      hash = await authenticate()
    } catch (authError) {
      const items = trackerIds.map((trackerId) => buildPublicCacheTrackBundle(trackerId, from, to, { authFallback: true }))
      const responsePayload = {
        from,
        to,
        period,
        source: 'public-cache',
        degraded: true,
        authFallback: true,
        warning: `Trajets calculés depuis la télémétrie Fleeti publique collectée, car l’API privée track/list est temporairement indisponible (${authError.message || 'erreur API'}).`,
        failed: [],
        items,
      }
      tracksBatchCache.set(cacheKey, { ts: Date.now(), data: responsePayload })
      return res.json(responsePayload)
    }

    const settled = await Promise.allSettled(trackerIds.map(async (trackerId) => {
      const privateBundle = await readTrackBundle(hash, trackerId, from, to)
      const hasPrivateData = (privateBundle.points?.length || 0) + (privateBundle.events?.length || 0) + (privateBundle.segments?.length || 0) > 0
      const bundle = hasPrivateData ? privateBundle : buildTrackBundleFromPublicCache(trackerId, from, to)
      const points = bundle.points || []
      const lastTwoPoints = points.length >= 2 ? points.slice(-2) : []
      return { ...bundle, lastTwoPoints, source: hasPrivateData ? 'private' : 'public-cache', degraded: !hasPrivateData }
    }))

    const items = []
    const failed = []

    settled.forEach((entry, index) => {
      if (entry.status === 'fulfilled') {
        items.push(entry.value)
        return
      }
      failed.push({ trackerId: trackerIds[index], error: entry.reason?.message || 'Erreur de récupération' })
    })

    if (!items.length) {
      const firstError = failed[0]?.error || 'Impossible de récupérer les trajets depuis l’API privée Fleeti.'
      return res.status(502).json({ ok: false, error: firstError, failed })
    }

    const degradedCount = items.filter((item) => item?.degraded).length
    const responseSource = degradedCount === 0 ? 'private' : (degradedCount === items.length ? 'public-cache' : 'mixed')
    const sourceWarning = responseSource === 'private'
      ? ''
      : 'Trajets calculés depuis la télémétrie Fleeti publique collectée, car l’API privée track/list ne renvoie pas ces trackers.'
    const warning = [
      failed.length ? `${failed.length} tracker(s) n’ont pas pu être chargés pour cette période.` : '',
      sourceWarning,
    ].filter(Boolean).join(' ')

    const responsePayload = { from, to, period, source: responseSource, degraded: degradedCount > 0, warning, failed, items }
    tracksBatchCache.set(cacheKey, { ts: Date.now(), data: responsePayload })
    return res.json(responsePayload)
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message || 'Impossible de récupérer les trajets depuis l’API privée Fleeti.' })
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
