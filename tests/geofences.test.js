import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGeofenceTracker, haversineDistanceMeters } from '../src/backend/geofenceEngine.js'
import { buildGeofenceAlertWhatsAppMessage, sendGeofenceAlertWhatsAppNotifications } from '../src/backend/whatsappNotifications.js'
import { alertRecipientSchema, geofenceSchema, geofenceUpdateSchema } from '../src/backend/validation.js'

const databaseSource = readFileSync(new URL('../src/backend/database.js', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const geofencesPageSource = readFileSync(new URL('../src/pages/GeofencesPage.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8')
const mapPageSource = readFileSync(new URL('../src/pages/MapPage.jsx', import.meta.url), 'utf8')

const ZONE_BOUAKE = { id: 3, name: 'Bouaké, Carrière', type: 'carriere', lat: 7.688449, lng: -5.148992, radiusMeters: 1500, active: true }

// ── Moteur de détection ──

test('haversineDistanceMeters approxime correctement les distances', () => {
  // 1 degré de latitude ≈ 111.19 km
  const d1 = haversineDistanceMeters(7.0, -5.0, 8.0, -5.0)
  assert.ok(Math.abs(d1 - 111195) < 500, `distance lat 1° = ${d1}`)
  // Distance nulle
  assert.equal(haversineDistanceMeters(7.688449, -5.148992, 7.688449, -5.148992), 0)
  // ~1.1 km de longitude à Bouaké : 111320 × cos(7.69°) × Δlng
  const d2 = haversineDistanceMeters(7.688449, -5.148992, 7.688449, -5.1390)
  assert.ok(d2 > 1050 && d2 < 1150, `distance 1 km lng = ${d2}`)
})

test('premier contact : prise d’état sans événement', () => {
  const tracker = createGeofenceTracker()
  const events = []
  // Position au centre de la zone
  const positions = [{ trackerId: 1, label: 'Camion A', lat: ZONE_BOUAKE.lat, lng: ZONE_BOUAKE.lng }]
  tracker(positions, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 0)
  assert.deepEqual(positions[0].geofenceIds, [3])
  assert.deepEqual(positions[0].geofenceNames, ['Bouaké, Carrière'])
})

test('détecte l’entrée puis la sortie de zone', () => {
  // Horloge simulée : la fenêtre anti-bruit (60 s) est dépassée entre les transitions
  let clock = 1_700_000_000_000
  const tracker = createGeofenceTracker({ minIntervalMs: 60000, now: () => clock })
  const events = []
  const outside = [{ trackerId: 1, label: 'Camion A', lat: 7.4, lng: -5.0 }]
  tracker(outside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 0)

  clock += 1000
  const inside = [{ trackerId: 1, label: 'Camion A', lat: ZONE_BOUAKE.lat, lng: ZONE_BOUAKE.lng }]
  tracker(inside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'enter')
  assert.equal(events[0].geofenceName, 'Bouaké, Carrière')

  clock += 61000
  const outsideAgain = [{ trackerId: 1, label: 'Camion A', lat: 7.4, lng: -5.0 }]
  tracker(outsideAgain, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 2)
  assert.equal(events[1].eventType, 'exit')
})

test('anti-bruit : pas de double événement avant la fenêtre minimale', () => {
  let clock = 1_700_000_000_000
  const tracker = createGeofenceTracker({ minIntervalMs: 60000, now: () => clock })
  const events = []
  const inside = [{ trackerId: 1, label: 'Camion A', lat: ZONE_BOUAKE.lat, lng: ZONE_BOUAKE.lng }]
  const outside = [{ trackerId: 1, label: 'Camion A', lat: 7.4, lng: -5.0 }]

  tracker(outside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  clock += 1000
  tracker(inside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 1) // entrée

  clock += 1000 // seulement 1 s plus tard
  tracker(outside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 1, 'sortie ignorée (fenêtre anti-bruit)')

  clock += 70000 // 71 s après l’entrée
  tracker(outside, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 2, 'sortie détectée après la fenêtre')
  assert.equal(events[1].eventType, 'exit')
})

test('zones inactives ou positions invalides ignorées', () => {
  const tracker = createGeofenceTracker()
  const events = []
  const positions = [{ trackerId: 1, label: 'Camion A', lat: 7.4, lng: -5.0 }]
  tracker(positions, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  const invalid = [{ trackerId: 1, label: 'Camion A', lat: null, lng: -5.0 }]
  tracker(invalid, { activeGeofences: [ZONE_BOUAKE], onEvent: (event) => events.push(event) })
  assert.equal(events.length, 0)
})

// ── Message WhatsApp géofence ──

test('buildGeofenceAlertWhatsAppMessage contient zone, action et camion', () => {
  const message = buildGeofenceAlertWhatsAppMessage({
    eventType: 'enter',
    geofenceName: 'Korhogo, client',
    truckLabel: 'CI-1234 AB',
    lat: 9.411007,
    lng: -5.626558,
  })
  assert.match(message, /ALERTE GÉOFENCE/)
  assert.match(message, /ENTRÉE en zone: Korhogo, client/)
  assert.match(message, /Véhicule: CI-1234 AB/)
  assert.match(message, /Carte: https:\/\/maps\.google\.com\/\?q=/)
  const exitMessage = buildGeofenceAlertWhatsAppMessage({ eventType: 'exit', geofenceName: 'Abidjan, carrière' })
  assert.match(exitMessage, /SORTIE de zone: Abidjan, carrière/)
})

test('sendGeofenceAlertWhatsAppNotifications envoie aux destinataires actifs', async () => {
  const sent = []
  const results = await sendGeofenceAlertWhatsAppNotifications({
    event: { eventType: 'enter', geofenceName: 'Fadyadougou, mine', truckLabel: 'CI-5678 CD' },
    recipients: ['+2250700112233', '07 08 99 88 77'],
    config: { enabled: true, provider: 'baileys' },
    baileysClient: {
      sendText: async (to, message) => {
        sent.push(to)
        return { sent: true, messageId: `MSG-${to}` }
      },
    },
  })
  assert.equal(results.length, 2)
  assert.ok(results.every((result) => result.sent))
  assert.deepEqual(sent, ['2250700112233', '2250708998877'])
})

test('sendGeofenceAlertWhatsAppNotifications signale l’absence de destinataires', async () => {
  const results = await sendGeofenceAlertWhatsAppNotifications({
    event: { eventType: 'exit', geofenceName: 'Bouaké, ville' },
    recipients: [],
  })
  assert.equal(results.length, 1)
  assert.equal(results[0].skipped, true)
  assert.match(results[0].reason, /Aucun numéro/)
})

// ── Schémas Zod ──

test('geofenceSchema accepte un payload valide', () => {
  const parsed = geofenceSchema.safeParse({
    name: 'Korhogo, client',
    type: 'client',
    lat: 9.411007,
    lng: -5.626558,
    radiusMeters: 1200,
    color: '#946239',
    active: true,
  })
  assert.equal(parsed.success, true)
})

test('geofenceSchema rejette latitude et rayon invalides', () => {
  assert.equal(geofenceSchema.safeParse({ name: 'X', type: 'client', lat: 120, lng: -5, radiusMeters: 1000 }).success, false)
  assert.equal(geofenceSchema.safeParse({ name: 'X', type: 'client', lat: 7, lng: -5, radiusMeters: 10 }).success, false)
  assert.equal(geofenceSchema.safeParse({ name: 'X', type: 'inconnu', lat: 7, lng: -5, radiusMeters: 1000 }).success, false)
})

test('geofenceUpdateSchema partiel ne remplit pas les champs absents', () => {
  const parsed = geofenceUpdateSchema.safeParse({ radiusMeters: 2500 })
  assert.equal(parsed.success, true)
  assert.deepEqual(Object.keys(parsed.data), ['radiusMeters'])
})

test('alertRecipientSchema valide numéro et rejette un mauvais numéro', () => {
  assert.equal(alertRecipientSchema.safeParse({ name: 'Responsable', phone: '+2250700112233' }).success, true)
  assert.equal(alertRecipientSchema.safeParse({ name: 'Responsable', phone: 'abc' }).success, false)
})

// ── Intégration source ──

test('la base contient les tables géofences, destinataires et événements', () => {
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS geofences/)
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS alert_recipients/)
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS geofence_events/)
})

test('server.js expose les routes CRUD et le moteur', () => {
  assert.match(serverSource, /app\.get\('\/api\/geofences'/)
  assert.match(serverSource, /app\.post\('\/api\/geofences'/)
  assert.match(serverSource, /app\.put\('\/api\/geofences\/:id'/)
  assert.match(serverSource, /app\.delete\('\/api\/geofences\/:id'/)
  assert.match(serverSource, /app\.get\('\/api\/alert-recipients'/)
  assert.match(serverSource, /app\.post\('\/api\/alert-recipients'/)
  assert.match(serverSource, /app\.get\('\/api\/geofence-events'/)
  assert.match(serverSource, /evaluateGeofenceTransitions\(positions\)/)
})

test('les origines locales HTTP sont whitelistées CORS (modules ES + MacBook Tailscale)', () => {
  assert.match(serverSource, /'http:\/\/127\.0\.0\.1:8787'/)
  assert.match(serverSource, /'http:\/\/localhost:8787'/)
  assert.match(serverSource, /'http:\/\/home-server-1:8787'/)
  assert.match(serverSource, /'http:\/\/100\.67\.148\.58:8787'/)
})

test('la page Géofences couvre carte, formulaire, numéros et événements', () => {
  assert.match(geofencesPageSource, /Géofences & Alertes/)
  assert.match(geofencesPageSource, /MapContainer/)
  assert.match(geofencesPageSource, /radiusMeters/)
  assert.match(geofencesPageSource, /Numéros qui reçoivent les alertes/)
  assert.match(geofencesPageSource, /loadAlertRecipients/)
  assert.match(geofencesPageSource, /Derniers événements de zone/)
})

test('le point central d’une géofence est déplaçable à la souris', () => {
  assert.match(geofencesPageSource, /<Marker/)
  assert.match(geofencesPageSource, /draggable/)
  assert.match(geofencesPageSource, /dragstart: \(\) => onDragStart\(zone\)/)
  assert.match(geofencesPageSource, /dragend: \(event\) => onDragEnd\(zone, event\.target\.getLatLng\(\)\)/)
  assert.match(geofencesPageSource, /handleDragEnd/)
  assert.match(geofencesPageSource, /dragDraft/)
  assert.match(geofencesPageSource, /glissez le point central pour la déplacer/)
  assert.match(geofencesPageSource, /updateGeofence\(zone\.id, \{ lat, lng \}\)/)
})

test('le clic sur une zone charge son objet complet dans le formulaire', () => {
  const mapSection = geofencesPageSource.slice(geofencesPageSource.indexOf('function GeofenceMap'))
  assert.match(mapSection, /click: \(\) => onSelect\(zone\)/)
  assert.doesNotMatch(mapSection, /onSelect\(zone\.id\)/)
})

test('le routeur et la sidebar exposent la page Géofences', () => {
  assert.match(appSource, /path="\/geofences"/)
  assert.match(appSource, /GeofencesPage/)
  assert.match(layoutSource, /id: '\/geofences'/)
  assert.match(layoutSource, /Géofences & Alertes/)
})

test('la Live Map affiche les cercles de géofence', () => {
  assert.match(mapPageSource, /loadGeofences/)
  assert.match(mapPageSource, /geofences\.filter\(\(zone\) => zone\.active\)/)
  assert.match(mapPageSource, /<Circle/)
  assert.match(mapPageSource, /liveGeofenceNames/)
})
