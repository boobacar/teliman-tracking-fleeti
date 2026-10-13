// Génération du rapport « quel camion a fait quoi » : le texte doit être exact,
// borné en longueur, et ne jamais inventer une valeur absente des données.
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDailyReport, buildWeeklyReport, formatClock, shortTruckLabel } from '../src/backend/dailyReport.js'

const DAY = '2026-10-13'

const orders = [
  {
    id: 1, trackerId: 3487539, truckLabel: '39151WWCI01', driver: 'YACOUBA SARIA', client: 'LAFARGE',
    loadingPoint: 'BOUAKE', destination: 'KORHOGO', goods: 'CIMENT CPJ 42,5', status: 'Livré',
    date: '2026-10-13T13:57:00.000Z', departureDateTime: '2026-10-13T11:44:00.000Z', completedAt: '2026-10-13T13:57:00.000Z',
  },
  {
    id: 2, trackerId: 3537761, truckLabel: '3100WWCI01', driver: 'MAMADOU', client: 'K1 MINE',
    loadingPoint: 'MINE', destination: 'USINE', goods: 'CLINKER', status: 'En cours',
    date: '2026-10-13T06:10:00.000Z', departureDateTime: '2026-10-13T06:10:00.000Z',
  },
  // Bon d'hier : ne doit pas apparaître dans le rapport du jour
  { id: 3, trackerId: 3537762, truckLabel: '3216WWCI01', client: 'LAFARGE', status: 'Livré', date: '2026-10-12T09:00:00.000Z' },
]

const events = [
  { trackerId: 3488325, truckLabel: '45791WWCI01', eventType: 'exit', geofenceName: 'Bouaké', createdAt: '2026-10-13T15:07:00.000Z' },
  { trackerId: 3537762, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Bouaké', createdAt: '2026-10-13T10:08:00.000Z' },
  { trackerId: 3488325, truckLabel: '45791WWCI01', eventType: 'enter', geofenceName: 'Korhogo, client', createdAt: '2026-10-12T18:48:00.000Z' },
]

const fleetRows = [
  { trackerId: 3487539, truckLabel: '39151WWCI01', driver: 'YACOUBA SARIA', distanceKm: 412, drivingSeconds: 6 * 3600 + 20 * 60, restSeconds: 2 * 3600 + 5 * 60 },
  { trackerId: 3537761, truckLabel: '3100WWCI01', driver: 'MAMADOU', distanceKm: 268.4, drivingSeconds: 4 * 3600 + 10 * 60, restSeconds: 90 * 60 },
]

const vouchers = [{ trackerId: 3487539, truckLabel: '39151WWCI01', liters: 250, voucherNumber: 'C-118', date: '2026-10-13T07:00:00.000Z' }]

const alerts = [
  { trackerId: 3537761, truckLabel: '3100WWCI01', label: 'stationnement prolongé', createdAt: '2026-10-13T09:30:00.000Z' },
]

const knownTrucks = [
  { id: 3487539, label: '39151WWCI01' }, { id: 3537761, label: '3100WWCI01' },
  { id: 3537762, label: '3216WWCI01' }, { id: 3488325, label: '45791WWCI01' },
  { id: 3487533, label: '3952WWCI01' },
]

test('le rapport contient l’en-tête, le résumé et un bloc par camion actif', () => {
  const { text, stats } = buildDailyReport({ day: DAY, dateLabel: '13/10/2026', hourLabel: '20h', orders, events, fleetRows, vouchers, alerts, knownTrucks })
  assert.match(text, /^TELIMAN LOGISTIQUE - Rapport du 13\/10\/2026 à 20h/)
  assert.match(text, /4 camions actifs · 2 missions · 2 passages de zone · 1 bon carburant/)
  assert.match(text, /39151WWCI01 - YACOUBA SARIA/)
  assert.match(text, /LAFARGE - BOUAKE → KORHOGO \(CIMENT CPJ 42,5\)/)
  assert.match(text, /départ 11h44 · livré 13h57/)
  assert.match(text, /Sortie de zone Bouaké à 15h07/)
  assert.match(text, /Conduite 6h20 · repos 2h05 · 412 km/)
  assert.match(text, /Carburant : 250 L · bon C-118/)
  assert.match(text, /1 stationnement prolongé/)
  assert.equal(stats.missions, 2)
  assert.equal(stats.zoneEvents, 2)
})

test('un bon d’un autre jour n’entre pas dans le rapport du jour', () => {
  const { text } = buildDailyReport({ day: DAY, dateLabel: '13/10/2026', orders, events, fleetRows, knownTrucks })
  // 3216WWCI01 n'a qu'un bon d'hier, mais deux passages de zone aujourd'hui
  assert.doesNotMatch(text, /3216WWCI01 - chauffeur non renseigné\n- LAFARGE/)
  assert.match(text, /Entrée de zone Bouaké à 10h08/)
})

test('les camions sans activité sont regroupés sur une seule ligne', () => {
  const { text, stats } = buildDailyReport({ day: DAY, dateLabel: '13/10/2026', orders, events, fleetRows, knownTrucks })
  assert.match(text, /^Sans activité aujourd'hui : 3952$/m)
  assert.equal(stats.inactiveTrucks, 1)
})

test('aucune valeur inventée : sans données Fleeti, la ligne de kilométrage disparaît', () => {
  const { text } = buildDailyReport({ day: DAY, dateLabel: '13/10/2026', orders, events, vouchers, knownTrucks, fleetDetailsAvailable: false })
  assert.doesNotMatch(text, /Conduite/)
  assert.doesNotMatch(text, /\d+ km/)
  assert.match(text, /Détails kilométrage\/conduite indisponibles/)
})

test('un rapport trop long est tronqué en gardant les camions les plus actifs', () => {
  const manyOrders = Array.from({ length: 30 }, (unused, index) => ({
    id: 100 + index, trackerId: 9000 + index, truckLabel: `90${index}WWCI01`, client: `CLIENT ${index}`,
    loadingPoint: 'A', destination: 'B', goods: 'MARCHANDISE', status: 'Livré', date: `${DAY}T08:00:00.000Z`,
  }))
  const { text, stats } = buildDailyReport({ day: DAY, dateLabel: '13/10/2026', orders: manyOrders, knownTrucks, maxChars: 600 })
  assert.ok(text.length <= 600, `longueur ${text.length} au-delà de la limite`)
  assert.match(text, /… et \d+ autres camions actifs/)
  assert.ok(stats.removedBlocks > 0)
})

test('bilan hebdomadaire : agrégats par camion sur la semaine', () => {
  const { text, stats } = buildWeeklyReport({ dayFrom: '2026-10-07', dayTo: '2026-10-13', dateLabel: 'du 07/10 au 13/10', fleetRows, orders, events, vouchers, knownTrucks })
  assert.match(text, /^TELIMAN LOGISTIQUE - Bilan de la semaine \(du 07\/10 au 13\/10\)/)
  assert.match(text, /4 camions en activité · 3 missions · 3 passages de zone/)
  assert.match(text, /39151WWCI01 - YACOUBA SARIA\n- 1 mission · 412 km · conduite 6h20 · 1 bon carburant/)
  assert.equal(stats.missions, 3)
})

test('formats élémentaires', () => {
  assert.equal(shortTruckLabel('39151WWCI01'), '39151')
  assert.equal(shortTruckLabel('3100WWCI01'), '3100')
  assert.equal(formatClock('2026-10-13T15:07:00.000Z') !== null, true)
  assert.equal(formatClock(null), null)
})
