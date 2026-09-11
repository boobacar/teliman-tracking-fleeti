// Sauvegarde / restauration des creds WhatsApp (dossier auth Baileys).
//
// Objectif : ne plus exiger un scan QR après une purge, une suppression
// accidentelle ou une restauration de carte SD. Un snapshot complet du dossier
// auth (creds.json, clés, app-state) est conservé hors du dossier live, avec
// rotation, et restauré automatiquement au démarrage si les creds manquent.
//
// ⚠️ LIMITE PROTOCOLE : si WhatsApp a réellement révoqué le device (401/403,
// appareil délié depuis le téléphone), AUCUN backup ne permet de reconnecter —
// les clés de session sont mortes côté serveur, un re-scan du QR est
// obligatoire. Vérifié empiriquement le 11/09/2026 (snapshot J-0 → 401).
// Le backup couvre donc les pertes LOCALEs (purge, rm, carte SD, restauration),
// pas une révocation distante.
import fs from 'fs/promises'
import path from 'node:path'

export const CREDS_FILE = 'creds.json'
export const DEFAULT_SNAPSHOT_KEEP = 10

// Nom de snapshot trié lexicographiquement (même format que les backups d'ops).
export function snapshotStamp(now = new Date()) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function snapshotPath(backupRoot, now = new Date()) {
  return path.join(backupRoot, snapshotStamp(now))
}

// Des creds utilisables = un creds.json non vide dans le dossier.
export async function hasCredentials(authDir, { fsImpl = fs } = {}) {
  if (!authDir) return false
  try {
    const stat = await fsImpl.stat(path.join(authDir, CREDS_FILE))
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

// Snapshots les plus récents d'abord (seuls ceux contenant des creds comptent :
// un snapshot interrompu ne doit jamais être restauré).
export async function listAuthSnapshots(backupRoot, { fsImpl = fs } = {}) {
  if (!backupRoot) return []
  let entries = []
  try {
    entries = await fsImpl.readdir(backupRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
  const snapshots = []
  for (const name of names) {
    const dir = path.join(backupRoot, name)
    if (await hasCredentials(dir, { fsImpl })) snapshots.push({ name, dir })
  }
  return snapshots
}

export async function pruneAuthSnapshots({ backupRoot, keep = DEFAULT_SNAPSHOT_KEEP, fsImpl = fs } = {}) {
  const snapshots = await listAuthSnapshots(backupRoot, { fsImpl })
  const limit = Math.max(1, Number(keep) || DEFAULT_SNAPSHOT_KEEP)
  const removed = []
  for (const snapshot of snapshots.slice(limit)) {
    try {
      await fsImpl.rm(snapshot.dir, { recursive: true, force: true })
      removed.push(snapshot.name)
    } catch {
      /* rotation best-effort */
    }
  }
  return removed
}

// Copie le dossier auth vers un snapshot horodaté (copie partielle puis rename
// atomique : un snapshot visible est toujours complet). Renvoie null si le
// dossier live n'a pas de creds — inutile de sauvegarder un état vide.
export async function snapshotAuthDir({ authDir, backupRoot, keep = DEFAULT_SNAPSHOT_KEEP, now = new Date(), fsImpl = fs } = {}) {
  if (!authDir || !backupRoot) return null
  if (!(await hasCredentials(authDir, { fsImpl }))) return null

  await fsImpl.mkdir(backupRoot, { recursive: true, mode: 0o700 })
  const target = snapshotPath(backupRoot, now)
  const partial = `${target}.partial`
  await removeTree(partial, fsImpl)
  try {
    await fsImpl.cp(authDir, partial, { recursive: true, preserveTimestamps: true })
    await removeTree(target, fsImpl)
    await fsImpl.rename(partial, target)
  } catch (error) {
    await removeTree(partial, fsImpl)
    throw error
  }
  const pruned = await pruneAuthSnapshots({ backupRoot, keep, fsImpl })
  return { name: path.basename(target), dir: target, pruned }
}

// Restaure le snapshot le plus récent dans le dossier live. Ne touche à RIEN si
// des creds sont déjà présents (jamais d'écrasement de creds valides).
export async function restoreAuthDir({ authDir, backupRoot, fsImpl = fs } = {}) {
  if (!authDir || !backupRoot) return { restored: false, reason: 'Sauvegarde non configurée.' }
  if (await hasCredentials(authDir, { fsImpl })) return { restored: false, reason: 'Creds déjà présents.' }

  const [newest] = await listAuthSnapshots(backupRoot, { fsImpl })
  if (!newest) return { restored: false, reason: 'Aucun snapshot de creds WhatsApp.' }

  try {
    await fsImpl.mkdir(authDir, { recursive: true, mode: 0o700 })
    await fsImpl.cp(newest.dir, authDir, { recursive: true, preserveTimestamps: true, force: true })
  } catch (error) {
    return { restored: false, reason: error?.message || 'Restauration impossible.' }
  }
  return { restored: true, from: newest.dir, name: newest.name }
}

async function removeTree(dir, fsImpl) {
  try {
    await fsImpl.rm(dir, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
}
