import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

const repoDir = path.resolve(import.meta.dirname, '..')
const migrateScript = path.join(repoDir, 'scripts', 'migrate-to-sqlite.js')
const fixScript = path.join(repoDir, 'scripts', 'fix-driver-overrides.js')

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teliman-migration-test-'))
  const dataDir = path.join(root, 'data')
  const backupDir = path.join(root, 'backups')
  fs.mkdirSync(dataDir)
  const files = {
    'delivery-orders.json': [{ id: 1, trackerId: 10, reference: 'BL-1' }],
    'fuel-vouchers.json': [{ id: 2, trackerId: 10, voucherNumber: 'CARB-1' }],
    'auth-users.json': [{ email: 'admin@example.test', salt: 'aa', passwordHash: 'bb' }],
    'master-data.json': { clients: ['A'] },
    'driver-overrides.json': { '10': { name: 'Conducteur' } },
  }
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value))
  const db = new Database(path.join(dataDir, 'teliman.db'))
  db.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES (\'before\')')
  db.close()
  return { root, dataDir, backupDir, report: path.join(root, 'report.json') }
}

function args(f, extra = []) {
  return ['--data-dir', f.dataDir, '--backup-dir', f.backupDir, '--report', f.report, '--allow-same-filesystem', ...extra]
}

test('migrate-to-sqlite dry-run valide les sources sans muter la DB ni écrire un rapport', () => {
  const f = createFixture()
  try {
    const before = fs.readFileSync(path.join(f.dataDir, 'teliman.db'))
    execFileSync(process.execPath, [migrateScript, ...args(f, ['--dry-run'])])
    assert.deepEqual(fs.readFileSync(path.join(f.dataDir, 'teliman.db')), before)
    assert.equal(fs.existsSync(f.report), false)
    assert.equal(fs.existsSync(f.backupDir), false)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('migrate-to-sqlite sauvegarde, commit globalement, marque autorité puis refuse tout réimport', () => {
  const f = createFixture()
  try {
    execFileSync(process.execPath, [migrateScript, ...args(f)])
    const db = new Database(path.join(f.dataDir, 'teliman.db'), { readonly: true })
    assert.equal(db.prepare("SELECT value FROM teliman_metadata WHERE key='json_migration_authority_v1'").get().value.length > 0, true)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM delivery_orders').get().count, 1)
    db.close()
    const report = JSON.parse(fs.readFileSync(f.report, 'utf8'))
    assert.equal(report.committed, true)
    assert.equal(report.backup.quickCheck, 'ok')
    assert.equal(fs.statSync(report.backup.path).size > 0, true)
    fs.writeFileSync(path.join(f.dataDir, 'delivery-orders.json'), '{malformed')
    const second = spawnSync(process.execPath, [migrateScript, ...args(f)], { encoding: 'utf8' })
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /autorité/i)
    assert.doesNotMatch(second.stderr, /Unexpected|malform/i)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('migrate-to-sqlite annule tous les imports si un domaine tardif échoue et ne publie pas de rapport', () => {
  const f = createFixture()
  try {
    const result = spawnSync(process.execPath, [migrateScript, ...args(f)], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', TELIMAN_TEST_FAIL_AFTER_IMPORT: 'fuel-vouchers' },
    })
    assert.notEqual(result.status, 0)
    const db = new Database(path.join(f.dataDir, 'teliman.db'), { readonly: true })
    assert.equal(db.prepare('SELECT COUNT(*) count FROM delivery_orders').get().count, 0)
    assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='teliman_metadata'").get().count, 0)
    db.close()
    assert.equal(fs.existsSync(f.report), false)
    const backups = fs.readdirSync(f.backupDir)
    assert.equal(backups.length, 1)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('migrate-to-sqlite refuse une SQLite métier déjà peuplée sans marqueur et ne la mute pas', () => {
  const f = createFixture()
  try {
    const db = new Database(path.join(f.dataDir, 'teliman.db'))
    db.exec("CREATE TABLE delivery_orders(id INTEGER PRIMARY KEY); INSERT INTO delivery_orders VALUES (99)")
    db.close()
    const before = fs.readFileSync(path.join(f.dataDir, 'teliman.db'))
    const result = spawnSync(process.execPath, [migrateScript, ...args(f)], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /métier non vide/i)
    assert.deepEqual(fs.readFileSync(path.join(f.dataDir, 'teliman.db')), before)
    assert.equal(fs.existsSync(f.report), false)
    assert.equal(fs.existsSync(f.backupDir), false)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})

test('fix-driver-overrides supporte dry-run et refuse la source legacy après autorité globale', () => {
  const f = createFixture()
  try {
    execFileSync(process.execPath, [fixScript, ...args(f, ['--dry-run'])])
    const db = new Database(path.join(f.dataDir, 'teliman.db'))
    db.exec("CREATE TABLE IF NOT EXISTS teliman_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO teliman_metadata VALUES ('json_migration_authority_v1','cutover')")
    db.close()
    fs.writeFileSync(path.join(f.dataDir, 'driver-overrides.json'), '{malformed')
    const result = spawnSync(process.execPath, [fixScript, ...args(f)], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /autorité/i)
    assert.doesNotMatch(result.stderr, /Unexpected|malform/i)
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})
