import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  initDatabase,
  closeDatabase,
  createAuthUser,
  createAuthSession,
  resolveAuthSession,
  revokeAuthSession,
  deleteAuthUserAndSessions,
  readAuthUsers,
  insertDeliveryOrderAtomic,
  updateDeliveryOrderAtomic,
  readDeliveryOrderById,
  replaceDriverOverridesAtomic,
  readDriverOverrides,
} from '../src/backend/database.js'
import {
  adminUserSchema,
  adminUserUpdateSchema,
  oilChangeUpdateSchema,
  driverOverridesSchema,
  tracksBatchSchema,
  whatsappTestMessageSchema,
} from '../src/backend/validation.js'

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'teliman-backend-')) }
function passwordMaterial(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return { salt, passwordHash: crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex') }
}

function baseOrder(id, trackerId, active = true) {
  return { id, trackerId, truckLabel: `T-${trackerId}`, driver: '', reference: `BL-${id}`, client: '', loadingPoint: '', destination: '', goods: '', quantity: '', status: 'Prévu', date: null, departureDateTime: null, arrivalDateTime: null, notes: '', active, completedAt: null, proofNote: '', proofStatus: 'En attente', proofPhotoDataUrl: '', proofPhotoDataUrls: [] }
}

test('sessions opaques: identité liée au token, expiration et révocation', () => {
  const dir = tempDir()
  try {
    initDatabase(path.join(dir, 'teliman.db'))
    createAuthUser('limited@example.test', { role: 'user', permissions: ['page_dashboard'], ...passwordMaterial('Correct-Horse-123!') })
    const token = crypto.randomBytes(32).toString('base64url')
    createAuthSession(token, 'limited@example.test', new Date(Date.now() + 60_000).toISOString())
    assert.equal(resolveAuthSession(token).email, 'limited@example.test')
    assert.equal(resolveAuthSession(`${token}x`), null)
    revokeAuthSession(token)
    assert.equal(resolveAuthSession(token), null)
    const expired = crypto.randomBytes(32).toString('base64url')
    createAuthSession(expired, 'limited@example.test', new Date(Date.now() - 1).toISOString())
    assert.equal(resolveAuthSession(expired), null)
  } finally { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('session active: expiration glissante renouvelée après activité', () => {
  const dir = tempDir()
  const day = 24 * 60 * 60 * 1000
  const startedAt = new Date('2026-07-01T08:00:00.000Z')
  try {
    initDatabase(path.join(dir, 'teliman.db'))
    createAuthUser('active@example.test', { role: 'user', permissions: ['page_dashboard'], ...passwordMaterial('Correct-Horse-123!') })
    const token = crypto.randomBytes(32).toString('base64url')
    createAuthSession(token, 'active@example.test', new Date(startedAt.getTime() + 5 * day).toISOString())

    assert.equal(resolveAuthSession(token, startedAt, 30 * day, day)?.email, 'active@example.test')
    assert.equal(resolveAuthSession(token, new Date(startedAt.getTime() + 6 * day))?.email, 'active@example.test')
  } finally { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('suppression utilisateur persiste et révoque toutes ses sessions', () => {
  const dir = tempDir(); const dbPath = path.join(dir, 'teliman.db')
  try {
    initDatabase(dbPath)
    createAuthUser('delete@example.test', { role: 'user', permissions: [], ...passwordMaterial('Correct-Horse-123!') })
    const token = crypto.randomBytes(32).toString('base64url')
    createAuthSession(token, 'delete@example.test', new Date(Date.now() + 60_000).toISOString())
    deleteAuthUserAndSessions('delete@example.test')
    assert.equal(resolveAuthSession(token), null)
    closeDatabase(); initDatabase(dbPath)
    assert.equal(readAuthUsers().some((u) => u.email === 'delete@example.test'), false)
  } finally { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('mutations BL actives sont atomiques, utilisent le nouveau tracker et refusent zéro ligne', () => {
  const dir = tempDir()
  try {
    initDatabase(path.join(dir, 'teliman.db'))
    insertDeliveryOrderAtomic(baseOrder(1, 10, true))
    insertDeliveryOrderAtomic(baseOrder(2, 20, true))
    updateDeliveryOrderAtomic(1, baseOrder(1, 20, true))
    assert.equal(readDeliveryOrderById(2).active, false)
    assert.equal(readDeliveryOrderById(1).trackerId, 20)
    assert.throws(() => updateDeliveryOrderAtomic(999, baseOrder(999, 20, false)), /introuvable/i)
  } finally { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('remplacement overrides rollback intégral sur entrée invalide', () => {
  const dir = tempDir()
  try {
    initDatabase(path.join(dir, 'teliman.db'))
    replaceDriverOverridesAtomic({ one: { trackerId: '10', firstName: 'A' } })
    assert.throws(() => replaceDriverOverridesAtomic({ two: { trackerId: '20' }, broken: undefined }))
    assert.deepEqual(readDriverOverrides(), [{ id: 'one', trackerId: '10', firstName: 'A' }])
  } finally { closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('validation stricte: mot de passe create robuste, update séparé, vidange partielle et payloads bornés', () => {
  assert.equal(adminUserSchema.safeParse({ email: 'a@b.test', role: 'user', permissions: [], password: 'short' }).success, false)
  assert.equal(adminUserSchema.safeParse({ email: 'a@b.test', role: 'user', permissions: [], password: 'Long-password-123!' }).success, true)
  assert.equal(adminUserUpdateSchema.safeParse({ role: 'user' }).success, true)
  assert.equal(oilChangeUpdateSchema.safeParse({ notes: 'ok' }).success, true)
  assert.equal(driverOverridesSchema.safeParse({ overrides: { x: { firstName: 'A', unexpected: true } } }).success, false)
  assert.equal(tracksBatchSchema.safeParse({ trackerIds: Array.from({ length: 51 }, (_, i) => i + 1), period: '1h' }).success, false)
  assert.equal(tracksBatchSchema.safeParse({ trackerIds: [1], period: '48h' }).success, true)
  assert.equal(whatsappTestMessageSchema.safeParse({ to: '+22501020304', message: 'x'.repeat(2001) }).success, false)
})

async function waitForServer(child, port) {
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${output}`)
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health/live`); if (response.ok) return } catch { /* serveur pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`server timeout: ${output}`)
}

async function jsonRequest(port, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options)
  return { status: response.status, headers: response.headers, body: await response.json() }
}

test('HTTP réel: login opaque non énumérant, identité non forgeable, logout serveur et permissions', async () => {
  const dir = tempDir(); const dbPath = path.join(dir, 'teliman.db'); const port = 19000 + Math.floor(Math.random() * 1000)
  initDatabase(dbPath)
  createAuthUser('admin@example.test', { role: 'admin', permissions: ['*'], ...passwordMaterial('Admin-password-123!') })
  createAuthUser('limited@example.test', { role: 'user', permissions: ['page_dashboard', 'page_whatsapp'], ...passwordMaterial('Limited-password-123!') })
  closeDatabase()
  fs.mkdirSync(path.join(dir, 'uploads', 'delivery-proofs'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'uploads', 'delivery-proofs', 'proof.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const child = spawn(process.execPath, ['/home/pi/teliman-tracking-fleeti/server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), TELIMAN_DATA_DIR: dir, FLEETI_API_BASE: 'http://127.0.0.1:9', FLEETI_LOGIN: 'dummy', FLEETI_PASSWORD: 'dummy', FLEETI_DEALER_ID: '1', ALLOWED_ORIGINS: 'https://app.example.test', AUTH_PBKDF2_ITERATIONS: '120000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForServer(child, port)
    const unknown = await jsonRequest(port, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'missing@example.test', password: 'wrong' }) })
    const wrong = await jsonRequest(port, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'limited@example.test', password: 'wrong' }) })
    assert.equal(unknown.status, 401); assert.deepEqual(unknown.body, wrong.body)
    const login = await jsonRequest(port, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'limited@example.test', password: 'Limited-password-123!' }) })
    assert.equal(login.status, 200); assert.ok(login.body.sessionToken.length >= 40)
    assert.equal(login.body.expiresInMs, 30 * 24 * 60 * 60 * 1000)
    const token = login.body.sessionToken
    const me = await jsonRequest(port, '/api/auth/me', { headers: { 'x-session-token': token, 'x-user-email': 'admin@example.test' } })
    assert.equal(me.body.user.email, 'limited@example.test')
    const admin = await jsonRequest(port, '/api/admin/users', { headers: { 'x-session-token': token } })
    assert.equal(admin.status, 403)
    const deliveries = await jsonRequest(port, '/api/delivery-orders', { headers: { 'x-session-token': token } })
    assert.equal(deliveries.status, 403)
    const masterData = await jsonRequest(port, '/api/master-data', { headers: { 'x-session-token': token } })
    assert.equal(masterData.status, 403)
    const whatsapp = await jsonRequest(port, '/api/whatsapp/disconnect', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-token': token }, body: '{}' })
    assert.equal(whatsapp.status, 403)
    const upload = await fetch(`http://127.0.0.1:${port}/uploads/nope.png`)
    assert.equal(upload.status, 401); assert.equal(upload.headers.get('cache-control'), 'no-store')
    const forbiddenUpload = await fetch(`http://127.0.0.1:${port}/uploads/delivery-proofs/proof.png`, { headers: { 'x-session-token': token } })
    assert.equal(forbiddenUpload.status, 403)
    const adminLogin = await jsonRequest(port, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'Admin-password-123!' }) })
    const createdLimited = await jsonRequest(port, '/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-token': adminLogin.body.sessionToken }, body: JSON.stringify({ email: 'no-pages@example.test', role: 'user', permissions: [], password: 'No-pages-password-123!' }) })
    assert.equal(createdLimited.status, 201)
    assert.deepEqual(createdLimited.body.user.permissions, [])
    const privateUpload = await fetch(`http://127.0.0.1:${port}/uploads/delivery-proofs/proof.png`, { headers: { 'x-session-token': adminLogin.body.sessionToken } })
    assert.equal(privateUpload.status, 200)
    assert.equal(privateUpload.headers.get('cache-control'), 'no-store')
    assert.equal(privateUpload.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await privateUpload.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const logout = await jsonRequest(port, '/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-token': token }, body: '{}' })
    assert.equal(logout.status, 200)
    const after = await jsonRequest(port, '/api/auth/me', { headers: { 'x-session-token': token } })
    assert.equal(after.status, 401)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
