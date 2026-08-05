import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDirectionArrows,
  clusterTrackers,
  detectStops,
  formatDurationMs,
  formatPositionAge,
  haversineDistanceMeters,
  parsePointTime,
} from '../src/lib/mapUtils.js'

test('formatPositionAge rend un âge humain', () => {
  const now = 1_800_000_000_000
  assert.equal(formatPositionAge(null, now), 'inconnu')
  assert.equal(formatPositionAge(undefined, now), 'inconnu')
  assert.equal(formatPositionAge(now - 5_000, now), 'à l’instant')
  assert.equal(formatPositionAge(now - 30_000, now), 'il y a 30 s')
  assert.equal(formatPositionAge(now - 5 * 60_000, now), 'il y a 5 min')
  assert.equal(formatPositionAge(now - 2 * 3_600_000, now), 'il y a 2 h')
  assert.equal(formatPositionAge(now - 3 * 86_400_000, now), 'il y a 3 j')
  assert.equal(formatPositionAge(now + 10_000, now), 'à l’instant') // horloge décalée : pas de négatif
})

test('haversineDistanceMeters approxime les distances', () => {
  // 1° de latitude ≈ 111.19 km
  const dLat = haversineDistanceMeters(7.0, -5.0, 8.0, -5.0)
  assert.ok(Math.abs(dLat - 111_194) < 2_000, `dLat=${dLat}`)
  // 0.01° de longitude à la latitude de Bouaké (7.69) ≈ 1 102 m
  const dLng = haversineDistanceMeters(7.688449, -5.148992, 7.688449, -5.138992)
  assert.ok(dLng > 1050 && dLng < 1150, `dLng=${dLng}`)
  // Même point → 0
  assert.equal(haversineDistanceMeters(7.5, -5.5, 7.5, -5.5), 0)
})

test('parsePointTime accepte secondes, millisecondes et ISO', () => {
  assert.equal(parsePointTime({ time: 1_700_000_000 }), 1_700_000_000_000)
  assert.equal(parsePointTime({ time: 1_700_000_000_000 }), 1_700_000_000_000)
  assert.equal(parsePointTime({ timestamp: '2026-08-05T10:00:00Z' }), new Date('2026-08-05T10:00:00Z').getTime())
  assert.equal(parsePointTime({}), null)
  assert.equal(parsePointTime(null), null)
})

function buildPoints(specs) {
  // specs: [lat, lng, speed, timeMs] — timeMs relatif
  let t = 1_700_000_000_000
  return specs.map(([lat, lng, speed, deltaMs]) => {
    t += deltaMs
    return { lat, lng, speed, time: t }
  })
}

test('detectStops trouve les arrêts ≥ 5 min et ignore les courts', () => {
  const points = buildPoints([
    [7.5, -5.5, 40, 60_000],
    [7.501, -5.501, 40, 60_000],
    [7.502, -5.502, 0, 60_000],   // arrêt : 6 min immobile
    [7.502, -5.502, 0, 60_000],
    [7.502, -5.502, 0, 60_000],
    [7.502, -5.502, 0, 60_000],
    [7.502, -5.502, 0, 60_000],
    [7.502, -5.502, 0, 60_000],
    [7.503, -5.503, 50, 60_000],  // reprise
    [7.504, -5.504, 50, 60_000],
  ])
  const stops = detectStops(points)
  assert.equal(stops.length, 1)
  assert.ok(stops[0].durationMs >= 5 * 60_000, `durée=${stops[0].durationMs}`)
  assert.ok(Math.abs(stops[0].lat - 7.502) < 0.001)
})

test('detectStops ignore un arrêt trop court', () => {
  const points = buildPoints([
    [7.5, -5.5, 40, 60_000],
    [7.501, -5.501, 0, 30_000],   // 1 min immobile seulement
    [7.501, -5.501, 0, 30_000],
    [7.502, -5.502, 40, 60_000],
  ])
  assert.equal(detectStops(points).length, 0)
})

test('detectStops gère les points sans horodatage (durée inconnue = arrêt retenu)', () => {
  const points = [
    { lat: 7.5, lng: -5.5, speed: 40 },
    { lat: 7.501, lng: -5.501, speed: 0 },
    { lat: 7.501, lng: -5.501, speed: 0 },
    { lat: 7.501, lng: -5.501, speed: 0 },
    { lat: 7.502, lng: -5.502, speed: 50 },
  ]
  const stops = detectStops(points)
  assert.equal(stops.length, 1)
  assert.equal(stops[0].durationMs, null)
})

test('clusterTrackers ne regroupe pas en dessous du seuil', () => {
  const trackers = [
    { id: 1, state: { gps: { location: { lat: 7.5, lng: -5.5 } } } },
    { id: 2, state: { gps: { location: { lat: 7.6, lng: -5.4 } } } },
  ]
  const result = clusterTrackers(trackers, 7, 25)
  assert.equal(result.clusters.length, 0)
  assert.equal(result.singles.length, 2)
})

test('clusterTrackers regroupe les camions proches au-dessus du seuil', () => {
  const trackers = []
  for (let index = 0; index < 30; index += 1) {
    trackers.push({ id: index, state: { gps: { location: { lat: 7.5 + index * 0.01, lng: -5.5 } } } })
  }
  trackers.push({ id: 99, state: { gps: { location: { lat: 9.4, lng: -5.6 } } } }) // isolé
  const result = clusterTrackers(trackers, 7, 25)
  assert.ok(result.clusters.length >= 1, `clusters=${result.clusters.length}`)
  assert.ok(result.clusters[0].count >= 2)
  assert.ok(result.singles.some((t) => t.id === 99), 'le camion isolé reste seul')
})

test('clusterTrackers ignore les trackers sans position', () => {
  const trackers = [
    { id: 1, state: { gps: { location: { lat: 7.5, lng: -5.5 } } } },
    { id: 2, state: {} },
    { id: 3 },
  ]
  const result = clusterTrackers(trackers, 7, 2)
  assert.equal(result.singles.length, 1)
  assert.equal(result.singles[0].id, 1)
})

test('buildDirectionArrows produit des flèches orientées', () => {
  assert.deepEqual(buildDirectionArrows([]), [])
  assert.deepEqual(buildDirectionArrows([{ lat: 7, lng: -5 }]), [])
  const arrows = buildDirectionArrows([
    { lat: 7.5, lng: -5.5 },
    { lat: 7.5, lng: -5.4 }, // vers l'est → bearing ~90°
  ])
  assert.equal(arrows.length, 1)
  assert.ok(arrows[0].bearing > 80 && arrows[0].bearing < 100, `bearing=${arrows[0].bearing}`)
  assert.ok(Math.abs(arrows[0].lat - 7.5) < 1e-6)
})

test('formatDurationMs rend des durées lisibles', () => {
  assert.equal(formatDurationMs(null), '—')
  assert.equal(formatDurationMs(0), '—')
  assert.equal(formatDurationMs(45 * 60_000), '45 min')
  assert.equal(formatDurationMs(90 * 60_000), '1 h 30 min')
  assert.equal(formatDurationMs(120 * 60_000), '2 h')
})
