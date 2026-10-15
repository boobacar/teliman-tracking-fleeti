// Rapport bus (demande de l'exploitation) : activité, vitesses, kilométrage, alertes,
// trajets et rappel de vidange. Les chiffres viennent de la télémétrie, jamais d'une
// estimation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_BUS_MAINTENANCE,
  buildBusItinerary,
  buildBusReport,
  maintenanceStatus,
  summariseBusTelemetry,
} from '../src/backend/busReport.js'

const DAY = '2026-10-15'

// Trajet Kani → Fadiadougou → Bongogo : points espacés d'environ 1 km.
const POINTS = [
  { lat: 8.4, lng: -6.6, speed: 0, time: `${DAY}T05:00:00Z` },
  { lat: 8.41, lng: -6.6, speed: 40, time: `${DAY}T05:14:00Z` },
  { lat: 8.42, lng: -6.6, speed: 62, time: `${DAY}T05:30:00Z` },
  { lat: 8.43, lng: -6.6, speed: 85, time: `${DAY}T06:10:00Z` },
  { lat: 8.44, lng: -6.6, speed: 20, time: `${DAY}T06:40:00Z` },
  { lat: 8.44, lng: -6.6, speed: 0, time: `${DAY}T18:20:00Z` },
]

const EVENTS = [
  { eventType: 'enter', geofenceName: 'Kani', createdAt: `${DAY}T05:12:00Z` },
  { eventType: 'enter', geofenceName: 'Fadyadougou, mine', createdAt: `${DAY}T05:48:00Z` },
  { eventType: 'enter', geofenceName: 'Bongogo', createdAt: `${DAY}T06:20:00Z` },
  { eventType: 'exit', geofenceName: 'Bongogo', createdAt: `${DAY}T10:02:00Z` },
  { eventType: 'enter', geofenceName: 'Fadyadougou, mine', createdAt: `${DAY}T10:25:00Z` },
]

const ALERTS = [
  { event: 'speedup', createdAt: `${DAY}T06:10:00Z`, speed: 85 },
  { event: 'speedup', createdAt: `${DAY}T07:05:00Z`, speed: 78 },
  { event: 'excessive_parking', createdAt: `${DAY}T11:00:00Z` },
]

const build = (overrides = {}) => buildBusReport({
  plate: '5273WWCI01',
  day: DAY,
  dateLabel: '15/10/2026',
  hourLabel: '19h',
  points: POINTS,
  events: EVENTS,
  alerts: ALERTS,
  odometerKm: null,
  ...overrides,
})

test('télémétrie : distances, vitesses, début et fin d’activité', () => {
  const summary = summariseBusTelemetry(POINTS)
  assert.equal(summary.points, 6)
  assert.ok(summary.distanceKm > 4 && summary.distanceKm < 6, `distance inattendue : ${summary.distanceKm}`)
  assert.equal(summary.maxSpeed, 85)
  assert.ok(summary.avgSpeed > 40 && summary.avgSpeed < 60, `moyenne inattendue : ${summary.avgSpeed}`)
  assert.equal(summary.startTime, `${DAY}T05:14:00Z`, 'le début est le premier point en mouvement')
  assert.equal(summary.endTime, `${DAY}T18:20:00Z`)
  assert.equal(Math.round(summary.amplitudeMinutes), 786)
})

test('télémétrie vide : aucune valeur inventée', () => {
  const summary = summariseBusTelemetry([])
  assert.equal(summary.points, 0)
  assert.equal(summary.distanceKm, null)
  assert.equal(summary.avgSpeed, null)
  assert.equal(summary.maxSpeed, null)
})

test('trajets : seules les entrées de zone, dans l’ordre, avec heures', () => {
  const itinerary = buildBusItinerary(EVENTS)
  assert.deepEqual(itinerary.map((step) => step.zone), ['Kani', 'Fadiadougou, mine', 'Bongogo', 'Fadiadougou, mine'])
  assert.equal(itinerary[0].time, '5h12')
})

test('vidange : seuils 4000 / 4800 / 5000 km selon le compteur', () => {
  assert.match(maintenanceStatus({}).text, /indisponible/)
  assert.match(maintenanceStatus({ kmSinceService: 3000 }).text, /rien à prévoir/)
  assert.match(maintenanceStatus({ odometerKm: 12000 }).text, /Référence de vidange non renseignée/)
  assert.match(maintenanceStatus({ odometerKm: 12000 }, { lastServiceOdometerKm: 9000 }).text, /rien à prévoir/, '3000 km : sous le seuil')
  assert.match(maintenanceStatus({ odometerKm: 13400 }, { lastServiceOdometerKm: 9000 }).text, /à programmer/, '4400 km : premier seuil')
  assert.equal(maintenanceStatus({ odometerKm: 13400 }, { lastServiceOdometerKm: 9000 }).level, 'warn')
  assert.match(maintenanceStatus({ odometerKm: 13900 }, { lastServiceOdometerKm: 9000 }).text, /Vidange à faire/)
  assert.match(maintenanceStatus({ odometerKm: 14500 }, { lastServiceOdometerKm: 9000 }).text, /Vidange dépassée/)
  assert.equal(maintenanceStatus({ odometerKm: 14500 }, { lastServiceOdometerKm: 9000 }).level, 'overdue')
})

test('vidange : distance cumulée du suivi (sans compteur véhicule)', () => {
  const cumul = maintenanceStatus({ kmSinceService: 4200 }, { lastServiceDate: '01/09/2026' })
  assert.match(cumul.text, /à programmer/)
  assert.match(cumul.text, /cumul des kilométrages du suivi depuis le 01\/09\/2026/)
  assert.equal(cumul.sinceServiceKm, 4200)
  assert.equal(maintenanceStatus({ kmSinceService: 5200 }).level, 'overdue')
  assert.equal(maintenanceStatus({ kmSinceService: 1200 }).level, 'ok')
  // Une distance cumulée absente ne doit pas être comptée comme zéro kilomètre.
  assert.match(maintenanceStatus({ kmSinceService: null, odometerKm: 13900 }, { lastServiceOdometerKm: 9000 }).text, /Vidange à faire/)
})

test('rapport complet : activité, trajets, alertes, entretien', () => {
  const { text, stats } = build({ mileageKm: 276.71 })
  assert.match(text, /^TELIMAN LOGISTIQUE - Rapport bus 5273WWCI01 du 15\/10\/2026 \(19h\)/)
  assert.ok(text.includes('ACTIVITÉ'), text)
  assert.ok(text.includes('Début : 5h14 · Fin : 18h20'), text)
  assert.ok(text.includes('Kilométrage : 276,71 km'), text)
  assert.ok(text.includes('vitesse maximale 85 km/h'), text)
  assert.ok(text.includes('TRAJETS ENREGISTRÉS'), text)
  assert.ok(text.includes('- 5h12 : Kani'), text)
  assert.ok(text.includes('Excès de vitesse : 2 signalé(s) par le suivi (pointe 85 km/h)'), text)
  assert.ok(text.includes('Accident : aucun signalement'), text)
  assert.ok(text.includes('ENTRETIEN'), text)
  assert.equal(stats.speedAlerts, 2)
  assert.equal(stats.crashAlerts, 0)
})

test('rapport sans données : le dit clairement', () => {
  const { text } = build({ points: [], events: [], alerts: [], odometerKm: 12345 })
  assert.ok(text.includes('Aucun point GPS reçu sur la journée.'), text)
  assert.ok(text.includes('Aucun passage de zone enregistré'), text)
  assert.ok(text.includes('Excès de vitesse : aucun'), text)
  assert.match(text, /Référence de vidange non renseignée — enregistrer la dernière vidange \(date et compteur : 12\s345 km\)/)
  assert.equal(DEFAULT_BUS_MAINTENANCE.intervalKm, 5000)
})

test('excès de vitesse détectés sur la télémétrie au-delà du seuil', () => {
  const rapide = [
    { lat: 8.4, lng: -6.6, speed: 60, time: `${DAY}T05:00:00Z` },
    { lat: 8.41, lng: -6.6, speed: 96, time: `${DAY}T05:10:00Z` },
    { lat: 8.42, lng: -6.6, speed: 112, time: `${DAY}T05:20:00Z` },
    { lat: 8.43, lng: -6.6, speed: 70, time: `${DAY}T05:30:00Z` },
  ]
  const { text, stats } = build({ points: rapide, events: [], alerts: [] })
  assert.ok(text.includes('Excès de vitesse : 2 au-dessus de 90 km/h (pointe 112 km/h)'), text)
  assert.ok(text.includes('à 5h20 : 112 km/h'), text)
  assert.equal(stats.speedAlerts, 2)
})

test('distance : les points à l’arrêt ne gonflent pas le kilométrage', () => {
  // Le bus reste garé : la gigue GPS ne doit pas produire de kilomètres.
  const parked = Array.from({ length: 40 }, (_, index) => ({
    lat: 8.4 + (index % 2) * 0.00002, lng: -6.6, speed: 0, time: `${DAY}T${String(10 + Math.floor(index / 6)).padStart(2, '0')}:0${index % 6}:00Z`,
  }))
  const summary = summariseBusTelemetry(parked)
  assert.ok(summary.distanceKm < 0.1, `distance à l'arrêt trop élevée : ${summary.distanceKm}`)
})

test('un accident signalé est remonté au rapport', () => {
  const { text, stats } = build({ alerts: [...ALERTS, { event: 'crash_alarm', createdAt: `${DAY}T12:00:00Z` }] })
  assert.ok(text.includes('Accident : 1 signalé(s) — vérifier l’état du véhicule'), text)
  assert.equal(stats.crashAlerts, 1)
})
