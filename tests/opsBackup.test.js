import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoDir = path.resolve(import.meta.dirname, '..')
const script = path.join(repoDir, 'scripts', 'backup-teliman.js')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teliman-backup-test-'))
  const dataDir = path.join(root, 'data')
  const destination = path.join(root, 'backups')
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'whatsapp-auth'), { recursive: true })

  execFileSync('sqlite3', [path.join(dataDir, 'teliman.db'), 'PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES (\'ok\');'])
  fs.writeFileSync(path.join(dataDir, 'delivery-orders.json'), '[{"id":1}]')
  fs.writeFileSync(path.join(dataDir, 'oil-changes.json'), '[{"id":2}]')
  fs.writeFileSync(path.join(dataDir, 'whatsapp-templates.json'), '{"delivery":"ok"}')
  fs.writeFileSync(path.join(dataDir, 'public-telemetry-cache.json'), '{"ephemeral":true}')
  fs.writeFileSync(path.join(dataDir, 'uploads', 'proof.txt'), 'preuve')
  fs.writeFileSync(path.join(dataDir, 'whatsapp-auth', 'credentials.json'), '{"token":"secret"}')
  return { root, dataDir, destination }
}

test('backup produit un snapshot SQLite vérifié, un manifeste sans valeurs secrètes et des checksums valides', () => {
  const f = fixture()
  try {
    const stdout = execFileSync(process.execPath, [script, '--data-dir', f.dataDir, '--uploads-dir', path.join(f.dataDir, 'uploads'), '--whatsapp-auth-dir', path.join(f.dataDir, 'whatsapp-auth'), '--destination', f.destination, '--allow-same-filesystem'], { encoding: 'utf8' })
    const backupDir = stdout.trim().split('\n').at(-1)
    assert.equal(path.dirname(backupDir), f.destination)
    assert.equal(execFileSync('sqlite3', [path.join(backupDir, 'database', 'teliman.db'), 'PRAGMA quick_check;'], { encoding: 'utf8' }).trim(), 'ok')
    assert.match(execFileSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: backupDir, encoding: 'utf8' }), /OK/)
    assert.equal(fs.readFileSync(path.join(backupDir, 'runtime', 'delivery-orders.json'), 'utf8'), '[{"id":1}]')
    assert.equal(fs.readFileSync(path.join(backupDir, 'runtime', 'oil-changes.json'), 'utf8'), '[{"id":2}]')
    assert.equal(fs.readFileSync(path.join(backupDir, 'runtime', 'whatsapp-templates.json'), 'utf8'), '{"delivery":"ok"}')
    assert.equal(fs.existsSync(path.join(backupDir, 'runtime', 'public-telemetry-cache.json')), false)
    assert.equal(fs.readFileSync(path.join(backupDir, 'uploads', 'proof.txt'), 'utf8'), 'preuve')
    assert.equal(fs.existsSync(path.join(backupDir, 'secrets', '.env')), false)
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'MANIFEST.json'), 'utf8'))
    assert.equal(manifest.environmentFileIncluded, false)
    assert.equal(fs.statSync(backupDir).mode & 0o777, 0o700)

  } finally {
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

test('backup échoue fermé et ne publie aucun artefact si SQLite est corrompue', () => {
  const f = fixture()
  try {
    fs.writeFileSync(path.join(f.dataDir, 'teliman.db'), 'not a sqlite database')
    const result = spawnSync(process.execPath, [script, '--data-dir', f.dataDir, '--uploads-dir', path.join(f.dataDir, 'uploads'), '--whatsapp-auth-dir', path.join(f.dataDir, 'whatsapp-auth'), '--destination', f.destination, '--allow-same-filesystem'], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    const published = fs.existsSync(f.destination) ? fs.readdirSync(f.destination).filter((name) => name.startsWith('teliman-') && !name.includes('.partial-')) : []
    assert.deepEqual(published, [])
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})
