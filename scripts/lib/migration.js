import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { AUTHORITY_KEY, createVerifiedSqliteBackup } from './ops.js'

export function cliOptions(argv = process.argv.slice(2)) {
  const get = (name, fallback) => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? fallback : argv[index + 1]
  }
  const dataDir = path.resolve(get('data-dir', process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data'))
  return {
    dataDir,
    dbPath: path.join(dataDir, 'teliman.db'),
    backupDir: path.resolve(get('backup-dir', process.env.TELIMAN_MIGRATION_BACKUP_DIR || '/home/pi/backups/teliman/migrations')),
    reportPath: path.resolve(get('report', path.join(dataDir, 'migration-report.json'))),
    dryRun: argv.includes('--dry-run'),
    allowSameFilesystem: argv.includes('--allow-same-filesystem'),
  }
}

export function authorityExists(dbPath, keys = [AUTHORITY_KEY]) {
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return false
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='teliman_metadata'").get()
    if (!table) return false
    const placeholders = keys.map(() => '?').join(',')
    return Boolean(db.prepare(`SELECT 1 FROM teliman_metadata WHERE key IN (${placeholders}) LIMIT 1`).get(...keys))
  } finally { db.close() }
}

export function nonEmptyMigrationTables(databaseOrPath) {
  if (typeof databaseOrPath === 'string' && (!fs.existsSync(databaseOrPath) || fs.statSync(databaseOrPath).size === 0)) return []
  const ownsDatabase = typeof databaseOrPath === 'string'
  const database = ownsDatabase ? new Database(databaseOrPath, { readonly: true, fileMustExist: true }) : databaseOrPath
  const businessTables = ['delivery_orders', 'fuel_vouchers', 'auth_users', 'master_data', 'driver_overrides']
  try {
    return businessTables.filter((tableName) => {
      const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName)
      return exists && database.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).get()
    })
  } finally {
    if (ownsDatabase) database.close()
  }
}

export function readJson(filePath, expected) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (expected === 'array' && !Array.isArray(value)) throw new Error(`${path.basename(filePath)} doit contenir un tableau`)
  if (expected === 'object' && (!value || Array.isArray(value) || typeof value !== 'object')) throw new Error(`${path.basename(filePath)} doit contenir un objet`)
  return value
}

export function validateRows(name, rows, required) {
  for (const [index, row] of rows.entries()) {
    if (!row || Array.isArray(row) || typeof row !== 'object') throw new Error(`${name}[${index}] n'est pas un objet`)
    for (const field of required) {
      if (row[field] === undefined || row[field] === null || row[field] === '') throw new Error(`${name}[${index}].${field} est requis`)
    }
  }
}

export function driverObjectToRows(value) {
  if (Array.isArray(value)) return value
  return Object.entries(value).map(([trackerId, item]) => (
    item && !Array.isArray(item) && typeof item === 'object'
      ? { trackerId, ...item }
      : { trackerId, data: item }
  ))
}

export async function verifiedPreMutationBackup(options, label) {
  fs.mkdirSync(options.backupDir, { recursive: true, mode: 0o700 })
  if (!options.allowSameFilesystem && fs.statSync(options.dataDir).dev === fs.statSync(options.backupDir).dev) {
    throw new Error('Backup de migration refusé sur le même système de fichiers que la base source')
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const backupPath = path.join(options.backupDir, `${label}-${stamp}-${process.pid}.sqlite`)
  const result = await createVerifiedSqliteBackup(options.dbPath, backupPath)
  return { path: backupPath, ...result }
}

export function writeReportAfterCommit(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const temporary = `${reportPath}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, reportPath)
}
