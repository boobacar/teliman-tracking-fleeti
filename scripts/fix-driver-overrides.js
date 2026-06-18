import { initDatabase, importDriverOverridesFromJSON, readDriverOverrides } from '../src/backend/database.js'
import fs from 'fs'

const dbPath = '/mnt/netac-storage/teliman-data/teliman.db'
initDatabase(dbPath)

const raw = fs.readFileSync('/mnt/netac-storage/teliman-data/driver-overrides.json', 'utf8')
const data = JSON.parse(raw)
// Convert object to array
const items = Object.entries(data).map(([key, val]) => {
  if (typeof val === 'object' && val !== null) {
    return { trackerId: key, ...val }
  }
  return { trackerId: key, data: val }
})
console.log('Importing:', items.length, 'overrides')
importDriverOverridesFromJSON(items)
const result = readDriverOverrides()
console.log('✅ Driver overrides migrated:', result.length, 'rows')
