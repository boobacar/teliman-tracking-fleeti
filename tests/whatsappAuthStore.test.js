// Creds WhatsApp : snapshots rotatifs + restauration sans scan QR.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CREDS_FILE,
  hasCredentials,
  listAuthSnapshots,
  pruneAuthSnapshots,
  restoreAuthDir,
  snapshotAuthDir,
  snapshotPath,
  snapshotStamp,
} from '../src/backend/whatsappAuthStore.js'

function tempDir(prefix = 'teliman-auth-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

// Dossier auth factice : creds.json + un fichier de clés, comme Baileys.
function writeAuthDir(dir, { creds = '{"me":{"id":"221776260020:1@s.whatsapp.net"}}', keys = 'keys' } = {}) {
  mkdirSync(dir, { recursive: true })
  if (creds !== null) writeFileSync(join(dir, CREDS_FILE), creds)
  writeFileSync(join(dir, 'app-state-sync-key-AAAA.json'), keys)
  return dir
}

test('hasCredentials ne valide qu’un creds.json non vide', async () => {
  const root = tempDir()
  assert.equal(await hasCredentials(join(root, 'absent')), false)

  const empty = writeAuthDir(join(root, 'vide'), { creds: '' })
  assert.equal(await hasCredentials(empty), false, 'creds.json vide = pas de creds')

  const full = writeAuthDir(join(root, 'plein'))
  assert.equal(await hasCredentials(full), true)
  assert.equal(await hasCredentials(''), false)
})

test('snapshotAuthDir copie tout le dossier auth dans un snapshot horodaté', async () => {
  const authDir = writeAuthDir(tempDir())
  const backupRoot = join(tempDir(), 'backups')

  const snapshot = await snapshotAuthDir({ authDir, backupRoot, now: new Date('2026-09-11T15:54:11.295Z') })

  assert.equal(snapshot.name, '20260911T155411Z')
  assert.equal(snapshot.dir, join(backupRoot, '20260911T155411Z'))
  assert.equal(readFileSync(join(snapshot.dir, CREDS_FILE), 'utf8'), readFileSync(join(authDir, CREDS_FILE), 'utf8'))
  assert.ok(existsSync(join(snapshot.dir, 'app-state-sync-key-AAAA.json')), 'les clés suivent les creds')
  assert.ok(!existsSync(`${snapshot.dir}.partial`), 'aucun dossier partiel résiduel')
})

test('snapshotAuthDir ne sauvegarde rien sans creds (dossier vide ou absent)', async () => {
  const backupRoot = join(tempDir(), 'backups')
  assert.equal(await snapshotAuthDir({ authDir: writeAuthDir(tempDir(), { creds: null }), backupRoot }), null)
  assert.equal(await snapshotAuthDir({ authDir: join(tempDir(), 'inexistant'), backupRoot }), null)
  assert.equal(await snapshotAuthDir({ authDir: tempDir(), backupRoot: '' }), null)
})

test('la rotation ne conserve que les N snapshots les plus récents', async () => {
  const authDir = writeAuthDir(tempDir())
  const backupRoot = join(tempDir(), 'backups')

  for (const stamp of ['2026-09-11T10:00:00.000Z', '2026-09-11T11:00:00.000Z', '2026-09-11T12:00:00.000Z']) {
    await snapshotAuthDir({ authDir, backupRoot, keep: 2, now: new Date(stamp) })
  }

  const names = (await listAuthSnapshots(backupRoot)).map((snapshot) => snapshot.name)
  assert.deepEqual(names, ['20260911T120000Z', '20260911T110000Z'], 'les plus récents d’abord, les vieux purgés')
})

test('listAuthSnapshots ignore les dossiers incomplets et renvoie le plus récent d’abord', async () => {
  const backupRoot = join(tempDir(), 'backups')
  writeAuthDir(join(backupRoot, '20260910T020000Z'))
  writeAuthDir(join(backupRoot, '20260911T020000Z'))
  mkdirSync(join(backupRoot, '20260912T020000Z'), { recursive: true }) // snapshot interrompu (sans creds)
  writeFileSync(join(backupRoot, 'lisez-moi.txt'), 'bruit')

  const names = (await listAuthSnapshots(backupRoot)).map((snapshot) => snapshot.name)
  assert.deepEqual(names, ['20260911T020000Z', '20260910T020000Z'])
  assert.deepEqual(await pruneAuthSnapshots({ backupRoot, keep: 1 }), ['20260910T020000Z'])
})

test('restoreAuthDir restaure le snapshot le plus récent quand les creds manquent', async () => {
  const backupRoot = join(tempDir(), 'backups')
  const oldCreds = '{"registrationId":1}'
  const newCreds = '{"registrationId":2}'
  writeAuthDir(join(backupRoot, '20260910T020000Z'), { creds: oldCreds })
  writeAuthDir(join(backupRoot, '20260911T020000Z'), { creds: newCreds })

  const authDir = join(tempDir(), 'auth')
  const result = await restoreAuthDir({ authDir, backupRoot })

  assert.equal(result.restored, true)
  assert.equal(result.name, '20260911T020000Z')
  assert.equal(readFileSync(join(authDir, CREDS_FILE), 'utf8'), newCreds)
  assert.ok(existsSync(join(authDir, 'app-state-sync-key-AAAA.json')))
})

test('restoreAuthDir n’écrase JAMAIS des creds déjà présents', async () => {
  const backupRoot = join(tempDir(), 'backups')
  writeAuthDir(join(backupRoot, '20260911T020000Z'), { creds: '{"registrationId":"snapshot"}' })
  const authDir = writeAuthDir(join(tempDir(), 'auth'), { creds: '{"registrationId":"live"}' })

  const result = await restoreAuthDir({ authDir, backupRoot })

  assert.equal(result.restored, false)
  assert.match(result.reason, /déjà présents/i)
  assert.equal(readFileSync(join(authDir, CREDS_FILE), 'utf8'), '{"registrationId":"live"}')
})

test('restoreAuthDir signale l’absence de snapshot sans rien casser', async () => {
  const result = await restoreAuthDir({ authDir: join(tempDir(), 'auth'), backupRoot: join(tempDir(), 'backups') })
  assert.equal(result.restored, false)
  assert.match(result.reason, /Aucun snapshot/i)
  assert.equal(await restoreAuthDir({ authDir: '', backupRoot: '' }).then((r) => r.restored), false)
})

test('snapshotStamp et snapshotPath produisent un nom trié chronologiquement', () => {
  assert.equal(snapshotStamp(new Date('2026-09-11T15:54:11.295Z')), '20260911T155411Z')
  assert.equal(snapshotPath('/tmp/backups', new Date('2026-09-11T15:54:11.295Z')), join('/tmp/backups', '20260911T155411Z'))
  assert.ok(snapshotStamp(new Date('2026-09-11T09:00:00Z')) < snapshotStamp(new Date('2026-09-11T10:00:00Z')))
})
