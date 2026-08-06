import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildMissionTimelineEvent, planMissionStatusChange } from '../src/backend/missionWorkflow.js'

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/pages/DeliveryOrderDetailPage.jsx', import.meta.url), 'utf8')

const orders = [
  { id: 10, trackerId: 1, status: 'Prévu', active: true },
  { id: 11, trackerId: 2, status: 'En cours', active: true },
  { id: 12, trackerId: 3, status: 'Livré', active: false },
]
const zonesById = { 100: { id: 100, name: 'Korhogo, client', type: 'client' }, 101: { id: 101, name: 'Bouaké, ville', type: 'depot' } }

test('entrée en zone client : Prévu → Sur site', () => {
  const change = planMissionStatusChange({ trackerId: 1, geofenceId: 100, eventType: 'enter' }, orders, zonesById)
  assert.deepEqual(change, { orderId: 10, newStatus: 'Sur site', eventType: 'mission_arrived', label: 'Entrée sur site client Korhogo, client' })
})

test('sortie de zone client : Sur site → En cours', () => {
  const ordersOnSite = [{ id: 10, trackerId: 1, status: 'Sur site', active: true }]
  const change = planMissionStatusChange({ trackerId: 1, geofenceId: 100, eventType: 'exit' }, ordersOnSite, zonesById)
  assert.equal(change.newStatus, 'En cours')
  assert.equal(change.eventType, 'mission_left_site')
})

test('entrée au dépôt : statut Au dépôt', () => {
  const change = planMissionStatusChange({ trackerId: 2, geofenceId: 101, eventType: 'enter' }, orders, zonesById)
  assert.deepEqual(change, { orderId: 11, newStatus: 'Au dépôt', eventType: 'mission_at_depot', label: 'Entrée au dépôt Bouaké, ville' })
})

test('aucun changement pour un camion sans BL actif ou zone inconnue', () => {
  assert.equal(planMissionStatusChange({ trackerId: 99, geofenceId: 100, eventType: 'enter' }, orders, zonesById), null)
  assert.equal(planMissionStatusChange({ trackerId: 1, geofenceId: 999, eventType: 'enter' }, orders, zonesById), null)
})

test('un BL livré ou annulé n’est pas réactivé par une entrée de zone', () => {
  const delivered = [{ id: 12, trackerId: 3, status: 'Livré', active: false }]
  const change = planMissionStatusChange({ trackerId: 3, geofenceId: 100, eventType: 'enter' }, delivered, zonesById)
  assert.equal(change, null)
})

test('buildMissionTimelineEvent construit un événement géolocalisé', () => {
  const event = { trackerId: 1, truckLabel: 'BENNE 01', geofenceName: 'Korhogo, client', eventType: 'enter', lat: 9.411007, lng: -5.626558 }
  const change = { orderId: 10, newStatus: 'Sur site', eventType: 'mission_arrived', label: 'Entrée sur site client Korhogo, client' }
  const item = buildMissionTimelineEvent(10, event, change, 1, 'BENNE 01')
  assert.equal(item.deliveryOrderId, 10)
  assert.equal(item.trackerId, 1)
  assert.equal(item.eventType, 'mission_arrived')
  assert.equal(item.lat, 9.411007)
  assert.equal(item.actor, 'auto')
  assert.ok(item.at)
})

test('le serveur branche le workflow mission sur les transitions géofence', () => {
  assert.match(serverSource, /planMissionStatusChange\(event, activeOrders, zonesById\)/)
  assert.match(serverSource, /updateDeliveryOrderAtomic\(change\.orderId, \{ status: change\.newStatus \}\)/)
  assert.match(serverSource, /appendMissionTimelineEvent\(buildMissionTimelineEvent/)
  assert.match(serverSource, /app\.get\('\/api\/delivery-orders\/:id\/timeline'/)
  assert.match(serverSource, /app\.post\('\/api\/delivery-orders\/:id\/timeline'/)
  assert.match(serverSource, /actor: 'manuel'/)
})

test('la fiche mission affiche la timeline dynamique et l’ajout manuel', () => {
  assert.match(detailSource, /loadMissionTimeline\(id\)/)
  assert.match(detailSource, /appendMissionTimeline\(id, \{ eventType: 'manual', label \}\)/)
  assert.match(detailSource, /mission-timeline-events/)
  assert.match(detailSource, /Ajouter un événement/)
  assert.match(detailSource, /Saisie manuelle/)
  assert.match(detailSource, /Automatique \(géofence\)/)
})
