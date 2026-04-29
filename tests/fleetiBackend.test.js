import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTrackBundleFromTelemetryCache,
  chunkIds,
  fetchAllPublicAssets,
  isCameraLike,
  normalizeTrackEvent,
  normalizeTrackPoint,
  resolveScopedTrackerIds,
  resolveTracksSource,
} from '../src/backend/fleetiBackend.js'

test('resolveTracksSource utilise l’API publique pour les trajets par défaut', () => {
  assert.equal(resolveTracksSource(), 'public')
  assert.equal(resolveTracksSource(''), 'public')
  assert.equal(resolveTracksSource('private'), 'private')
  assert.equal(resolveTracksSource('public-cache'), 'public')
})

test('fetchAllPublicAssets pagine Asset/Search avec Skip/Take jusqu’à la dernière page', async () => {
  const calls = []
  const pages = [
    { results: [{ id: 1 }, { id: 2 }] },
    { results: [{ id: 3 }, { id: 4 }] },
    { results: [{ id: 5 }] },
  ]

  const rows = await fetchAllPublicAssets({
    take: 2,
    publicApiGet: async (path, query) => {
      calls.push({ path, query })
      return pages[query.Skip / query.Take]
    },
  })

  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5])
  assert.deepEqual(calls, [
    { path: '/Asset/Search', query: { Take: 2, Skip: 0 } },
    { path: '/Asset/Search', query: { Take: 2, Skip: 2 } },
    { path: '/Asset/Search', query: { Take: 2, Skip: 4 } },
  ])
})

test('resolveScopedTrackerIds ne limite pas la flotte quand FLEETI_TRACKER_IDS est vide', () => {
  assert.deepEqual(resolveScopedTrackerIds([11, 22, 33], []), [11, 22, 33])
})

test('resolveScopedTrackerIds garde seulement les ids configurés quand ils existent', () => {
  assert.deepEqual(resolveScopedTrackerIds([11, 22, 33], [22, 99]), [22])
})

test('chunkIds découpe les gros appels Fleeti par paquets stables', () => {
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('isCameraLike détecte les trackers caméra pour ne pas les mélanger aux camions', () => {
  assert.equal(isCameraLike({ label: '5273WWCI01-CAM' }), true)
  assert.equal(isCameraLike({ label: '3100WWCI01_CAM' }), true)
  assert.equal(isCameraLike({ label: '4400WWCI01' }), false)
})

test('normalizeTrackPoint accepte les variantes latitude/longitude Fleeti', () => {
  assert.deepEqual(normalizeTrackPoint({ latitude: '5.1', longitude: '-4.2', speed: '63', heading: '90', time: '2026-04-28T10:00:00Z' }), {
    lat: 5.1,
    lng: -4.2,
    speed: 63,
    heading: 90,
    time: '2026-04-28T10:00:00Z',
  })
  assert.deepEqual(normalizeTrackPoint({ position: { location: { latitude: 7, longitude: -5 } }, updatedAt: '2026-04-28T11:00:00Z' }), {
    lat: 7,
    lng: -5,
    speed: 0,
    heading: 0,
    time: '2026-04-28T11:00:00Z',
  })
})

test('normalizeTrackEvent conserve les alertes géolocalisées Fleeti', () => {
  const event = normalizeTrackEvent({ tracker_id: 3580652, event: 'speedup', location: { lat: 8.5, lng: -6.6 }, speed: 81, time: '2026-04-28T12:00:00Z' })
  assert.equal(event.tracker_id, 3580652)
  assert.equal(event.lat, 8.5)
  assert.equal(event.lng, -6.6)
})

test('buildTrackBundleFromTelemetryCache fournit tracé et alertes quand l’API privée tracks est vide', () => {
  const bundle = buildTrackBundleFromTelemetryCache({
    trackerId: 3580652,
    from: '2026-04-28T00:00:00Z',
    to: '2026-04-29T00:00:00Z',
    telemetryCache: {
      trackers: {
        3580652: {
          points: [
            { lat: 8.5, lng: -6.6, speed: 20, time: '2026-04-28T10:00:00Z' },
            { latitude: 8.6, longitude: -6.7, speed: 80, time: '2026-04-28T10:15:00Z' },
          ],
        },
      },
      events: [
        { tracker_id: 3580652, event: 'speedup', lat: 8.6, lng: -6.7, speed: 80, time: '2026-04-28T10:15:00Z' },
        { tracker_id: 111, event: 'speedup', lat: 0, lng: 0, time: '2026-04-28T11:00:00Z' },
      ],
    },
  })

  assert.equal(bundle.points.length, 2)
  assert.equal(bundle.segments.length, 1)
  assert.equal(bundle.events.length, 1)
  assert.equal(bundle.events[0].event, 'speedup')
})

test('buildTrackBundleFromTelemetryCache sépare les vrais déplacements au lieu de tout regrouper', () => {
  const bundle = buildTrackBundleFromTelemetryCache({
    trackerId: 3580652,
    from: '2026-04-28T00:00:00Z',
    to: '2026-04-29T00:00:00Z',
    telemetryCache: {
      trackers: {
        3580652: {
          points: [
            { lat: 8.5, lng: -6.6, speed: 30, time: '2026-04-28T08:00:00Z' },
            { lat: 8.6, lng: -6.7, speed: 45, time: '2026-04-28T08:20:00Z' },
            { lat: 8.7, lng: -6.8, speed: 50, time: '2026-04-28T10:00:00Z' },
            { lat: 8.8, lng: -6.9, speed: 60, time: '2026-04-28T10:15:00Z' },
          ],
        },
      },
    },
  })

  assert.equal(bundle.segments.length, 2)
  assert.deepEqual(bundle.segments.map((segment) => segment.started_at), [
    '2026-04-28T08:00:00Z',
    '2026-04-28T10:00:00Z',
  ])
  assert.deepEqual(bundle.segments.map((segment) => segment.ended_at), [
    '2026-04-28T08:20:00Z',
    '2026-04-28T10:15:00Z',
  ])
})

test('buildTrackBundleFromTelemetryCache ignore les grappes de points arrêtés à 0 km', () => {
  const bundle = buildTrackBundleFromTelemetryCache({
    trackerId: 3580652,
    from: '2026-04-28T00:00:00Z',
    to: '2026-04-29T00:00:00Z',
    telemetryCache: {
      trackers: {
        3580652: {
          points: [
            { lat: 8.5, lng: -6.6, speed: 0, time: '2026-04-28T08:00:00Z' },
            { lat: 8.5, lng: -6.6, speed: 0, time: '2026-04-28T08:10:00Z' },
            { lat: 8.5, lng: -6.6, speed: 0, time: '2026-04-28T08:20:00Z' },
            { lat: 8.51, lng: -6.61, speed: 35, time: '2026-04-28T09:00:00Z' },
            { lat: 8.52, lng: -6.62, speed: 42, time: '2026-04-28T09:15:00Z' },
          ],
        },
      },
    },
  })

  assert.equal(bundle.segments.length, 1)
  assert.equal(bundle.segments[0].started_at, '2026-04-28T09:00:00Z')
  assert.equal(bundle.segments[0].ended_at, '2026-04-28T09:15:00Z')
  assert.ok(bundle.segments[0].length > 0)
})
