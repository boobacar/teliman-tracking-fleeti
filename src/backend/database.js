// Module base de données SQLite — remplace le stockage JSON fichier par fichier
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let db = null

export function initDatabase(dbPath) {
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  
  createTables()
  return db
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
    
    CREATE TABLE IF NOT EXISTS master_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '[]'
    );
    
    CREATE TABLE IF NOT EXISTS driver_overrides (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}'
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

export function writeDeliveryOrders(rows) {
  // Replaced by individual CRUD operations in server.js
  // This function signature is kept for compatibility but not used for writes
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
  
  if (sets.length === 0) return
  db.prepare(`UPDATE delivery_orders SET ${sets.join(', ')} WHERE id = @id`).run(params)
}

export function deleteDeliveryOrder(id) {
  getDatabase().prepare('DELETE FROM delivery_orders WHERE id = ?').run(id)
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
  
  if (sets.length === 0) return
  db.prepare(`UPDATE fuel_vouchers SET ${sets.join(', ')} WHERE id = @id`).run(params)
}

export function deleteFuelVoucher(id) {
  getDatabase().prepare('DELETE FROM fuel_vouchers WHERE id = ?').run(id)
}

// ── Auth Users ──

export function readAuthUsers() {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM auth_users').all()
  return rows.map(row => ({
    ...row,
    permissions: JSON.parse(row.permissions || '[]'),
  }))
}

export function upsertAuthUser(email, data) {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO auth_users (email, role, permissions, salt, passwordHash)
    VALUES (@email, @role, @permissions, @salt, @passwordHash)
    ON CONFLICT(email) DO UPDATE SET
      role = @role,
      permissions = @permissions,
      salt = @salt,
      passwordHash = @passwordHash
  `)
  stmt.run({
    email,
    role: data.role || 'admin',
    permissions: JSON.stringify(data.permissions || []),
    salt: data.salt || '',
    passwordHash: data.passwordHash || '',
  })
}

export function deleteAuthUser(email) {
  getDatabase().prepare('DELETE FROM auth_users WHERE email = ?').run(email)
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
    try { return { trackerId: row.id, ...JSON.parse(row.data) } } catch { return { trackerId: row.id } }
  })
}

export function upsertDriverOverride(trackerId, data) {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO driver_overrides (id, data) VALUES (?, ?)').run(String(trackerId), JSON.stringify(data || {}))
}

export function deleteDriverOverride(trackerId) {
  getDatabase().prepare('DELETE FROM driver_overrides WHERE id = ?').run(String(trackerId))
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
