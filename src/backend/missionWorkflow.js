// Workflow mission : statuts automatiques du BL selon les transitions géofence.
// Logique pure et testable : étant donné une transition de zone, on planifie
// le changement de statut du bon de livraison actif du camion.

export const MISSION_STATUSES = ['Prévu', 'En chargement', 'En cours', 'Sur site', 'Au dépôt', 'Livré', 'Annulé']

export function planMissionStatusChange(event, activeOrders = [], zonesById = {}) {
  const order = (activeOrders || []).find((item) => String(item.trackerId) === String(event.trackerId))
  if (!order) return null
  const zone = zonesById[event.geofenceId] || null
  if (!zone) return null
  const current = order.status || (order.active ? 'En cours' : 'Prévu')

  if (zone.type === 'client') {
    if (event.eventType === 'enter' && current !== 'Livré' && current !== 'Annulé' && current !== 'Sur site') {
      return {
        orderId: order.id,
        newStatus: 'Sur site',
        eventType: 'mission_arrived',
        label: `Entrée sur site client ${zone.name}`,
      }
    }
    if (event.eventType === 'exit' && current === 'Sur site') {
      return {
        orderId: order.id,
        newStatus: 'En cours',
        eventType: 'mission_left_site',
        label: `Sortie du site client ${zone.name}`,
      }
    }
  }

  if (zone.type === 'depot') {
    if (event.eventType === 'enter' && current !== 'Livré' && current !== 'Annulé' && current !== 'Au dépôt') {
      return {
        orderId: order.id,
        newStatus: 'Au dépôt',
        eventType: 'mission_at_depot',
        label: `Entrée au dépôt ${zone.name}`,
      }
    }
    if (event.eventType === 'exit' && current === 'Au dépôt') {
      return {
        orderId: order.id,
        newStatus: 'En cours',
        eventType: 'mission_left_depot',
        label: `Sortie du dépôt ${zone.name}`,
      }
    }
  }

  return null
}

export function buildMissionTimelineEvent(orderId, event, change, trackerId, truckLabel) {
  return {
    deliveryOrderId: orderId,
    trackerId: Number(trackerId) || null,
    eventType: change?.eventType || 'geofence_event',
    label: change?.label || `${event.eventType === 'enter' ? 'Entrée' : 'Sortie'} de zone ${event.geofenceName || ''}`,
    lat: Number.isFinite(event.lat) ? event.lat : null,
    lng: Number.isFinite(event.lng) ? event.lng : null,
    at: new Date().toISOString(),
    actor: 'auto',
  }
}
