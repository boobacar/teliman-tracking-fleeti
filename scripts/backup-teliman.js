#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { assertTreeHasNoLinks, createVerifiedSqliteBackup, DEFAULT_BACKUP_ROOT, listFiles, sha256File, writeChecksums } from './lib/ops.js'

const JSON_FILES = [
  'auth-users.json',
  'delivery-orders.json',
  'driver-overrides.json',
  'fuel-vouchers.json',
  'master-data.json',
  'oil-changes.json',
  'whatsapp-history.json',
  'whatsapp-templates.json',
]

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const dataDir = path.resolve(option('data-dir', process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data'))
const uploadsDir = path.resolve(option('uploads-dir', process.env.TELIMAN_UPLOADS_DIR || path.join(dataDir, 'uploads')))
const whatsappAuthDir = path.resolve(option('whatsapp-auth-dir', process.env.WHATSAPP_BAILEYS_AUTH_DIR || path.join(dataDir, 'whatsapp-auth')))
const destination = path.resolve(option('destination', process.env.TELIMAN_BACKUP_ROOT || DEFAULT_BACKUP_ROOT))
const retentionDays = Number(option('retention-days', process.env.TELIMAN_BACKUP_RETENTION_DAYS || '14'))
const allowSameFilesystem = process.argv.includes('--allow-same-filesystem')

if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  throw new Error('La rétention doit être un nombre entier entre 1 et 3650 jours')
}

process.umask(0o077)
fs.mkdirSync(destination, { recursive: true, mode: 0o700 })
fs.chmodSync(destination, 0o700)
if (!allowSameFilesystem && fs.statSync(dataDir).dev === fs.statSync(destination).dev) {
  throw new Error('Destination refusée: elle est sur le même système de fichiers que les données source. Le backup système doit rester indépendant du Netac.')
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const finalDir = path.join(destination, `teliman-${stamp}`)
const partialDir = path.join(destination, `.teliman-${stamp}.partial-${process.pid}`)
if (fs.existsSync(finalDir) || fs.existsSync(partialDir)) throw new Error(`Destination déjà existante: ${finalDir}`)

function copyTree(source, target) {
  if (!fs.existsSync(source)) return false
  assertTreeHasNoLinks(source)
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  return true
}

try {
  fs.mkdirSync(partialDir, { recursive: false, mode: 0o700 })
  fs.mkdirSync(path.join(partialDir, 'database'), { mode: 0o700 })
  fs.mkdirSync(path.join(partialDir, 'runtime'), { mode: 0o700 })
  fs.mkdirSync(path.join(partialDir, 'secrets'), { mode: 0o700 })

  const dbResult = await createVerifiedSqliteBackup(
    path.join(dataDir, 'teliman.db'),
    path.join(partialDir, 'database', 'teliman.db'),
  )

  const copiedRuntime = []
  for (const name of JSON_FILES) {
    const source = path.join(dataDir, name)
    if (!fs.existsSync(source)) continue
    assertTreeHasNoLinks(source)
    fs.copyFileSync(source, path.join(partialDir, 'runtime', name))
    copiedRuntime.push(name)
  }

  const copiedTrees = []
  if (copyTree(uploadsDir, path.join(partialDir, 'uploads'))) copiedTrees.push('uploads')
  if (copyTree(whatsappAuthDir, path.join(partialDir, 'secrets', 'whatsapp-auth'))) copiedTrees.push('whatsapp-auth')
  const payloadFiles = listFiles(partialDir)
  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    source: { dataDirectory: dataDir, uploadsDirectory: uploadsDir, whatsappAuthDirectory: whatsappAuthDir, database: 'teliman.db' },
    sqlite: dbResult,
    runtimeJson: copiedRuntime,
    copiedTrees,
    secretMaterialIncluded: copiedTrees.includes('whatsapp-auth'),
    environmentFileIncluded: false,
    secretHandling: 'permissions Unix privées; aucune valeur secrète dans ce manifeste ou les logs',
    files: payloadFiles.map((rel) => ({ path: rel, size: fs.statSync(path.join(partialDir, rel)).size, sha256: sha256File(path.join(partialDir, rel)) })),
  }
  fs.writeFileSync(path.join(partialDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  writeChecksums(partialDir)
  fs.renameSync(partialDir, finalDir)

  const cutoff = Date.now() - retentionDays * 86400_000
  for (const name of fs.readdirSync(destination)) {
    if (!/^teliman-\d{8}T\d{6}Z$/.test(name)) continue
    const candidate = path.join(destination, name)
    if (candidate === finalDir) continue
    const stat = fs.statSync(candidate)
    if (stat.isDirectory() && stat.mtimeMs < cutoff) fs.rmSync(candidate, { recursive: true, force: false })
  }

  console.log(`Backup Teliman vérifié (${manifest.files.length} fichiers, SQLite quick_check=ok)`)
  console.log(finalDir)
} catch (error) {
  fs.rmSync(partialDir, { recursive: true, force: true })
  console.error(`BACKUP ÉCHOUÉ: ${error.message}`)
  process.exitCode = 1
}
