// Script de migration: JSON files → SQLite
import { 
  initDatabase, 
  importDeliveryOrdersFromJSON, 
  importFuelVouchersFromJSON,
  importAuthUsersFromJSON,
  importMasterDataFromJSON,
  importDriverOverridesFromJSON,
  readDeliveryOrders,
  readFuelVouchers
} from '../src/backend/database.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data'
const DB_PATH = path.join(DATA_DIR, 'teliman.db')

console.log('📦 Migration JSON → SQLite')
console.log('   Data dir:', DATA_DIR)
console.log('   DB path:', DB_PATH)

// Sauvegarde du fichier DB existant
if (fs.existsSync(DB_PATH)) {
  const backup = DB_PATH + '.backup-' + Date.now()
  fs.copyFileSync(DB_PATH, backup)
  console.log('   Backup DB existante:', backup)
}

// Initialiser la DB
initDatabase(DB_PATH)
console.log('✅ Database initialisée')

// Migrer chaque fichier
const files = [
  {
    name: 'delivery-orders.json',
    importFn: (data) => importDeliveryOrdersFromJSON(data),
  },
  {
    name: 'fuel-vouchers.json',
    importFn: (data) => importFuelVouchersFromJSON(data),
  },
  {
    name: 'auth-users.json',
    importFn: (data) => importAuthUsersFromJSON(data),
  },
  {
    name: 'master-data.json',
    importFn: (data) => importMasterDataFromJSON(data),
  },
  {
    name: 'driver-overrides.json',
    importFn: (data) => importDriverOverridesFromJSON(data),
  },
]

for (const file of files) {
  const filePath = path.join(DATA_DIR, file.name)
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${file.name} non trouvé, skip`)
    continue
  }
  
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)
    file.importFn(Array.isArray(data) ? data : data)
    
    // Vérifier le compte
    if (file.name === 'delivery-orders.json') {
      const count = readDeliveryOrders().length
      console.log(`✅ ${file.name}: ${data.length} → ${count} rows`)
    } else if (file.name === 'fuel-vouchers.json') {
      const count = readFuelVouchers().length
      console.log(`✅ ${file.name}: ${data.length} → ${count} rows`)
    } else {
      console.log(`✅ ${file.name}: migré`)
    }
  } catch (err) {
    console.error(`❌ ${file.name}:`, err.message)
  }
}

// Vérification finale
const orders = readDeliveryOrders()
const vouchers = readFuelVouchers()
console.log('\n📊 Résumé:')
console.log(`   Bons livraison: ${orders.length}`)
console.log(`   Bons carburant: ${vouchers.length}`)
console.log(`   DB size: ${(fs.statSync(DB_PATH).size / 1024).toFixed(1)} KB`)
console.log('\n✅ Migration terminée!')
