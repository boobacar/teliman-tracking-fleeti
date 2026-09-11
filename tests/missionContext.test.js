// Contexte « mission en cours » des alertes : un BL périmé ne doit JAMAIS être
// présenté comme la mission en cours d'un camion (incident prod du 11/09/2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMissionContext,
  DEFAULT_MISSION_MAX_AGE_HOURS,
  describeMissionSkip,
  isMissionInProgress,
  pickActiveMission,
  resolveMissionAgeHours,
  resolveMissionReferenceMs,
} from '../src/backend/missionContext.js'
import { deliveryStatusKey } from '../src/lib/deliveryOrders.js'

const NOW = Date.parse('2026-09-11T19:00:00.000Z')

// Cas réel : BL du 31/08 17:12 resté `active` + `En cours` pendant 266 h.
const staleOrder = {
  id: '1788197286385',
  trackerId: 3487533,
  truckLabel: '3952WWCI01',
  reference: '000002133',
  client: 'K1 MINE',
  destination: 'Bouaké',
  goods: 'Gravier',
  status: 'En cours',
  date: '',
  departureDateTime: '2026-08-31T17:12:00.000Z',
  arrivalDateTime: '',
  completedAt: '',
  active: 1,
}

// BL en cours émis le jour même (16:50), départ 18:00.
const freshOrder = {
  id: '1789150790198',
  trackerId: 3488325,
  truckLabel: '45791WWCI01',
  reference: '000002466',
  client: 'K1 MINE',
  destination: 'Bouaké',
  goods: 'Gravier',
  status: 'En cours',
  date: '',
  departureDateTime: '2026-09-11T16:50:00.000Z',
  arrivalDateTime: '',
  completedAt: '',
  active: 1,
}

test('un BL actif et récent est retenu comme mission en cours', () => {
  const mission = pickActiveMission([freshOrder], 3488325, { now: NOW })
  assert.equal(mission.reference, '000002466')
  assert.deepEqual(buildMissionContext(mission), {
    reference: '000002466',
    client: 'K1 MINE',
    destination: 'Bouaké',
    goods: 'Gravier',
    quantity: '',
  })
})

test('un BL jamais clôturé (266 h) n’est PLUS présenté comme mission en cours', () => {
  assert.equal(Math.round(resolveMissionAgeHours(staleOrder, NOW)), 266)
  assert.equal(isMissionInProgress(staleOrder, { now: NOW }), false)
  assert.equal(pickActiveMission([staleOrder], 3487533, { now: NOW }), null, 'mieux vaut aucune mission qu’une mission périmée')
  assert.equal(buildMissionContext(pickActiveMission([staleOrder], 3487533, { now: NOW })), null)
})

test('les statuts terminaux, l’arrivée renseignée et completedAt excluent la mission', () => {
  assert.equal(isMissionInProgress({ ...freshOrder, status: 'Livré' }, { now: NOW }), false)
  assert.equal(isMissionInProgress({ ...freshOrder, status: 'livre' }, { now: NOW }), false)
  assert.equal(isMissionInProgress({ ...freshOrder, status: 'Annulé' }, { now: NOW }), false)
  assert.equal(isMissionInProgress({ ...freshOrder, arrivalDateTime: '2026-09-11T18:30:00.000Z' }, { now: NOW }), false)
  assert.equal(isMissionInProgress({ ...freshOrder, completedAt: '2026-09-11T18:30:00.000Z' }, { now: NOW }), false)
  assert.equal(isMissionInProgress({ ...freshOrder, active: 0 }, { now: NOW }), false)
})

test('un BL sans date exploitable est écarté (aucune mission plutôt qu’une douteuse)', () => {
  const undated = { ...freshOrder, id: 'BL-2026-1', date: '', departureDateTime: '', createdAt: '' }
  assert.equal(resolveMissionReferenceMs(undated), null)
  assert.equal(resolveMissionAgeHours(undated, NOW), null)
  assert.equal(isMissionInProgress(undated, { now: NOW }), false)
})

test('la fraîcheur se mesure sur la date la plus récente connue du BL', () => {
  // Créé il y a 4 jours mais départ aujourd'hui → mission encore valable.
  const planned = { ...freshOrder, id: '1788770000000', date: '2026-09-07T10:00:00.000Z', departureDateTime: '2026-09-11T18:30:00.000Z' }
  assert.equal(resolveMissionReferenceMs(planned), Date.parse('2026-09-11T18:30:00.000Z'))
  assert.equal(isMissionInProgress(planned, { now: NOW }), true)
})

test('le seuil d’âge est paramétrable (MISSION_CONTEXT_MAX_AGE_HOURS)', () => {
  // id antérieur au départ, pour que la référence de fraîcheur soit bien le départ (36 h).
  const order36h = { ...freshOrder, id: '1789000000000', departureDateTime: '2026-09-10T07:00:00.000Z' }
  assert.equal(Math.round(resolveMissionAgeHours(order36h, NOW)), 36)
  assert.equal(isMissionInProgress(order36h, { now: NOW, maxAgeHours: 72 }), true)
  assert.equal(isMissionInProgress(order36h, { now: NOW, maxAgeHours: 24 }), false)
  assert.equal(DEFAULT_MISSION_MAX_AGE_HOURS, 72, '72 h par défaut')
})

test('avec plusieurs BL actifs sur un camion, le plus récent gagne', () => {
  const older = { ...freshOrder, id: '1789140000000', reference: '000002400', departureDateTime: '2026-09-11T10:00:00.000Z' }
  const newest = { ...freshOrder, id: '1789150790198', reference: '000002466' }
  assert.equal(pickActiveMission([older, newest, staleOrder], 3488325, { now: NOW }).reference, '000002466')
})

test('seuls les BL du camion demandé sont considérés', () => {
  assert.equal(pickActiveMission([freshOrder], 999, { now: NOW }), null)
  assert.equal(pickActiveMission([freshOrder], '', { now: NOW }), null)
  assert.equal(pickActiveMission([], 3488325, { now: NOW }), null)
})

test('describeMissionSkip explique pourquoi aucune mission n’est affichée', () => {
  const reason = describeMissionSkip([staleOrder], 3487533, { now: NOW })
  assert.match(reason, /000002133/)
  assert.match(reason, /266 h/)
  assert.match(describeMissionSkip([], 3487533, { now: NOW }), /aucun BL/)
  assert.equal(describeMissionSkip([freshOrder], 3488325, { now: NOW }), '')
})

test('deliveryStatusKey normalise les statuts accentués', () => {
  assert.equal(deliveryStatusKey('Livré'), 'livre')
  assert.equal(deliveryStatusKey(' En Cours '), 'en cours')
  assert.equal(deliveryStatusKey(null), '')
})

test('régression prod : sur les 5 BL actifs du 11/09, seuls les 3 récents donnent une mission', () => {
  const orders = [
    staleOrder,
    { ...staleOrder, id: '1788197238044', trackerId: 3537766, truckLabel: '4400WWCI01', reference: '000002132' },
    { ...freshOrder, trackerId: 3488325, reference: '000002466' },
    { ...freshOrder, id: '1789150695271', trackerId: 3537761, truckLabel: '3100WWCI01', reference: '000002468' },
    { ...freshOrder, id: '1789150618348', trackerId: 3537762, truckLabel: '3216WWCI01', reference: '000002469' },
  ]
  const missions = orders.map((order) => ({ tracker: order.trackerId, mission: pickActiveMission(orders, order.trackerId, { now: NOW }) }))
  assert.deepEqual(missions.map((entry) => entry.tracker), [3487533, 3537766, 3488325, 3537761, 3537762])
  assert.equal(missions[0].mission, null, '3952WWCI01 (BL 000002133, 11 j) : aucune mission')
  assert.equal(missions[1].mission, null, '4400WWCI01 (BL 000002132, 11 j) : aucune mission')
  assert.equal(missions[2].mission.reference, '000002466')
  assert.equal(missions[3].mission.reference, '000002468')
  assert.equal(missions[4].mission.reference, '000002469')
})
