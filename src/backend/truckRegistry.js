// Parc Teliman : tableau de correspondance des immatriculations transmis par la
// direction (document « TRACKING RAPPORT »). Les étiquettes envoyées par le
// fournisseur GPS restent les anciennes plaques (« 39151WWCI01 ») : cette table est
// la référence officielle pour l'affichage (rapport, listes, formulaires).
//
// Persistée dans le dossier de données (truck-registry.json) pour rester modifiable
// sans redéploiement : les valeurs ci-dessous ne servent que de valeurs initiales.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const OFFICIAL_TRUCKS = [
  { oldLabel: '45791WWCI01', plate: '602604WWCI01', driver: 'Adama CAMARA' },
  { oldLabel: '45792WWCI01', plate: 'AB154GR', driver: 'Yacouba DIOMANDE' },
  { oldLabel: '3216WWCI01', plate: '602605WWCI01', driver: 'Lamine BAMBA' },
  { oldLabel: '4400WWCI01', plate: '602606WWCI01', driver: 'Bama TRAORE' },
  { oldLabel: '39151WWCI01', plate: 'AB246JJ', driver: 'Yacouba SARIA' },
  { oldLabel: '3952WWCI01', plate: 'AB229JJ', driver: 'Tahirou KONE' },
  { oldLabel: '3100WWC101', plate: '602607WWCI01', driver: 'Siriki Drabo' },
]

// Une étiquette peut arriver avec une coquille (3100WWC101) ou en minuscules.
export function normalizeTruckLabel(label) {
  const raw = String(label || '').trim().toUpperCase()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '')
  return compact.replace(/^(\d{4})WWC1(\d{2})$/, '$1WWCI$2')
}

export function registryKeyFor(label) {
  const normalized = normalizeTruckLabel(label)
  if (!normalized) return ''
  return normalized
}

// Table { clé normalisée → entrée }, construite pour les anciennes ET les nouvelles
// plaques : demander la plaque officielle d'une plaque déjà renommée reste possible.
export function buildRegistryIndex(entries = OFFICIAL_TRUCKS) {
  const index = new Map()
  for (const entry of entries) {
    const oldKey = normalizeTruckLabel(entry.oldLabel)
    const newKey = normalizeTruckLabel(entry.plate)
    const record = {
      oldLabel: oldKey,
      plate: String(entry.plate || '').trim(),
      driver: String(entry.driver || '').trim(),
    }
    if (oldKey) index.set(oldKey, record)
    if (newKey && !index.has(newKey)) index.set(newKey, record)
  }
  return index
}

export function plateFor(label, { entries = OFFICIAL_TRUCKS, fallback = '' } = {}) {
  const record = buildRegistryIndex(entries).get(registryKeyFor(label))
  return record?.plate || fallback || String(label || '').trim()
}

export function driverFor(label, { entries = OFFICIAL_TRUCKS, fallback = '' } = {}) {
  const record = buildRegistryIndex(entries).get(registryKeyFor(label))
  return record?.driver || fallback || ''
}

// Champs susceptibles de porter une immatriculation. La correspondance ne s'applique
// qu'aux valeurs qui sont EXACTEMENT une plaque connue : un nom de client, une note
// libre ou un numéro ne sont jamais touchés.
const LABEL_KEYS = new Set([
  'label',
  'trucklabel',
  'trackerlabel',
  'truck_label',
  'tracker_label',
  'vehiclelabel',
  'vehicle_label',
  'plate',
  'plaque',
  'registration',
  'immatriculation',
  'truck',
  'vehicle',
])

export function isLabelKey(key) {
  return LABEL_KEYS.has(String(key || '').toLowerCase())
}

// Parcours récursif d'une charge utile JSON. direction 'display' : ancienne plaque du
// GPS → plaque officielle. direction 'storage' : plaque officielle → étiquette GPS,
// pour que la base reste alignée sur le fournisseur quand un formulaire renvoie la
// plaque affichée.
export function applyRegistryToPayload(payload, { entries = OFFICIAL_TRUCKS, direction = 'display' } = {}) {
  const index = buildRegistryIndex(entries)
  const forward = new Map()
  const reverse = new Map()
  for (const record of index.values()) {
    if (record.oldLabel) forward.set(record.oldLabel, record.plate)
    if (record.plate) reverse.set(normalizeTruckLabel(record.plate), record.oldLabel)
  }
  const table = direction === 'storage' ? reverse : forward
  const seen = new WeakSet()

  // Le nom du chauffeur officiel accompagne la plaque officielle (affichage seulement :
  // l'enregistrement conserve ce que le formulaire envoie, le lien reste le trackerId).
  const applyDriver = (record) => {
    if (direction !== 'display') return
    const label = record.truckLabel || record.trackerLabel || record.label || ''
    const official = driverFor(label, { entries })
    if (official) record.driver = official
  }

  const walk = (value, key = '') => {
    if (value === null || value === undefined) return value
    if (typeof value === 'string') {
      const normalized = normalizeTruckLabel(value)
      const mapped = table.get(normalized)
      return mapped && mapped !== value ? mapped : value
    }
    if (typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((item) => walk(item, key))
    if (seen.has(value)) return value
    seen.add(value)
    for (const [childKey, childValue] of Object.entries(value)) {
      if (typeof childValue === 'string') {
        // Une chaîne n'est convertie que dans un champ d'immatriculation : une plaque
        // citée dans un commentaire ou un message reste intacte.
        if (isLabelKey(childKey)) value[childKey] = walk(childValue, childKey)
        continue
      }
      walk(childValue, childKey)
    }
    applyDriver(value)
    return value
  }

  return walk(payload)
}

// Étiquette GPS correspondant à une plaque officielle (pour l'enregistrement).
export function canonicalLabel(plate, { entries = OFFICIAL_TRUCKS, fallback = '' } = {}) {
  const normalized = normalizeTruckLabel(plate)
  if (!normalized) return fallback
  for (const entry of entries) {
    if (normalizeTruckLabel(entry.plate) === normalized) return normalizeTruckLabel(entry.oldLabel)
  }
  return fallback || String(plate || '').trim()
}

// Lit (ou crée) le fichier de correspondance dans le dossier de données.
export function loadTruckRegistry(dataDir) {
  if (!dataDir) return OFFICIAL_TRUCKS
  const file = join(dataDir, 'truck-registry.json')
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const entries = Array.isArray(parsed?.trucks) ? parsed.trucks : []
      const cleaned = entries
        .map((entry) => ({
          oldLabel: String(entry?.oldLabel || '').trim(),
          plate: String(entry?.plate || '').trim(),
          driver: String(entry?.driver || '').trim(),
        }))
        .filter((entry) => entry.oldLabel && entry.plate)
      if (cleaned.length) return cleaned
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ trucks: OFFICIAL_TRUCKS, updatedAt: new Date().toISOString() }, null, 2)}\n`)
  } catch (error) {
    console.warn('[truck-registry] lecture impossible, valeurs par défaut utilisées :', error?.message || error)
  }
  return OFFICIAL_TRUCKS
}

// Accès caché (les réponses HTTP sont converties à chaque requête : inutile de relire
// le fichier à chaque fois).
let registryCache = { dir: null, entries: null, ts: 0 }

export function getTruckRegistry(dataDir, ttlMs = 30000) {
  const now = Date.now()
  if (registryCache.dir === dataDir && registryCache.entries && (now - registryCache.ts) < ttlMs) return registryCache.entries
  const entries = loadTruckRegistry(dataDir)
  registryCache = { dir: dataDir, entries, ts: now }
  return entries
}
