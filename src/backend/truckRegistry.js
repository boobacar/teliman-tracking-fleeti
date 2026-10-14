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
    if (newKey && !index.has(newKey)) index.set(newKey, { ...record, oldLabel: newKey })
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
