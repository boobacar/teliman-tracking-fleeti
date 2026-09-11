// Contexte « mission en cours » attaché aux alertes WhatsApp d'un véhicule.
//
// Un BL n'est retenu que s'il est RÉELLEMENT en cours :
//   - `active` (non clôturé côté application),
//   - statut non terminal (`Livré`, `Annulé`… exclus) et pas de `completedAt`,
//   - pas de date d'arrivée renseignée,
//   - et surtout RÉCENT : au-delà de `maxAgeHours` (défaut 72 h), le BL est
//     considéré comme un reliquat jamais clôturé → aucune mission n'est affichée.
//
// Motif (incident 11/09/2026) : deux BL du 31/08 (266 h) restés `active` +
// `En cours` étaient attachés à chaque alerte de leurs camions, d'où des alertes
// annonçant une « Mission en cours » pour des camions à vide depuis 11 jours.
// Mieux vaut aucune mission qu'une mission périmée : en cas de doute (date
// illisible), le BL est écarté.
import { deliveryStatusKey } from '../lib/deliveryOrders.js'

export const DEFAULT_MISSION_MAX_AGE_HOURS = 72

// Statuts qui signifient « mission terminée » : jamais affichés comme en cours.
export const TERMINAL_MISSION_STATUSES = ['livre', 'annule', 'cloture', 'cloturee']

const HOUR_MS = 60 * 60 * 1000

// Instant de référence d'un BL = la PLUS RÉCENTE des dates connues (départ prévu,
// date de création, createdAt, id en millisecondes). On prend le maximum et non la
// première trouvée : un BL créé il y a 4 jours pour un départ aujourd'hui reste
// une mission fraîche. null si aucune date exploitable.
export function resolveMissionReferenceMs(order = {}) {
  const candidates = [order.departureDateTime, order.date, order.createdAt]
  let latest = null
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ''))
    if (Number.isFinite(parsed) && (latest === null || parsed > latest)) latest = parsed
  }
  const numericId = Number(order.id)
  if (Number.isFinite(numericId) && numericId > 1e12 && (latest === null || numericId > latest)) latest = numericId
  return latest
}

export function resolveMissionAgeHours(order = {}, now = Date.now()) {
  const reference = resolveMissionReferenceMs(order)
  if (!Number.isFinite(reference)) return null
  return Math.max(0, (now - reference) / HOUR_MS)
}

export function isTerminalMissionStatus(status) {
  return TERMINAL_MISSION_STATUSES.includes(deliveryStatusKey(status))
}

// Un BL est « en cours » seulement s'il est ouvert ET frais.
export function isMissionInProgress(order = {}, { now = Date.now(), maxAgeHours = DEFAULT_MISSION_MAX_AGE_HOURS } = {}) {
  if (!order || typeof order !== 'object') return false
  if (order.active !== true && order.active !== 1) return false
  if (order.completedAt) return false
  if (String(order.arrivalDateTime || '').trim()) return false
  if (isTerminalMissionStatus(order.status)) return false
  const ageHours = resolveMissionAgeHours(order, now)
  if (ageHours === null) return false
  return ageHours <= Math.max(0, Number(maxAgeHours) || DEFAULT_MISSION_MAX_AGE_HOURS)
}

// Sélectionne l'UNIQUE mission du véhicule : la plus récente parmi celles qui
// sont réellement en cours. Renvoie null si aucune (ou si le seul candidat est
// un reliquat — c'est volontaire).
export function pickActiveMission(orders = [], trackerId, { now = Date.now(), maxAgeHours = DEFAULT_MISSION_MAX_AGE_HOURS } = {}) {
  const id = String(trackerId ?? '').trim()
  if (!id) return null
  const candidates = (orders || []).filter(
    (order) => String(order?.trackerId ?? '').trim() === id && isMissionInProgress(order, { now, maxAgeHours }),
  )
  if (!candidates.length) return null
  return candidates.reduce((best, order) => {
    if (!best) return order
    const bestMs = resolveMissionReferenceMs(best) ?? 0
    const orderMs = resolveMissionReferenceMs(order) ?? 0
    if (orderMs !== bestMs) return orderMs > bestMs ? order : best
    return Number(order.id) > Number(best.id) ? order : best
  }, null)
}

// Contexte minimal affiché dans l'alerte (réf, client, destination, marchandise).
export function buildMissionContext(order = null) {
  if (!order) return null
  const context = {
    reference: String(order.reference || '').trim(),
    client: String(order.client || '').trim(),
    destination: String(order.destination || '').trim(),
    goods: String(order.goods || '').trim(),
  }
  if (!context.reference && !context.client && !context.destination && !context.goods) return null
  return context
}

// Diagnostic : pourquoi aucune mission n'est affichée (journalisation ops).
export function describeMissionSkip(orders = [], trackerId, { now = Date.now(), maxAgeHours = DEFAULT_MISSION_MAX_AGE_HOURS } = {}) {
  const id = String(trackerId ?? '').trim()
  if (!id) return ''
  const mine = (orders || []).filter((order) => String(order?.trackerId ?? '').trim() === id)
  if (!mine.length) return 'aucun BL lié à ce camion'
  const inactive = mine.filter((order) => !(order.active === true || order.active === 1))
  const stale = activeCandidates(mine).filter((order) => !isMissionInProgress(order, { now, maxAgeHours }))
  if (stale.length) {
    const details = stale
      .map((order) => {
        const age = resolveMissionAgeHours(order, now)
        const ageLabel = age === null ? 'âge inconnu' : `${Math.round(age)} h`
        return `${order.reference || order.id} (${ageLabel}, statut ${order.status || '-'})`
      })
      .join(', ')
    return `BL sans mission en cours : ${details}`
  }
  if (inactive.length) return `${inactive.length} BL clôturé(s) uniquement`
  return ''
}

function activeCandidates(orders) {
  return orders.filter((order) => order.active === true || order.active === 1)
}
