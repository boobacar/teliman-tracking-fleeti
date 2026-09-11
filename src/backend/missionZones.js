// Zones de départ / arrivée d'une mission, et alertes client aux deux bornes.
//
// Règle métier (11/09/2026) : un client ne reçoit QUE deux alertes par mission —
//   - « Départ » : le camion SORT de la zone de départ de la mission,
//   - « Arrivée » : le camion ENTRE dans la zone de destination.
// Tout le reste (autres zones, excès de vitesse, stationnement) reste interne.
//
// La zone de départ est déduite du `loadingPoint` du BL, la zone d'arrivée de sa
// `destination`, via `mission_zone_map` (texte → zone, éditable dans l'interface).
// À défaut de correspondance explicite, on tente une égalité STRICTE avec le nom
// de zone ou son premier segment (avant la virgule) : « BOUAKE » → « Bouaké »,
// « KORHOGO » → « Korhogo, client ». Un texte ambigu (« Mine » face à
// « Fadyadougou, mine ») n'est JAMAIS deviné : silence côté client + journal.
import { deliveryStatusKey } from '../lib/deliveryOrders.js'
import { isMissionInProgress } from './missionContext.js'

export const CLIENT_ALERT_ROLES = ['departure', 'arrival']

// Clé de comparaison (identique à la table mission_zone_map).
export function zoneMatchKey(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Correspondance d'un texte de BL vers une zone : table explicite d'abord,
// puis égalité stricte (nom complet ou premier segment) — sinon null.
export function resolveZoneForText(text, { zoneMap = [], geofences = [] } = {}) {
  const key = zoneMatchKey(text)
  if (!key) return null

  const explicit = (zoneMap || []).find((entry) => zoneMatchKey(entry?.matchText) === key)
  if (explicit) {
    const zone = (geofences || []).find((item) => Number(item.id) === Number(explicit.geofenceId))
    if (zone) return { zone, source: 'map' }
  }

  const matches = (geofences || []).filter((zone) => {
    const fullName = zoneMatchKey(zone?.name)
    if (!fullName) return false
    const firstSegment = zoneMatchKey(String(zone.name).split(',')[0])
    return key === fullName || key === firstSegment
  })
  // Ambiguité (plusieurs zones) = pas de devinette.
  if (matches.length === 1) return { zone: matches[0], source: 'name' }
  return null
}

// Zones de la mission : départ (loadingPoint) et arrivée (destination).
export function resolveMissionZones(order = {}, { zoneMap = [], geofences = [] } = {}) {
  const departure = resolveZoneForText(order?.loadingPoint, { zoneMap, geofences })
  const arrival = resolveZoneForText(order?.destination, { zoneMap, geofences })
  return {
    departureZone: departure?.zone || null,
    departureSource: departure?.source || '',
    arrivalZone: arrival?.zone || null,
    arrivalSource: arrival?.source || '',
  }
}

// Décide si un événement de zone déclenche une alerte CLIENT, pour la mission en
// cours du camion. Renvoie null si aucun client ne doit être notifié (événement
// hors mission, zone sans correspondance, ou borne déjà annoncée).
export function planClientBoundaryAlert(
  event = {},
  { orders = [], zonesById = {}, zoneMap = [], geofences = [], now = Date.now(), maxAgeHours = 72 } = {},
) {
  const trackerId = String(event?.trackerId ?? event?.tracker_id ?? '').trim()
  if (!trackerId) return null
  const eventType = String(event?.eventType || '').trim()
  if (eventType !== 'enter' && eventType !== 'exit') return null

  const order = (orders || []).find(
    (item) => String(item?.trackerId ?? '').trim() === trackerId && isMissionInProgress(item, { now, maxAgeHours }),
  )
  if (!order) return null
  if (deliveryStatusKey(order.status) === 'livre') return null

  const zoneList = geofences?.length ? geofences : Object.values(zonesById || {})
  const { departureZone, arrivalZone } = resolveMissionZones(order, { zoneMap, geofences: zoneList })
  const eventZoneId = Number(event?.geofenceId)
  if (!Number.isFinite(eventZoneId)) return null

  if (eventType === 'exit' && departureZone && Number(departureZone.id) === eventZoneId) {
    if (String(order.departureNotifiedAt || '').trim()) return null
    return { order, role: 'departure', zone: departureZone, alreadyNotifiedAt: order.departureNotifiedAt || '' }
  }

  if (eventType === 'enter' && arrivalZone && Number(arrivalZone.id) === eventZoneId) {
    if (String(order.arrivalNotifiedAt || '').trim()) return null
    return { order, role: 'arrival', zone: arrivalZone, alreadyNotifiedAt: order.arrivalNotifiedAt || '' }
  }

  return null
}

// Diagnostic affiché dans l'interface : pour chaque mission en cours, quelles
// zones sont reconnues (et lesquelles manquent).
export function describeMissionZoneMapping(orders = [], { zoneMap = [], geofences = [], now = Date.now(), maxAgeHours = 72 } = {}) {
  return (orders || [])
    .filter((order) => isMissionInProgress(order, { now, maxAgeHours }))
    .map((order) => {
      const { departureZone, arrivalZone, departureSource, arrivalSource } = resolveMissionZones(order, { zoneMap, geofences })
      return {
        orderId: order.id,
        reference: order.reference || '',
        client: order.client || '',
        truckLabel: order.truckLabel || '',
        loadingPoint: order.loadingPoint || '',
        destination: order.destination || '',
        departureZone: departureZone ? { id: Number(departureZone.id), name: departureZone.name, source: departureSource } : null,
        arrivalZone: arrivalZone ? { id: Number(arrivalZone.id), name: arrivalZone.name, source: arrivalSource } : null,
        departureNotifiedAt: order.departureNotifiedAt || '',
        arrivalNotifiedAt: order.arrivalNotifiedAt || '',
      }
    })
}
