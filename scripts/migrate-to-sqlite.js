#!/usr/bin/env node

import path from 'node:path'
import {
  getDatabase,
  importAuthUsersFromJSON,
  importDeliveryOrdersFromJSON,
  importDriverOverridesFromJSON,
  importFuelVouchersFromJSON,
  importMasterDataFromJSON,
  initDatabase,
} from '../src/backend/database.js'
import { AUTHORITY_KEY } from './lib/ops.js'
import { authorityExists, cliOptions, driverObjectToRows, nonEmptyMigrationTables, readJson, validateRows, verifiedPreMutationBackup, writeReportAfterCommit } from './lib/migration.js'

const options = cliOptions()

try {
  // Le marqueur est consulté avant toute lecture des archives JSON legacy.
  if (authorityExists(options.dbPath)) {
    throw new Error(`Autorité SQLite déjà établie (${AUTHORITY_KEY}); réimport JSON refusé`)
  }
  const preExistingTables = nonEmptyMigrationTables(options.dbPath)
  if (preExistingTables.length) {
    throw new Error(`Base SQLite métier non vide sans marqueur (${preExistingTables.join(', ')}); réimport JSON refusé`)
  }

  const sources = {
    deliveryOrders: readJson(path.join(options.dataDir, 'delivery-orders.json'), 'array'),
    fuelVouchers: readJson(path.join(options.dataDir, 'fuel-vouchers.json'), 'array'),
    authUsers: readJson(path.join(options.dataDir, 'auth-users.json'), 'array'),
    masterData: readJson(path.join(options.dataDir, 'master-data.json'), 'object'),
    driverOverrides: driverObjectToRows(readJson(path.join(options.dataDir, 'driver-overrides.json'), 'object')),
  }
  validateRows('delivery-orders', sources.deliveryOrders, ['id', 'trackerId'])
  validateRows('fuel-vouchers', sources.fuelVouchers, ['id', 'trackerId'])
  validateRows('auth-users', sources.authUsers, ['email', 'salt', 'passwordHash'])
  validateRows('driver-overrides', sources.driverOverrides, ['trackerId'])

  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, valid: true, counts: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, Array.isArray(value) ? value.length : Object.keys(value).length])) }))
    process.exit(0)
  }

  const backup = await verifiedPreMutationBackup(options, 'pre-migrate-to-sqlite')
  initDatabase(options.dbPath)
  const db = getDatabase()
  const counts = db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS teliman_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    if (db.prepare('SELECT 1 FROM teliman_metadata WHERE key = ?').get(AUTHORITY_KEY)) {
      throw new Error('Autorité SQLite apparue pendant la migration; abandon')
    }
    const populatedTables = nonEmptyMigrationTables(db)
    if (populatedTables.length) throw new Error(`Base SQLite devenue non vide pendant la migration (${populatedTables.join(', ')}); abandon`)
    importDeliveryOrdersFromJSON(sources.deliveryOrders)
    importFuelVouchersFromJSON(sources.fuelVouchers)
    if (process.env.NODE_ENV === 'test' && process.env.TELIMAN_TEST_FAIL_AFTER_IMPORT === 'fuel-vouchers') {
      throw new Error('échec tardif injecté après fuel-vouchers')
    }
    importAuthUsersFromJSON(sources.authUsers)
    importMasterDataFromJSON(sources.masterData)
    importDriverOverridesFromJSON(sources.driverOverrides)
    const result = {
      deliveryOrders: db.prepare('SELECT COUNT(*) count FROM delivery_orders').get().count,
      fuelVouchers: db.prepare('SELECT COUNT(*) count FROM fuel_vouchers').get().count,
      authUsers: db.prepare('SELECT COUNT(*) count FROM auth_users').get().count,
      masterData: db.prepare('SELECT COUNT(*) count FROM master_data').get().count,
      driverOverrides: db.prepare('SELECT COUNT(*) count FROM driver_overrides').get().count,
    }
    const authority = JSON.stringify({ establishedAt: new Date().toISOString(), source: 'legacy-json', counts: result })
    db.prepare('INSERT INTO teliman_metadata(key, value) VALUES (?, ?)').run(AUTHORITY_KEY, authority)
    return result
  })()

  const report = { committed: true, completedAt: new Date().toISOString(), database: options.dbPath, backup, counts }
  writeReportAfterCommit(options.reportPath, report)
  console.log(`Migration commitée; rapport: ${options.reportPath}`)
} catch (error) {
  console.error(`MIGRATION ÉCHOUÉE: ${error.message}`)
  process.exitCode = 1
}
