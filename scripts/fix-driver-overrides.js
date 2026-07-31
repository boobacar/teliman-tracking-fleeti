#!/usr/bin/env node
import path from 'node:path'
import { getDatabase, importDriverOverridesFromJSON, initDatabase } from '../src/backend/database.js'
import { AUTHORITY_KEY } from './lib/ops.js'
import { authorityExists, cliOptions, driverObjectToRows, nonEmptyMigrationTables, readJson, validateRows, verifiedPreMutationBackup, writeReportAfterCommit } from './lib/migration.js'

const FIX_MARKER = 'driver_overrides_json_import_v1'
const options = cliOptions()

try {
  // Fail-safe: ne jamais rouvrir l'archive legacy après le cutover global/spécifique.
  if (authorityExists(options.dbPath, [AUTHORITY_KEY, FIX_MARKER])) {
    throw new Error('Autorité SQLite déjà établie; réimport driver-overrides.json refusé')
  }
  const preExistingTables = nonEmptyMigrationTables(options.dbPath)
  if (preExistingTables.length) throw new Error(`Base SQLite métier non vide sans marqueur (${preExistingTables.join(', ')}); import legacy refusé`)
  const rows = driverObjectToRows(readJson(path.join(options.dataDir, 'driver-overrides.json'), 'object'))
  validateRows('driver-overrides', rows, ['trackerId'])

  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, valid: true, driverOverrides: rows.length }))
    process.exit(0)
  }

  const backup = await verifiedPreMutationBackup(options, 'pre-fix-driver-overrides')
  initDatabase(options.dbPath)
  const db = getDatabase()
  const count = db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS teliman_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    if (db.prepare('SELECT 1 FROM teliman_metadata WHERE key IN (?, ?)').get(AUTHORITY_KEY, FIX_MARKER)) {
      throw new Error('Autorité SQLite apparue pendant la migration; abandon')
    }
    importDriverOverridesFromJSON(rows)
    const imported = db.prepare('SELECT COUNT(*) count FROM driver_overrides').get().count
    db.prepare('INSERT INTO teliman_metadata(key, value) VALUES (?, ?)').run(
      FIX_MARKER,
      JSON.stringify({ establishedAt: new Date().toISOString(), imported }),
    )
    return imported
  })()

  writeReportAfterCommit(options.reportPath, {
    committed: true,
    completedAt: new Date().toISOString(),
    database: options.dbPath,
    backup,
    driverOverrides: count,
  })
  console.log(`Migration driver overrides commitée; rapport: ${options.reportPath}`)
} catch (error) {
  console.error(`MIGRATION DRIVER OVERRIDES ÉCHOUÉE: ${error.message}`)
  process.exitCode = 1
}
