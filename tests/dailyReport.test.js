// Rapport journalier TLM : structure demandée par la direction de Teliman Logistique
// (document « TRACKING RAPPORT ») — suivi général, camions actifs (avec position et
// temps), camions inactifs, quantités par client.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  buildDailyReport,
  buildWeeklyReport,
  formatQuantity,
  parseQuantity,
} from '../src/backend/dailyReport.js'
import { OFFICIAL_TRUCKS, driverFor, loadTruckRegistry, plateFor } from '../src/backend/truckRegistry.js'

const DAY = '2026-10-13'

const ORDERS = [
  {
    id: 1,
    trackerId: 3487539,
    truckLabel: '39151WWCI01',
    driver: 'SARIA YACOUBA',
    reference: '31011328363',
    client: 'LAFARGE',
    loadingPoint: 'BOUAKE',
    destination: 'KORHOGO',
    goods: 'CIMENT CPJ 42,5',
    quantity: '40,000',
    status: 'Livré',
    date: `${DAY}T08:00:00.000Z`,
    departureDateTime: `${DAY}T11:44:00.000Z`,
    completedAt: `${DAY}T13:57:00.000Z`,
  },
  {
    id: 2,
    trackerId: 3487539,
    truckLabel: '39151WWCI01',
    client: 'LAFARGE',
    loadingPoint: 'BOUAKE',
    destination: 'KORHOGO',
    goods: 'CIMENT CPJ 42,5',
    quantity: '40,000',
    status: 'En cours',
    date: `${DAY}T09:00:00.000Z`,
    departureDateTime: `${DAY}T12:05:00.000Z`,
  },
  {
    id: 3,
    trackerId: 999,
    truckLabel: '3952WWCI01',
    client: 'K1',
    loadingPoint: 'BOUAKE',
    destination: 'KORHOGO',
    goods: 'CIMENT CPA 52,5',
    quantity: '52,940',
    status: 'Livré',
    date: `${DAY}T07:00:00.000Z`,
    departureDateTime: `${DAY}T07:30:00.000Z`,
    completedAt: `${DAY}T09:00:00.000Z`,
  },
  {
    id: 4,
    trackerId: 999,
    truckLabel: '3952WWCI01',
    client: 'K1',
    quantity: '',
    status: 'Validé',
    date: `${DAY}T06:00:00.000Z`,
  },
]

const EVENTS = [
  { trackerId: 3487539, truckLabel: '39151WWCI01', eventType: 'exit', geofenceName: 'Bouaké', createdAt: `${DAY}T15:07:00.000Z` },
  { trackerId: 111, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Bouaké', createdAt: `${DAY}T10:08:00.000Z` },
  { trackerId: 111, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Korhogo, client', createdAt: `${DAY}T14:00:00.000Z` },
  { trackerId: 111, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Fadyadougou, mine', createdAt: `${DAY}T16:00:00.000Z` },
  { trackerId: 111, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Abidjan, carrière', createdAt: `${DAY}T17:00:00.000Z` },
  { trackerId: 111, truckLabel: '3216WWCI01', eventType: 'enter', geofenceName: 'Bouaké', createdAt: `2026-10-12T10:00:00.000Z` },
]

const FLEET_ROWS = [
  { trackerId: 3487539, truckLabel: '39151WWCI01', distanceKm: 153.4, drivingSeconds: 4 * 3600 + 1 * 60, restSeconds: 14 * 3600 + 40 * 60 },
  { trackerId: 111, truckLabel: '3216WWCI01', distanceKm: 0, drivingSeconds: 0, restSeconds: 0 },
]

const ALERTS = [
  { trackerId: 3487539, truckLabel: '39151WWCI01', event: 'excessive_parking', createdAt: `${DAY}T11:00:00.000Z` },
  { trackerId: 3487539, truckLabel: '39151WWCI01', event: 'speedup', createdAt: `${DAY}T12:30:00.000Z` },
  { trackerId: 500, truckLabel: '3100WWC101', event: 'excessive_parking', createdAt: `${DAY}T18:00:00.000Z` },
  { trackerId: 3487539, truckLabel: '39151WWCI01', event: 'geofence_exit', createdAt: `${DAY}T15:07:00.000Z` },
]

const POSITIONS = [
  { trackerId: 3487539, truckLabel: '39151WWCI01', address: 'Korhogo, Savanes' },
]

const build = (overrides = {}) => buildDailyReport({
  day: DAY,
  dateLabel: '13/10/2026',
  hourLabel: '20h',
  orders: ORDERS,
  events: EVENTS,
  fleetRows: FLEET_ROWS,
  vouchers: [],
  alerts: ALERTS,
  trucks: [{ id: 3487539 }, { id: 111 }],
  positions: POSITIONS,
  ...overrides,
})

test('en-tête et suivi général conformes au modèle de la direction', () => {
  const { text } = build()
  assert.match(text, /^TELIMAN LOGISTIQUE - Rapport journalier du 13\/10\/2026 \(20h\)/)
  assert.match(text, /SUIVI GÉNÉRAL/)
  assert.ok(text.includes('Camions actifs : 3 / 4 · Missions : 4'), text.slice(0, 400))
  assert.ok(text.includes('Zone Korhogo : 1 entrée'), text)
  assert.ok(text.includes('Zone Fadiadougou : 1 entrée'), text)
  assert.ok(text.includes('Zone Bouaké : 1 entrée'), text)
  assert.ok(text.includes('Autres zones : 1'), 'la zone d’Abidjan reste comptée')
})

test('les immatriculations officielles et les chauffeurs de la direction sont affichés', () => {
  const { text } = build()
  assert.ok(text.includes('AB246JJ - Yacouba SARIA'), text)
  assert.ok(text.includes('AB229JJ - Tahirou KONE'), text)
  assert.ok(text.includes('602605WWCI01 - Lamine BAMBA'), text)
  assert.ok(!text.includes('39151WWCI01 -'), 'l’ancienne immatriculation n’apparaît plus en tête de bloc')
})

test('camion actif : missions regroupées, heures, position, distance, conduite, repos', () => {
  const { text } = build()
  assert.ok(text.includes('LAFARGE : Bouaké → Korhogo — 2 missions (ciment cpj 42,5)'), text)
  assert.ok(text.includes('départ 11h44 · 1/2 livrée'), text)
  assert.ok(text.includes('Position : Korhogo, Savanes'), text)
  assert.ok(!/Zones :/.test(text), 'plus de ligne Zones dans le message')
  assert.ok(!/Incidents :/.test(text), 'plus de ligne Incidents dans le message')
  assert.ok(text.includes('Position : Korhogo'), text)
  assert.ok(text.includes('153 km · conduite 4h01 · repos 14h40'), text)
  assert.ok(!text.includes('Incidents :'), text)
})

test('le PDF conserve zones et incidents, le message ne les affiche plus', () => {
  const { text, sections } = build()
  assert.ok(!/Zones :|Incidents :/.test(text), 'message sans lignes Zones / Incidents')
  const actif = sections.actives.find((camion) => camion.plate === 'AB246JJ')
  assert.ok(actif.zones.length > 0, 'les passages de zone restent dans le PDF')
  assert.ok(actif.incidents.length > 0, 'les incidents restent dans le PDF')
  assert.match(actif.zones[0].text, /Bouaké/)
})

test('camion sans mission : annoncé inactif avec stationnement prolongé', () => {
  const { text } = build()
  assert.ok(text.includes('CAMIONS INACTIFS'), text)
  assert.ok(text.includes('602607WWCI01 - Siriki Drabo : pas de mission — stationnement prolongé'), text)
})

test('position indisponible annoncée explicitement, jamais inventée', () => {
  const { text } = build({ positions: [] })
  assert.ok(text.includes('Position : indisponible'), text)
})

test('quantités par client : chargée, livrée, en cours', () => {
  const { text, stats } = build()
  assert.ok(text.includes('QUANTITÉS LIVRÉES OU CHARGÉES PAR CLIENT'), text)
  assert.ok(text.includes('- LAFARGE (2 missions) : chargée 80 · livrée 40 · en cours 40'), text)
  assert.ok(text.includes('- K1 (2 missions) : chargée 52,94 · livrée 52,94 · en cours 0'), text)
  assert.equal(stats.clients.length, 2)
  assert.equal(stats.clients.find((row) => row.client === 'K1').charged, 52.94)
})

test('aucune mission : le rapport le dit au lieu d’afficher du vide', () => {
  const { text } = build({ orders: [], events: [], fleetRows: [], alerts: [], positions: [] })
  assert.ok(text.includes('Missions : 0'), text)
  assert.ok(text.includes('Aucun : tous les camions ont eu de l’activité'), text)
  assert.ok(text.includes('Aucune mission enregistrée aujourd’hui'), text)
})

test("une alerte sans camion identifiable n'est pas affichée comme un camion", () => {
  const { text, stats } = build({ alerts: [{ event: 'excessive_parking', createdAt: DAY + 'T09:00:00.000Z' }] })
  assert.equal(stats.unattributedAlerts, 1)
  assert.ok(!/^- stationnement prolongé/m.test(text), 'aucun bloc sans immatriculation')
})

test('un véhicule exclu (bus) disparaît du rapport et de tous les compteurs', () => {
  // Le bus partage les mêmes données que les camions : rien de lui ne doit subsister.
  const bus = {
    id: 77, trackerId: 5273, truckLabel: '5273WWCI01', client: 'LAFARGE', loadingPoint: 'BOUAKE',
    destination: 'KORHOGO', goods: 'CIMENT', quantity: '40,000', status: 'Livré',
    date: `${DAY}T07:00:00.000Z`, departureDateTime: `${DAY}T07:30:00.000Z`, completedAt: `${DAY}T09:00:00.000Z`,
  }
  const withBus = {
    orders: [...ORDERS, bus],
    events: [...EVENTS, { trackerId: 5273, truckLabel: '5273WWCI01', eventType: 'enter', geofenceName: 'Bouaké', createdAt: `${DAY}T08:00:00.000Z` }],
    alerts: [...ALERTS, { trackerId: 5273, truckLabel: '5273WWCI01', event: 'excessive_parking', createdAt: `${DAY}T08:10:00.000Z` }],
    fleetRows: [...FLEET_ROWS, { trackerId: 5273, truckLabel: '5273WWCI01', distanceKm: 90, drivingSeconds: 3600, restSeconds: 7200 }],
    positions: [...POSITIONS, { trackerId: 5273, truckLabel: '5273WWCI01', address: 'Bouaké' }],
    trucks: [{ id: 3487539 }, { id: 111 }, { id: 5273 }],
  }
  const avant = build(withBus)
  assert.ok(avant.text.includes('5273WWCI01'), 'sans exclusion, le bus apparaît')
  assert.ok(avant.stats.zoneCounters.find((row) => row.label === 'Zone Bouaké').count === 2)

  const apres = build({ ...withBus, excludedTrucks: ['5273WWCI01'] })
  assert.ok(!apres.text.includes('5273WWCI01'), 'exclu : plus aucune trace dans le message')
  assert.ok(!apres.sections.actives.some((camion) => camion.plate === '5273WWCI01'))
  assert.ok(!apres.sections.inactives.some((camion) => camion.plate === '5273WWCI01'))
  assert.equal(apres.stats.zoneCounters.find((row) => row.label === 'Zone Bouaké').count, 1, 'ses entrées de zone ne comptent plus')
  assert.equal(apres.stats.missions, avant.stats.missions - 1, 'sa mission ne compte plus')
  assert.ok(apres.text.includes('Camions actifs : 3 / 4'), 'la taille de flotte exclut le bus')
  assert.equal(apres.stats.excludedTrucks, 1)
  // Les camions normaux restent intacts.
  assert.ok(apres.text.includes('AB246JJ - Yacouba SARIA'), apres.text)
})

test('les jours précédents ne polluent pas le rapport du jour', () => {
  const { stats } = build()
  assert.equal(stats.zoneEntries, 4, 'seules les entrées du jour sont comptées')
  assert.equal(stats.zoneCounters.find((row) => row.label === 'Zone Bouaké').count, 1, 'l’entrée du 12/10 ne compte pas')
  assert.equal(stats.missions, 4)
})

test('message borné : les camions en trop sont résumés', () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    trackerId: 900 + index,
    truckLabel: `99${index}WWCI01`,
    client: 'LAFARGE',
    loadingPoint: 'BOUAKE',
    destination: 'KORHOGO',
    goods: 'CIMENT',
    quantity: '40,000',
    status: 'Livré',
    date: `${DAY}T08:00:00.000Z`,
    departureDateTime: `${DAY}T08:30:00.000Z`,
    completedAt: `${DAY}T10:00:00.000Z`,
  }))
  const { text, stats } = build({ orders: many, events: [], fleetRows: [], alerts: [], positions: [], maxChars: 700 })
  assert.ok(text.length <= 900, `message trop long : ${text.length}`)
  assert.ok(stats.truncatedTrucks > 0, 'des camions sont résumés')
  assert.match(text, /… et \d+ autre(s)? camions? actifs? \(détail dans la plateforme\)/)
})

test('bilan hebdomadaire : agrégats par camion et quantités de la semaine', () => {
  const { text, stats } = buildWeeklyReport({
    dayFrom: '2026-10-07',
    dayTo: DAY,
    dateLabel: 'du 07/10/2026 au 13/10/2026',
    orders: ORDERS,
    events: EVENTS,
    fleetRows: FLEET_ROWS,
    vouchers: [],
    alerts: ALERTS,
  })
  assert.match(text, /^TELIMAN LOGISTIQUE - Bilan hebdomadaire du 07\/10\/2026 au 13\/10\/2026/)
  assert.ok(text.includes('Missions de la semaine : 4'), text)
  assert.ok(text.includes('AB246JJ - Yacouba SARIA : 2 missions'), text)
  assert.equal(stats.missions, 4)
})

test('parc officiel : correspondance des plaques et des chauffeurs', () => {
  assert.equal(plateFor('39151WWCI01'), 'AB246JJ')
  assert.equal(driverFor('39151WWCI01'), 'Yacouba SARIA')
  assert.equal(plateFor('3100WWC101'), '602607WWCI01', 'coquille WWC101 corrigée')
  assert.equal(plateFor('AB246JJ'), 'AB246JJ', 'une plaque déjà renommée reste stable')
  assert.equal(plateFor('INCONNU'), 'INCONNU', 'un camion hors parc garde son étiquette')
  assert.equal(OFFICIAL_TRUCKS.length, 7)
})

test('parc officiel : fichier de correspondance créé puis relu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'truck-registry-'))
  const created = loadTruckRegistry(dir)
  assert.equal(created.length, 7)
  const reloaded = loadTruckRegistry(dir)
  assert.deepEqual(reloaded.map((row) => row.plate), OFFICIAL_TRUCKS.map((row) => row.plate))
  rmSync(dir, { recursive: true, force: true })
})

test('nombres français : lecture et écriture', () => {
  assert.equal(parseQuantity('52,940'), 52.94)
  assert.equal(parseQuantity('40,000'), 40)
  assert.equal(parseQuantity(''), null)
  assert.equal(parseQuantity('quarante'), null)
  assert.equal(formatQuantity(52.94), '52,94')
  assert.equal(formatQuantity(1000), '1 000')
  assert.equal(formatQuantity(null), '—')
})


test('excès de vitesse : épisode localisé, uniquement au-delà de 90 km/h', () => {
  const alerts = [
    {
      trackerId: 3487539,
      truckLabel: '39151WWCI01',
      event: 'speedup',
      message: '39151WWCI01: Excès de vitesse (par vitesse matériel) - 96 km/h',
      address: 'Autoroute Yamoussoukro-Bouaké, Kpoti Tatikro, Gbêkê, Vallée du Bandama',
      createdAt: `${DAY}T12:28:00.000Z`,
    },
    {
      trackerId: 3487539,
      truckLabel: '39151WWCI01',
      event: 'speedup',
      message: '39151WWCI01: Excès de vitesse (par vitesse matériel) - 104 km/h',
      address: 'Autoroute Yamoussoukro-Bouaké, Kpoti Tatikro, Gbêkê, Vallée du Bandama',
      createdAt: `${DAY}T12:31:00.000Z`,
    },
    {
      trackerId: 3487539,
      truckLabel: '39151WWCI01',
      event: 'speedup',
      message: '39151WWCI01: Excès de vitesse (par vitesse matériel) - 85 km/h',
      address: 'Korhogo, Savanes',
      createdAt: `${DAY}T16:00:00.000Z`,
    },
  ]
  const { text, sections } = build({ alerts })
  assert.ok(text.includes('EXCÈS DE VITESSE (plus de 90 km/h)'), text)
  assert.ok(text.includes('AB246JJ : de 12h28 à 12h31 : 2 relevés, pointe 104 km/h — Autoroute Yamoussoukro-Bouaké, Kpoti Tatikro'), text)
  assert.ok(!text.includes('85 km/h — '), 'un excès à 85 km/h ne doit pas afficher de lieu ni de ligne')
  const episodes = sections.speedEpisodes || []
  assert.equal(episodes.length, 1, 'seul l’excès au-delà de 90 km/h est retenu')
  assert.equal(episodes[0].maxSpeed, 104)
  assert.ok(episodes[0].place.startsWith('Autoroute Yamoussoukro-Bouaké'))
})

test('aucun excès au-delà du seuil : pas de section dédiée', () => {
  const { text } = build({ alerts: [{ trackerId: 3487539, truckLabel: '39151WWCI01', event: 'speedup', message: 'Excès de vitesse - 82 km/h', createdAt: `${DAY}T09:00:00.000Z` }] })
  assert.ok(!text.includes('EXCÈS DE VITESSE'), 'rien à signaler : la section est omise')
})
