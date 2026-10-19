// Rapport bus (demande de l'exploitation) : activité, vitesses, kilométrage, alertes,
// trajets et rappel de vidange. Les chiffres viennent de la télémétrie, jamais d'une
// estimation.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_BUS_MAINTENANCE,
  buildBusItinerary,
  buildBusReport,
  groupSpeedBreaches,
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
  assert.ok(text.includes('Excès de vitesse : 1 épisode (2 relevés), pointe 112 km/h'), text)
  assert.ok(text.includes('de 5h10 à 5h20 : 2 relevés, pointe 112 km/h'), text)
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


test('épisodes d’excès : les relevés consécutifs forment un seul épisode', () => {
  const breaches = [
    { at: `${DAY}T17:58:22Z`, speed: 98, place: 'Séguéla - Boundiali, Frototou' },
    { at: `${DAY}T17:59:08Z`, speed: 101, place: 'Séguéla - Boundiali, Frototou' },
    { at: `${DAY}T18:00:07Z`, speed: 105, place: 'Séguéla - Boundiali, Frototou' },
  ]
  const episodes = groupSpeedBreaches(breaches)
  assert.equal(episodes.length, 1)
  assert.equal(episodes[0].count, 3)
  assert.equal(episodes[0].maxSpeed, 105, 'la pointe de l’épisode')
  assert.equal(episodes[0].from, '17h58')
  assert.equal(episodes[0].to, '18h00')
  assert.equal(episodes[0].place, 'Séguéla - Boundiali, Frototou')
})

test('épisodes : un point répété par le flux n’est compté qu’une fois', () => {
  const point = { at: `${DAY}T18:00:07Z`, speed: 105, place: 'Kani' }
  const episodes = groupSpeedBreaches([point, { ...point }])
  assert.equal(episodes.length, 1)
  assert.equal(episodes[0].count, 1)
})

test('épisodes : deux séquences séparées restent distinctes', () => {
  const episodes = groupSpeedBreaches([
    { at: `${DAY}T05:34:03Z`, speed: 94, place: 'Kani' },
    { at: `${DAY}T18:00:07Z`, speed: 105, place: 'Bouaké' },
  ])
  assert.equal(episodes.length, 2)
  assert.deepEqual(episodes.map((episode) => episode.place), ['Kani', 'Bouaké'])
})

test('rapport : épisodes lisibles avec leur endroit', () => {
  const { text, stats } = build({
    fuel: undefined,
    speedBreaches: [
      { at: `${DAY}T05:34:03Z`, speed: 94, place: 'Kani' },
      { at: `${DAY}T17:58:22Z`, speed: 98, place: 'Séguéla - Boundiali, Frototou' },
      { at: `${DAY}T17:59:08Z`, speed: 101, place: 'Séguéla - Boundiali, Frototou' },
      { at: `${DAY}T18:00:07Z`, speed: 105, place: 'Séguéla - Boundiali, Frototou' },
    ],
  })
  assert.ok(text.includes('2 épisodes (4 relevés), pointe 85 km/h'), text)
  assert.ok(text.includes('de 17h58 à 18h00 : 3 relevés, pointe 105 km/h — Séguéla - Boundiali, Frototou'), text)
  assert.ok(text.includes('5h34 : pointe 94 km/h — Kani'), text)
  assert.equal(stats.speedEpisodes.length, 2)
})

test('rapport : aucun endroit pour un excès sous le seuil', () => {
  const { text } = build({
    speedBreaches: [{ at: `${DAY}T12:00:00Z`, speed: 88, place: 'Kani' }],
    speedLimitKmh: 90,
  })
  assert.ok(text.includes('12h00 : pointe 88 km/h'), text)
  assert.ok(!text.includes('88 km/h — '), 'aucun lieu ne doit être affiché sous le seuil')
})
