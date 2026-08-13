// Module base de données SQLite — remplace le stockage JSON fichier par fichier
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

let db = null

export function initDatabase(dbPath) {
  if (db) db.close()
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  
  createTables()
  return db
}

export function closeDatabase() {
  if (db) db.close()
  db = null
}

export function getDatabase() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_orders (
      id INTEGER PRIMARY KEY,
      trackerId INTEGER NOT NULL,
      truckLabel TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      loadingPoint TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT '',
      goods TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Prévu',
      date TEXT,
      departureDateTime TEXT,
      arrivalDateTime TEXT,
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      completedAt TEXT,
      proofNote TEXT NOT NULL DEFAULT '',
      proofStatus TEXT NOT NULL DEFAULT 'En attente',
      proofPhotoDataUrl TEXT NOT NULL DEFAULT '',
      proofPhotoDataUrls TEXT NOT NULL DEFAULT '[]'
    );
    
    CREATE INDEX IF NOT EXISTS idx_delivery_tracker ON delivery_orders(trackerId);
    CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_orders(status);
    CREATE INDEX IF NOT EXISTS idx_delivery_active ON delivery_orders(active);
    CREATE INDEX IF NOT EXISTS idx_delivery_ref ON delivery_orders(reference);
    CREATE INDEX IF NOT EXISTS idx_delivery_date ON delivery_orders(date);
    
    CREATE TABLE IF NOT EXISTS fuel_vouchers (
      id INTEGER PRIMARY KEY,
      trackerId INTEGER NOT NULL,
      truckLabel TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      voucherNumber TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      dateTime TEXT NOT NULL DEFAULT '',
      quantityLiters REAL NOT NULL DEFAULT 0,
      unitPrice REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT '',
      proofPhotoDataUrl TEXT NOT NULL DEFAULT '',
      proofPhotoDataUrls TEXT NOT NULL DEFAULT '[]'
    );
    
    CREATE INDEX IF NOT EXISTS idx_fuel_tracker ON fuel_vouchers(trackerId);
    CREATE INDEX IF NOT EXISTS idx_fuel_date ON fuel_vouchers(dateTime);
    
    CREATE TABLE IF NOT EXISTS auth_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions TEXT NOT NULL DEFAULT '[]',
      salt TEXT NOT NULL,
      passwordHash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES auth_users(email) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_email);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
    
    CREATE TABLE IF NOT EXISTS master_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '[]'
    );
    
    CREATE TABLE IF NOT EXISTS driver_overrides (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS geofences (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'autre',
      lat REAL NOT NULL DEFAULT 0,
      lng REAL NOT NULL DEFAULT 0,
      radiusMeters REAL NOT NULL DEFAULT 1000,
      color TEXT NOT NULL DEFAULT '#946239',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_geofences_active ON geofences(active);

    CREATE TABLE IF NOT EXISTS alert_recipients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_recipients_active ON alert_recipients(active);

    CREATE TABLE IF NOT EXISTS geofence_events (
      id INTEGER PRIMARY KEY,
      geofenceId INTEGER NOT NULL,
      geofenceName TEXT NOT NULL DEFAULT '',
      trackerId INTEGER NOT NULL,
      truckLabel TEXT NOT NULL DEFAULT '',
      eventType TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL DEFAULT 0,
      lng REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT '',
      notified INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_geofence_events_created ON geofence_events(createdAt);

    CREATE TABLE IF NOT EXISTS alert_actions (
      alertKey TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'new',
      priority TEXT,
      assignedTo TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      acknowledgedAt TEXT,
      resolvedAt TEXT,
      history TEXT NOT NULL DEFAULT '[]',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mission_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deliveryOrderId INTEGER NOT NULL,
      trackerId INTEGER,
      eventType TEXT NOT NULL DEFAULT 'event',
      label TEXT DEFAULT '',
      lat REAL,
      lng REAL,
      at TEXT NOT NULL,
      actor TEXT DEFAULT 'auto'
    );
    CREATE INDEX IF NOT EXISTS idx_mission_timeline_order ON mission_timeline(deliveryOrderId, at);

    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      phone TEXT PRIMARY KEY,
      lastInboundAt TEXT,
      lastOutboundAt TEXT,
      inboundCount INTEGER NOT NULL DEFAULT 0,
      outboundCount INTEGER NOT NULL DEFAULT 0
    );
  `)
}

// ── Delivery Orders ──

export function readDeliveryOrders() {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM delivery_orders ORDER BY id DESC').all()
  return rows.map(row => ({
    ...row,
    active: Boolean(row.active),
    proofPhotoDataUrls: JSON.parse(row.proofPhotoDataUrls || '[]'),
  }))
}

export function readDeliveryOrderById(id) {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    active: Boolean(row.active),
    proofPhotoDataUrls: JSON.parse(row.proofPhotoDataUrls || '[]'),
  }
}


export function insertDeliveryOrder(item) {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO delivery_orders (id, trackerId, truckLabel, driver, reference, client, loadingPoint, destination, goods, quantity, status, date, departureDateTime, arrivalDateTime, notes, active, completedAt, proofNote, proofStatus, proofPhotoDataUrl, proofPhotoDataUrls)
    VALUES (@id, @trackerId, @truckLabel, @driver, @reference, @client, @loadingPoint, @destination, @goods, @quantity, @status, @date, @departureDateTime, @arrivalDateTime, @notes, @active, @completedAt, @proofNote, @proofStatus, @proofPhotoDataUrl, @proofPhotoDataUrls)
  `)
  stmt.run({
    ...item,
    active: item.active ? 1 : 0,
    proofPhotoDataUrls: JSON.stringify(item.proofPhotoDataUrls || []),
  })
}

export function updateDeliveryOrder(id, updates) {
  const db = getDatabase()
  const sets = []
  const params = { id }
  
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'active') {
      sets.push('active = @active')
      params.active = value ? 1 : 0
    } else if (key === 'proofPhotoDataUrls') {
      sets.push('proofPhotoDataUrls = @proofPhotoDataUrls')
      params.proofPhotoDataUrls = JSON.stringify(value || [])
    } else {
      sets.push(`${key} = @${key}`)
      params[key] = value
    }
  }
  
  if (sets.length === 0) throw new Error('Aucune modification fournie')
  const result = db.prepare(`UPDATE delivery_orders SET ${sets.join(', ')} WHERE id = @id`).run(params)
  if (result.changes !== 1) throw new Error('Bon de livraison introuvable')
}

export function deleteDeliveryOrder(id) {
  const result = getDatabase().prepare('DELETE FROM delivery_orders WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Bon de livraison introuvable')
}

export function insertDeliveryOrderAtomic(item) {
  return getDatabase().transaction((payload) => {
    if (payload.active) setDeliveryOrderActiveOnTracker(payload.trackerId)
    insertDeliveryOrder(payload)
    return readDeliveryOrderById(payload.id)
  }).immediate(item)
}

export function updateDeliveryOrderAtomic(id, updates) {
  return getDatabase().transaction((targetId, payload) => {
    if (!readDeliveryOrderById(targetId)) throw new Error('Bon de livraison introuvable')
    if (payload.active) setDeliveryOrderActiveOnTracker(payload.trackerId, targetId)
    updateDeliveryOrder(targetId, payload)
    return readDeliveryOrderById(targetId)
  }).immediate(id, updates)
}

export function setDeliveryOrderActiveOnTracker(trackerId, exceptId = null) {
  const db = getDatabase()
  if (exceptId) {
    db.prepare('UPDATE delivery_orders SET active = 0 WHERE trackerId = ? AND id != ? AND active = 1').run(trackerId, exceptId)
  } else {
    db.prepare('UPDATE delivery_orders SET active = 0 WHERE trackerId = ? AND active = 1').run(trackerId)
  }
}

// ── Fuel Vouchers ──

export function readFuelVouchers() {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM fuel_vouchers ORDER BY id DESC').all()
  return rows.map(row => ({
    ...row,
    proofPhotoDataUrls: JSON.parse(row.proofPhotoDataUrls || '[]'),
  }))
}

export function insertFuelVoucher(item) {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO fuel_vouchers (id, trackerId, truckLabel, driver, client, voucherNumber, supplier, dateTime, quantityLiters, unitPrice, amount, createdAt, proofPhotoDataUrl, proofPhotoDataUrls)
    VALUES (@id, @trackerId, @truckLabel, @driver, @client, @voucherNumber, @supplier, @dateTime, @quantityLiters, @unitPrice, @amount, @createdAt, @proofPhotoDataUrl, @proofPhotoDataUrls)
  `)
  stmt.run({
    ...item,
    proofPhotoDataUrls: JSON.stringify(item.proofPhotoDataUrls || []),
  })
}

export function updateFuelVoucher(id, updates) {
  const db = getDatabase()
  const sets = []
  const params = { id }
  
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'proofPhotoDataUrls') {
      sets.push('proofPhotoDataUrls = @proofPhotoDataUrls')
      params.proofPhotoDataUrls = JSON.stringify(value || [])
    } else {
      sets.push(`${key} = @${key}`)
      params[key] = value
    }
  }
  
  if (sets.length === 0) throw new Error('Aucune modification fournie')
  const result = db.prepare(`UPDATE fuel_vouchers SET ${sets.join(', ')} WHERE id = @id`).run(params)
  if (result.changes !== 1) throw new Error('Bon carburant introuvable')
}

export function deleteFuelVoucher(id) {
  const result = getDatabase().prepare('DELETE FROM fuel_vouchers WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Bon carburant introuvable')
}

// ── Auth Users / Sessions ──

function parseStringArray(value) {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) throw new Error('Permissions utilisateur corrompues')
  return parsed
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function readAuthUsers() {
  const rows = getDatabase().prepare('SELECT * FROM auth_users ORDER BY email').all()
  return rows.map((row) => ({ ...row, permissions: parseStringArray(row.permissions) }))
}

export function createAuthUser(email, data) {
  const normalized = normalizeEmail(email)
  if (!normalized || !data?.salt || !data?.passwordHash) throw new Error('Compte utilisateur invalide')
  getDatabase().prepare('INSERT INTO auth_users (email, role, permissions, salt, passwordHash) VALUES (?, ?, ?, ?, ?)')
    .run(normalized, data.role || 'user', JSON.stringify(data.permissions || []), data.salt, data.passwordHash)
}

export function upsertAuthUser(email, data) {
  const normalized = normalizeEmail(email)
  if (!normalized || !data?.salt || !data?.passwordHash) throw new Error('Compte utilisateur invalide')
  getDatabase().prepare(`
    INSERT INTO auth_users (email, role, permissions, salt, passwordHash)
    VALUES (@email, @role, @permissions, @salt, @passwordHash)
    ON CONFLICT(email) DO UPDATE SET role=@role, permissions=@permissions, salt=@salt, passwordHash=@passwordHash
  `).run({ email: normalized, role: data.role || 'user', permissions: JSON.stringify(data.permissions || []), salt: data.salt, passwordHash: data.passwordHash })
}

export function deleteAuthUser(email) {
  const result = getDatabase().prepare('DELETE FROM auth_users WHERE email = ?').run(normalizeEmail(email))
  if (result.changes !== 1) throw new Error('Utilisateur introuvable')
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
}

export function createAuthSession(token, email, expiresAt) {
  if (String(token || '').length < 32 || !Number.isFinite(Date.parse(expiresAt))) throw new Error('Session invalide')
  getDatabase().prepare('INSERT INTO auth_sessions (token_hash, user_email, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashSessionToken(token), normalizeEmail(email), expiresAt, new Date().toISOString())
}

export function resolveAuthSession(token, now = new Date(), idleTtlMs = 0, refreshThresholdMs = 0) {
  if (!token) return null
  const db = getDatabase()
  const nowIso = now.toISOString()
  const tokenHash = hashSessionToken(token)
  const row = db.prepare(`SELECT u.email, u.role, u.permissions, s.expires_at FROM auth_sessions s JOIN auth_users u ON u.email=s.user_email WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .get(tokenHash, nowIso)
  if (row && Number.isFinite(idleTtlMs) && idleTtlMs > 0) {
    const nextExpiry = new Date(now.getTime() + idleTtlMs)
    const threshold = Math.max(0, Number(refreshThresholdMs) || 0)
    if (nextExpiry.getTime() - Date.parse(row.expires_at) >= threshold) {
      db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at > ?')
        .run(nextExpiry.toISOString(), tokenHash, nowIso)
    }
  }
  return row ? { email: row.email, role: row.role, permissions: parseStringArray(row.permissions) } : null
}

export function revokeAuthSession(token) {
  if (!token) return false
  return getDatabase().prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
    .run(new Date().toISOString(), hashSessionToken(token)).changes === 1
}

export function revokeUserSessions(email) {
  return getDatabase().prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_email=? AND revoked_at IS NULL')
    .run(new Date().toISOString(), normalizeEmail(email)).changes
}

export function purgeExpiredAuthSessions(now = new Date()) {
  return getDatabase().prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL')
    .run(now.toISOString()).changes
}

export function deleteAuthUserAndSessions(email) {
  return getDatabase().transaction((targetEmail) => {
    revokeUserSessions(targetEmail)
    deleteAuthUser(targetEmail)
  }).immediate(normalizeEmail(email))
}

export function purgeExpiredSessions(now = new Date()) {
  return getDatabase().prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now.toISOString()).changes
}

// ── Master Data ──

export function readMasterData() {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM master_data').all()
  const data = {}
  for (const row of rows) {
    try { data[row.key] = JSON.parse(row.value) } catch { data[row.key] = [] }
  }
  return data
}

export function readMasterDataKey(key) {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM master_data WHERE key = ?').get(key)
  if (!row) return []
  try { return JSON.parse(row.value) } catch { return [] }
}

export function writeMasterDataKey(key, value) {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO master_data (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
}

// ── Driver Overrides ──

export function readDriverOverrides() {
  const db = getDatabase()
  const rows = db.prepare('SELECT id, data FROM driver_overrides').all()
  return rows.map(row => {
    try { return { id: row.id, ...JSON.parse(row.data) } } catch { return { id: row.id } }
  })
}

export function upsertDriverOverride(trackerId, data) {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO driver_overrides (id, data) VALUES (?, ?)').run(String(trackerId), JSON.stringify(data || {}))
}

export function deleteDriverOverride(trackerId) {
  const result = getDatabase().prepare('DELETE FROM driver_overrides WHERE id = ?').run(String(trackerId))
  if (result.changes !== 1) throw new Error('Override introuvable')
}

export function replaceDriverOverridesAtomic(overrides) {
  return getDatabase().transaction((items) => {
    getDatabase().prepare('DELETE FROM driver_overrides').run()
    const insert = getDatabase().prepare('INSERT INTO driver_overrides (id, data) VALUES (?, ?)')
    for (const [id, value] of Object.entries(items || {})) {
      if (!id.trim() || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Override invalide')
      insert.run(id.trim(), JSON.stringify(value))
    }
  }).immediate(overrides)
}

export function checkDatabaseHealth() {
  const database = getDatabase()
  if (database.prepare('SELECT 1 AS ok').get()?.ok !== 1 || database.pragma('quick_check', { simple: true }) !== 'ok') {
    throw new Error('Base SQLite indisponible')
  }
  return true
}

export function checkDatabaseHealthFresh(dbPath) {
  const database = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    if (database.prepare('SELECT 1 AS ok').get()?.ok !== 1 || database.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new Error('Base SQLite indisponible')
    }
    return true
  } finally {
    database.close()
  }
}

export function runInTransaction(callback) {
  if (typeof callback !== 'function') throw new Error('Transaction invalide')
  return getDatabase().transaction(callback).immediate()
}

// ── Geofences ──

export function readGeofences() {
  const rows = getDatabase().prepare('SELECT * FROM geofences ORDER BY id ASC').all()
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }))
}

export function readActiveGeofences() {
  const rows = getDatabase().prepare('SELECT * FROM geofences WHERE active = 1 ORDER BY id ASC').all()
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }))
}

export function readGeofenceById(id) {
  const row = getDatabase().prepare('SELECT * FROM geofences WHERE id = ?').get(id)
  if (!row) return null
  return { ...row, active: Boolean(row.active) }
}

export function insertGeofence(item) {
  const db = getDatabase()
  const hasId = Number.isInteger(Number(item.id))
  const stmt = db.prepare(`
    INSERT INTO geofences (${hasId ? 'id, ' : ''}name, type, lat, lng, radiusMeters, color, active, createdAt)
    VALUES (${hasId ? '@id, ' : ''}@name, @type, @lat, @lng, @radiusMeters, @color, @active, @createdAt)
  `)
  const info = stmt.run({
    ...(hasId ? { id: Number(item.id) } : {}),
    name: item.name || '',
    type: item.type || 'autre',
    lat: Number(item.lat) || 0,
    lng: Number(item.lng) || 0,
    radiusMeters: Number(item.radiusMeters) || 1000,
    color: item.color || '#946239',
    active: item.active ? 1 : 0,
    createdAt: item.createdAt || new Date().toISOString(),
  })
  return readGeofenceById(hasId ? Number(item.id) : Number(info.lastInsertRowid))
}

export function updateGeofence(id, updates) {
  const db = getDatabase()
  const sets = []
  const params = { id }
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'active') {
      sets.push('active = @active')
      params.active = value ? 1 : 0
    } else {
      sets.push(`${key} = @${key}`)
      params[key] = value
    }
  }
  if (sets.length === 0) throw new Error('Aucune modification fournie')
  const result = db.prepare(`UPDATE geofences SET ${sets.join(', ')} WHERE id = @id`).run(params)
  if (result.changes !== 1) throw new Error('Géofence introuvable')
  return readGeofenceById(id)
}

export function deleteGeofence(id) {
  const result = getDatabase().prepare('DELETE FROM geofences WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Géofence introuvable')
}

export function insertGeofencesAtomic(items) {
  return getDatabase().transaction((geofences) => {
    const insert = getDatabase().prepare(`
      INSERT INTO geofences (id, name, type, lat, lng, radiusMeters, color, active, createdAt)
      VALUES (@id, @name, @type, @lat, @lng, @radiusMeters, @color, @active, @createdAt)
    `)
    for (const item of geofences) {
      insert.run({
        id: item.id,
        name: item.name,
        type: item.type,
        lat: item.lat,
        lng: item.lng,
        radiusMeters: item.radiusMeters,
        color: item.color,
        active: item.active ? 1 : 0,
        createdAt: item.createdAt || new Date().toISOString(),
      })
    }
  }).immediate(items)
}

// ── Alert Recipients ──

export function readAlertRecipients() {
  const rows = getDatabase().prepare('SELECT * FROM alert_recipients ORDER BY id ASC').all()
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }))
}

export function readActiveAlertRecipients() {
  const rows = getDatabase().prepare('SELECT * FROM alert_recipients WHERE active = 1 ORDER BY id ASC').all()
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }))
}

export function readAlertRecipientById(id) {
  const row = getDatabase().prepare('SELECT * FROM alert_recipients WHERE id = ?').get(id)
  if (!row) return null
  return { ...row, active: Boolean(row.active) }
}

export function insertAlertRecipient(item) {
  const db = getDatabase()
  const hasId = Number.isInteger(Number(item.id))
  const stmt = db.prepare(`
    INSERT INTO alert_recipients (${hasId ? 'id, ' : ''}name, phone, active, createdAt)
    VALUES (${hasId ? '@id, ' : ''}@name, @phone, @active, @createdAt)
  `)
  const info = stmt.run({
    ...(hasId ? { id: Number(item.id) } : {}),
    name: item.name || '',
    phone: item.phone || '',
    active: item.active ? 1 : 0,
    createdAt: item.createdAt || new Date().toISOString(),
  })
  return readAlertRecipientById(hasId ? Number(item.id) : Number(info.lastInsertRowid))
}

export function updateAlertRecipient(id, updates) {
  const db = getDatabase()
  const sets = []
  const params = { id }
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'active') {
      sets.push('active = @active')
      params.active = value ? 1 : 0
    } else {
      sets.push(`${key} = @${key}`)
      params[key] = value
    }
  }
  if (sets.length === 0) throw new Error('Aucune modification fournie')
  const result = db.prepare(`UPDATE alert_recipients SET ${sets.join(', ')} WHERE id = @id`).run(params)
  if (result.changes !== 1) throw new Error('Destinataire introuvable')
  return readAlertRecipientById(id)
}

export function deleteAlertRecipient(id) {
  const result = getDatabase().prepare('DELETE FROM alert_recipients WHERE id = ?').run(id)
  if (result.changes !== 1) throw new Error('Destinataire introuvable')
}

// ── Geofence Events ──

export function readGeofenceEvents(limit = 50, offset = 0) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500))
  const safeOffset = Math.max(0, Number(offset) || 0)
  const rows = getDatabase()
    .prepare('SELECT * FROM geofence_events ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(safeLimit, safeOffset)
  return rows
}

export function countGeofenceEvents() {
  const row = getDatabase().prepare('SELECT COUNT(*) AS total FROM geofence_events').get()
  return Number(row?.total) || 0
}

export function insertGeofenceEvent(item) {
  const db = getDatabase()
  const hasId = Number.isInteger(Number(item.id))
  const stmt = db.prepare(`
    INSERT INTO geofence_events (${hasId ? 'id, ' : ''}geofenceId, geofenceName, trackerId, truckLabel, eventType, lat, lng, createdAt, notified)
    VALUES (${hasId ? '@id, ' : ''}@geofenceId, @geofenceName, @trackerId, @truckLabel, @eventType, @lat, @lng, @createdAt, @notified)
  `)
  const info = stmt.run({
    ...(hasId ? { id: Number(item.id) } : {}),
    geofenceId: Number(item.geofenceId) || 0,
    geofenceName: item.geofenceName || '',
    trackerId: Number(item.trackerId) || 0,
    truckLabel: item.truckLabel || '',
    eventType: item.eventType || '',
    lat: Number(item.lat) || 0,
    lng: Number(item.lng) || 0,
    createdAt: item.createdAt || new Date().toISOString(),
    notified: item.notified ? 1 : 0,
  })
  return hasId ? Number(item.id) : Number(info.lastInsertRowid)
}

export function markGeofenceEventNotified(id) {
  getDatabase().prepare('UPDATE geofence_events SET notified = 1 WHERE id = ?').run(id)
}

// ── Alertes actionnables (cycle de vie) ──

export function readAlertActions() {
  return getDatabase()
    .prepare('SELECT alertKey, status, priority, assignedTo, comment, acknowledgedAt, resolvedAt, history, updatedAt FROM alert_actions ORDER BY updatedAt DESC')
    .all()
    .map((row) => {
      let history = []
      try { history = JSON.parse(row.history || '[]') } catch { /* historique illisible */ }
      return { ...row, history }
    })
}

export function readAlertAction(alertKey) {
  const row = getDatabase().prepare('SELECT * FROM alert_actions WHERE alertKey = ?').get(String(alertKey))
  if (!row) return null
  let history = []
  try { history = JSON.parse(row.history || '[]') } catch { /* historique illisible */ }
  return { ...row, history }
}

export function upsertAlertAction(action) {
  const db = getDatabase()
  const existing = readAlertAction(action.alertKey)
  const merged = {
    alertKey: action.alertKey,
    status: action.status || existing?.status || 'new',
    priority: action.priority || existing?.priority || null,
    assignedTo: action.assignedTo ?? existing?.assignedTo ?? '',
    comment: action.comment ?? existing?.comment ?? '',
    acknowledgedAt: action.acknowledgedAt ?? existing?.acknowledgedAt ?? null,
    resolvedAt: action.resolvedAt ?? existing?.resolvedAt ?? null,
    history: Array.isArray(action.history) ? action.history : existing?.history || [],
    updatedAt: action.updatedAt || new Date().toISOString(),
  }
  db.prepare(`
    INSERT INTO alert_actions (alertKey, status, priority, assignedTo, comment, acknowledgedAt, resolvedAt, history, updatedAt)
    VALUES (@alertKey, @status, @priority, @assignedTo, @comment, @acknowledgedAt, @resolvedAt, @history, @updatedAt)
    ON CONFLICT(alertKey) DO UPDATE SET
      status = excluded.status,
      priority = excluded.priority,
      assignedTo = excluded.assignedTo,
      comment = excluded.comment,
      acknowledgedAt = excluded.acknowledgedAt,
      resolvedAt = excluded.resolvedAt,
      history = excluded.history,
      updatedAt = excluded.updatedAt
  `).run({
    ...merged,
    history: JSON.stringify(merged.history || []),
  })
  return readAlertAction(action.alertKey)
}

export function deleteAlertAction(alertKey) {
  return getDatabase().prepare('DELETE FROM alert_actions WHERE alertKey = ?').run(String(alertKey)).changes
}

// ── Timeline mission (journal des événements d'une mission) ──

export function readMissionTimeline(deliveryOrderId, limit = 100) {
  return getDatabase()
    .prepare('SELECT * FROM mission_timeline WHERE deliveryOrderId = ? ORDER BY at DESC, id DESC LIMIT ?')
    .all(Number(deliveryOrderId), Math.min(Number(limit) || 100, 500))
}

export function appendMissionTimelineEvent(item) {
  const info = getDatabase()
    .prepare('INSERT INTO mission_timeline (deliveryOrderId, trackerId, eventType, label, lat, lng, at, actor) VALUES (@deliveryOrderId, @trackerId, @eventType, @label, @lat, @lng, @at, @actor)')
    .run({
      deliveryOrderId: Number(item.deliveryOrderId),
      trackerId: item.trackerId ? Number(item.trackerId) : null,
      eventType: String(item.eventType || 'event'),
      label: String(item.label || ''),
      lat: Number.isFinite(item.lat) ? item.lat : null,
      lng: Number.isFinite(item.lng) ? item.lng : null,
      at: item.at || new Date().toISOString(),
      actor: String(item.actor || 'auto'),
    })
  return { id: Number(info.lastInsertRowid), ...item }
}

// ── Import / Export (migration) ──

export function importDeliveryOrdersFromJSON(items) {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO delivery_orders (id, trackerId, truckLabel, driver, reference, client, loadingPoint, destination, goods, quantity, status, date, departureDateTime, arrivalDateTime, notes, active, completedAt, proofNote, proofStatus, proofPhotoDataUrl, proofPhotoDataUrls)
    VALUES (@id, @trackerId, @truckLabel, @driver, @reference, @client, @loadingPoint, @destination, @goods, @quantity, @status, @date, @departureDateTime, @arrivalDateTime, @notes, @active, @completedAt, @proofNote, @proofStatus, @proofPhotoDataUrl, @proofPhotoDataUrls)
  `)
  
  const transaction = db.transaction((rows) => {
    for (const item of rows) {
      insert.run({
        id: item.id,
        trackerId: item.trackerId,
        truckLabel: item.truckLabel || '',
        driver: item.driver || '',
        reference: item.reference || '',
        client: item.client || '',
        loadingPoint: item.loadingPoint || '',
        destination: item.destination || '',
        goods: item.goods || '',
        quantity: item.quantity || '',
        status: item.status || 'Prévu',
        date: item.date || null,
        departureDateTime: item.departureDateTime || null,
        arrivalDateTime: item.arrivalDateTime || null,
        notes: item.notes || '',
        active: item.active ? 1 : 0,
        completedAt: item.completedAt || null,
        proofNote: item.proofNote || '',
        proofStatus: item.proofStatus || 'En attente',
        proofPhotoDataUrl: item.proofPhotoDataUrl || '',
        proofPhotoDataUrls: JSON.stringify(item.proofPhotoDataUrls || []),
      })
    }
  })
  
  transaction(items)
}

export function importFuelVouchersFromJSON(items) {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO fuel_vouchers (id, trackerId, truckLabel, driver, client, voucherNumber, supplier, dateTime, quantityLiters, unitPrice, amount, createdAt, proofPhotoDataUrl, proofPhotoDataUrls)
    VALUES (@id, @trackerId, @truckLabel, @driver, @client, @voucherNumber, @supplier, @dateTime, @quantityLiters, @unitPrice, @amount, @createdAt, @proofPhotoDataUrl, @proofPhotoDataUrls)
  `)
  
  const transaction = db.transaction((rows) => {
    for (const item of rows) {
      insert.run({
        id: item.id,
        trackerId: item.trackerId,
        truckLabel: item.truckLabel || '',
        driver: item.driver || '',
        client: item.client || '',
        voucherNumber: item.voucherNumber || '',
        supplier: item.supplier || '',
        dateTime: item.dateTime || '',
        quantityLiters: item.quantityLiters || 0,
        unitPrice: item.unitPrice || 0,
        amount: item.amount || 0,
        createdAt: item.createdAt || '',
        proofPhotoDataUrl: item.proofPhotoDataUrl || '',
        proofPhotoDataUrls: JSON.stringify(item.proofPhotoDataUrls || []),
      })
    }
  })
  
  transaction(items)
}

export function importAuthUsersFromJSON(items) {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO auth_users (email, role, permissions, salt, passwordHash)
    VALUES (@email, @role, @permissions, @salt, @passwordHash)
  `)
  
  const transaction = db.transaction((rows) => {
    for (const item of rows) {
      insert.run({
        email: item.email,
        role: item.role || 'admin',
        permissions: JSON.stringify(item.permissions || []),
        salt: item.salt || '',
        passwordHash: item.passwordHash || '',
      })
    }
  })
  
  transaction(items)
}

export function importMasterDataFromJSON(data) {
  const db = getDatabase()
  const insert = db.prepare('INSERT OR REPLACE INTO master_data (key, value) VALUES (?, ?)')
  
  const transaction = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) {
      insert.run(key, JSON.stringify(value))
    }
  })
  
  transaction(data)
}

export function importDriverOverridesFromJSON(items) {
  const db = getDatabase()
  const insert = db.prepare('INSERT OR REPLACE INTO driver_overrides (id, data) VALUES (?, ?)')
  
  const transaction = db.transaction((rows) => {
    for (const item of rows) {
      const { trackerId, ...rest } = item
      insert.run(String(trackerId), JSON.stringify(rest))
    }
  })
  
  transaction(items)
}

// ── Contacts WhatsApp (fenêtre de conversation 24 h) ──

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000

export function readWhatsAppContact(phone) {
  const row = getDatabase().prepare('SELECT * FROM whatsapp_contacts WHERE phone = ?').get(String(phone || ''))
  return row || null
}

export function touchWhatsAppInbound(phone) {
  if (!phone) return null
  const db = getDatabase()
  const now = new Date().toISOString()
  const existing = readWhatsAppContact(phone)
  if (existing) {
    db.prepare('UPDATE whatsapp_contacts SET lastInboundAt = ?, inboundCount = inboundCount + 1 WHERE phone = ?').run(now, phone)
  } else {
    db.prepare('INSERT INTO whatsapp_contacts (phone, lastInboundAt, inboundCount) VALUES (?, ?, 1)').run(phone, now)
  }
  return readWhatsAppContact(phone)
}

export function bumpWhatsAppOutbound(phone) {
  if (!phone) return null
  const db = getDatabase()
  const now = new Date().toISOString()
  const existing = readWhatsAppContact(phone)
  if (existing) {
    db.prepare('UPDATE whatsapp_contacts SET lastOutboundAt = ?, outboundCount = outboundCount + 1 WHERE phone = ?').run(now, phone)
  } else {
    db.prepare('INSERT INTO whatsapp_contacts (phone, lastOutboundAt, outboundCount) VALUES (?, ?, 1)').run(phone, now)
  }
  return readWhatsAppContact(phone)
}

// Fenêtre de conversation ouverte (le contact a écrit au business < 24 h) → texte libre autorisé
export function isWhatsAppWindowOpen(phone, now = Date.now()) {
  const contact = readWhatsAppContact(phone)
  if (!contact?.lastInboundAt) return false
  const lastInbound = Date.parse(contact.lastInboundAt)
  if (!Number.isFinite(lastInbound)) return false
  return now - lastInbound < WHATSAPP_WINDOW_MS
}

export function countWhatsAppContactsActiveSince(sinceIso) {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM whatsapp_contacts WHERE lastInboundAt >= ? OR lastOutboundAt >= ?')
    .get(sinceIso, sinceIso)
  return row?.n || 0
}
