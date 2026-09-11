#!/usr/bin/env node
// Restaure les creds WhatsApp (dossier auth Baileys) depuis le snapshot le plus
// récent — pour reconnecter SANS scan QR après une purge/effacement local.
//
// Usage (arrêter l'app avant : le dossier auth est lu au démarrage) :
//   pm2 stop teliman-tracking-fleeti
//   node scripts/whatsapp-auth-restore.js            # restaure le plus récent
//   node scripts/whatsapp-auth-restore.js --list     # liste les snapshots
//   node scripts/whatsapp-auth-restore.js --from 20260911T022101Z
//   pm2 start teliman-tracking-fleeti
//
// ⚠️ Un snapshot ne ressuscite PAS une session révoquée par WhatsApp (401/403) :
// dans ce cas, scanner le QR reste obligatoire.
import path from 'node:path'
import process from 'node:process'
import { cp } from 'node:fs/promises'
import { hasCredentials, listAuthSnapshots } from '../src/backend/whatsappAuthStore.js'

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const dataDir = path.resolve(process.env.TELIMAN_DATA_DIR || '/home/pi/teliman-data')
const authDir = path.resolve(option('auth-dir', process.env.WHATSAPP_BAILEYS_AUTH_DIR || path.join(dataDir, 'whatsapp-auth')))
const backupRoot = path.resolve(option('backup-dir', path.join(dataDir, 'whatsapp-auth-backups')))
const snapshots = await listAuthSnapshots(backupRoot)

if (!snapshots.length) {
  console.error(`Aucun snapshot de creds WhatsApp dans ${backupRoot}`)
  process.exit(1)
}

if (process.argv.includes('--list')) {
  console.log(`${snapshots.length} snapshot(s) dans ${backupRoot} (du plus récent au plus ancien) :`)
  for (const snapshot of snapshots) console.log(`  ${snapshot.name}`)
  console.log(`\nCreds live actuels (${authDir}) : ${(await hasCredentials(authDir)) ? 'présents' : 'ABSENTS'}`)
  process.exit(0)
}

const requested = option('from')
const target = requested ? snapshots.find((snapshot) => snapshot.name === requested) : snapshots[0]
if (!target) {
  console.error(`Snapshot introuvable : ${requested}`)
  process.exit(1)
}

await cp(target.dir, authDir, { recursive: true, preserveTimestamps: true, force: true })
const restored = await hasCredentials(authDir)
console.log(`Creds WhatsApp restaurés depuis ${target.name} vers ${authDir} : ${restored ? 'OK' : 'ÉCHEC'}`)
console.log('Redémarrer l’app (pm2 start teliman-tracking-fleeti) puis vérifier /api/whatsapp/status (state=connected).')
process.exit(restored ? 0 : 1)
