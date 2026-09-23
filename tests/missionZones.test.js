// Alertes CLIENT aux bornes de mission : sortie de la zone de départ (« Départ »)
// et entrée dans la zone d'arrivée (« Arrivée »). Rien d'autre ne part au client.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  describeMissionZoneMapping,
  planClientBoundaryAlert,
  resolveMissionZones,
  resolveZoneForText,
  zoneMatchKey,
} from '../src/backend/missionZones.js'

const NOW = Date.parse('2026-09-11T20:00:00.000Z')

// Zones réelles (relevées en prod le 11/09/2026).
const geofences = [
  { id: 1, name: 'Fadyadougou, mine', type: 'carriere', active: true },
  { id: 2, name: 'Korhogo, client', type: 'client', active: true },
  { id: 5, name: 'Abidjan, carrière', type: 'carriere', active: true },
  { id: 6, name: 'Bouaké', type: 'carriere', active: true },
]

const zoneMap = [{ id: 1, matchText: 'mine', geofenceId: 6 }]

// Mission LAFARGE en cours : BOUAKE → KORHOGO.
const lafargeOrder = {
  id: '1789150790198',
  trackerId: 3488325,
  truckLabel: '45791WWCI01',
  client: 'LAFARGE',
  reference: '31011323499',
  loadingPoint: 'BOUAKE',
  destination: 'KORHOGO',
  status: 'En cours',
  departureDateTime: '2026-09-11T16:50:00.000Z',
  active: 1,
  departureNotifiedAt: '',
  arrivalNotifiedAt: '',
}

test('zoneMatchKey ignore accents, casse et ponctuation', () => {
  assert.equal(zoneMatchKey('Bouaké, ville'), 'bouake ville')
  assert.equal(zoneMatchKey('  BOUAKE '), 'bouake')
  assert.equal(zoneMatchKey(null), '')
})

test('resolveZoneForText : table explicite d’abord, puis égalité stricte', () => {
  assert.equal(resolveZoneForText('BOUAKE', { geofences }).zone.id, 6, 'nom complet, accents/casse ignorés')
  assert.equal(resolveZoneForText('KORHOGO', { geofences }).zone.id, 2, 'premier segment avant la virgule')
  assert.equal(resolveZoneForText('Bouaké, Carrière', { geofences }), null, 'segment inconnu : aucune devinette')
  assert.equal(resolveZoneForText('Caderac', { geofences, zoneMap }), null, 'site non configuré → silence')
  // La table explicite gagne : « Mine » → zone Bouaké (instruction métier)
  assert.equal(resolveZoneForText('Mine', { geofences, zoneMap }).zone.id, 6)
  assert.equal(resolveZoneForText('Mine', { geofences, zoneMap }).source, 'map')
  // Sans la table, « Mine » ne matche PAS « Fadyadougou, mine » (pas de devinette)
  assert.equal(resolveZoneForText('Mine', { geofences }), null)
})

test('resolveMissionZones relie le point de chargement au départ et la destination à l’arrivée', () => {
  const { departureZone, arrivalZone, departureSource, arrivalSource } = resolveMissionZones(lafargeOrder, { geofences, zoneMap })
  assert.equal(departureZone.name, 'Bouaké')
  assert.equal(arrivalZone.name, 'Korhogo, client')
  assert.equal(departureSource, 'name')
  assert.equal(arrivalSource, 'name')
})

test('sortie de la zone de départ → alerte client « Départ »', () => {
  const plan = planClientBoundaryAlert(
    { trackerId: 3488325, eventType: 'exit', geofenceId: 6, geofenceName: 'Bouaké' },
    { orders: [lafargeOrder], geofences, zoneMap, now: NOW },
  )
  assert.equal(plan.role, 'departure')
  assert.equal(plan.order.reference, '31011323499')
  assert.equal(plan.zone.name, 'Bouaké')
})

test('entrée dans la zone de destination → alerte client « Arrivée »', () => {
  const plan = planClientBoundaryAlert(
    { trackerId: 3488325, eventType: 'enter', geofenceId: 2, geofenceName: 'Korhogo, client' },
    { orders: [lafargeOrder], geofences, zoneMap, now: NOW },
  )
  assert.equal(plan.role, 'arrival')
  assert.equal(plan.zone.name, 'Korhogo, client')
})

test('aucune alerte client hors des deux bornes de la mission', () => {
  const cases = [
    { label: 'entrée dans la zone de départ', event: { trackerId: 3488325, eventType: 'enter', geofenceId: 6 } },
    { label: 'sortie de la zone d’arrivée', event: { trackerId: 3488325, eventType: 'exit', geofenceId: 2 } },
    { label: 'zone sans rapport avec la mission', event: { trackerId: 3488325, eventType: 'exit', geofenceId: 5 } },
    { label: 'camion sans mission en cours', event: { trackerId: 999999, eventType: 'exit', geofenceId: 6 } },
    { label: 'véhicule inconnu', event: { trackerId: '', eventType: 'exit', geofenceId: 6 } },
  ]
  for (const { label, event } of cases) {
    assert.equal(planClientBoundaryAlert(event, { orders: [lafargeOrder], geofences, zoneMap, now: NOW }), null, label)
  }
})

test('une borne déjà annoncée n’est jamais annoncée deux fois', () => {
  const order = { ...lafargeOrder, departureNotifiedAt: '2026-09-11T17:00:00.000Z' }
  assert.equal(
    planClientBoundaryAlert({ trackerId: 3488325, eventType: 'exit', geofenceId: 6 }, { orders: [order], geofences, zoneMap, now: NOW }),
    null,
  )
  const arrived = { ...lafargeOrder, arrivalNotifiedAt: '2026-09-11T19:00:00.000Z' }
  assert.equal(
    planClientBoundaryAlert({ trackerId: 3488325, eventType: 'enter', geofenceId: 2 }, { orders: [arrived], geofences, zoneMap, now: NOW }),
    null,
  )
})

test('une mission périmée ou livrée ne déclenche aucune alerte client', () => {
  const stale = { ...lafargeOrder, departureDateTime: '2026-08-31T17:12:00.000Z', id: '1788197238044' }
  assert.equal(planClientBoundaryAlert({ trackerId: 3488325, eventType: 'exit', geofenceId: 6 }, { orders: [stale], geofences, zoneMap, now: NOW }), null)
  const delivered = { ...lafargeOrder, status: 'Livré' }
  assert.equal(planClientBoundaryAlert({ trackerId: 3488325, eventType: 'exit', geofenceId: 6 }, { orders: [delivered], geofences, zoneMap, now: NOW }), null)
})

test('describeMissionZoneMapping signale les zones reconnues et les manquantes', () => {
  const k1 = {
    ...lafargeOrder,
    id: '1789150695271',
    trackerId: 3537761,
    client: 'K1 MINE',
    reference: '000002468',
    loadingPoint: 'Caderac',
    destination: 'Mine',
  }
  const [first, second] = describeMissionZoneMapping([lafargeOrder, k1], { geofences, zoneMap, now: NOW })
  assert.equal(first.departureZone.name, 'Bouaké')
  assert.equal(first.arrivalZone.name, 'Korhogo, client')
  assert.equal(second.departureZone, null, 'Caderac n’est pas encore relié à une zone')
  assert.equal(second.arrivalZone.name, 'Bouaké')
})

test('les alertes de zone génériques excluent les destinataires clients', () => {
  const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  // Le filtrage vit désormais dans le moteur de routage (src/backend/alertRouting.js) :
  // un destinataire « client » n'a pas les catégories de zone dans ses défauts.
  assert.match(serverSource, /function routedAlertPhones\(category, context = \{\}\)/)
  assert.match(serverSource, /routedAlertPhones\(geofenceAlertCategoryKey\(event\?\.eventType\)/)
  const routingSource = readFileSync(new URL('../src/backend/alertRouting.js', import.meta.url), 'utf8')
  assert.match(routingSource, /client: \['bl_departed', 'bl_arrived'\]/)
  // Bornes de mission branchées dans le moteur de zones
  assert.match(serverSource, /notifyClientMissionBoundaryWhatsApp\(event\)/)
  assert.match(serverSource, /planClientBoundaryAlert\(event/)
})
