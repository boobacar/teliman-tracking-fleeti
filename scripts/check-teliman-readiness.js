#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { inspectStorage } from './check-storage.js'
import { DEFAULT_BACKUP_ROOT, sha256File, sqliteQuickCheck } from './lib/ops.js'

function verifyLatestBackup(root, maxAgeHours) {
  if (!fs.existsSync(root)) throw new Error(`Racine de backup absente: ${root}`)
  const candidates = fs.readdirSync(root)
    .filter((name) => /^teliman-\d{8}T\d{6}Z$/.test(name))
    .map((name) => ({ name, path: path.join(root, name), mtime: fs.statSync(path.join(root, name)).mtimeMs }))
    .filter((entry) => fs.statSync(entry.path).isDirectory())
    .sort((a, b) => b.mtime - a.mtime)
  if (!candidates.length) throw new Error('Aucun backup Teliman publié')
  const latest = candidates[0]
  const ageHours = (Date.now() - latest.mtime) / 3_600_000
  if (ageHours > maxAgeHours) throw new Error(`Dernier backup trop ancien: ${ageHours.toFixed(1)} h`)
  const checksumPath = path.join(latest.path, 'SHA256SUMS')
  const lines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n')
  for (const line of lines) {
    const separator = line.indexOf('  ')
    if (separator !== 64) throw new Error(`Ligne checksum invalide dans ${checksumPath}`)
    const rel = line.slice(separator + 2)
    if (sha256File(path.join(latest.path, rel)) !== line.slice(0, 64)) throw new Error(`Checksum invalide: ${rel}`)
  }
  sqliteQuickCheck(path.join(latest.path, 'database', 'teliman.db'))
  return { path: latest.path, ageHours: Number(ageHours.toFixed(2)), checksums: lines.length, quickCheck: 'ok' }
}

try {
  const storage = inspectStorage()
  const dbPath = path.join(storage.dataDir, 'teliman.db')
  const database = { path: dbPath, size: fs.statSync(dbPath).size, quickCheck: sqliteQuickCheck(dbPath) }
  if (database.size === 0) throw new Error('Base Teliman vide')
  const backup = verifyLatestBackup(process.env.TELIMAN_BACKUP_ROOT || DEFAULT_BACKUP_ROOT, Number(process.env.TELIMAN_BACKUP_MAX_AGE_HOURS || 36))
  let pm2Status = 'inconnu'
  try {
    const pm2 = execFileSync('pm2', ['show', 'teliman-tracking-fleeti'], { encoding: 'utf8' })
    pm2Status = pm2.match(/status\s*│\s*([^│\n]+)/)?.[1]?.trim() || 'inconnu'
  } catch { pm2Status = 'absent' }
  if (process.argv.includes('--require-pm2-online') && pm2Status !== 'online') throw new Error(`PM2 non online: ${pm2Status}`)
  console.log(JSON.stringify({ ready: true, storage, database, backup, pm2Status }, null, 2))
} catch (error) {
  console.error(`TELIMAN NOT READY: ${error.message}`)
  process.exitCode = 1
}
