import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mapPageSource = readFileSync(new URL('../src/pages/MapPage.jsx', import.meta.url), 'utf8')

test('la Live Map affiche les infos camion au survol du marqueur sans clic', () => {
  assert.match(mapPageSource, /Tooltip/)
  assert.match(mapPageSource, /<Tooltip[\s>]/)
  assert.match(mapPageSource, /eventHandlers=\{\{ click: \(\) => toggleTrackerSelection\(tracker\.id\) \}\}/)
})

test('la Live Map ne recadre pas automatiquement à chaque position live', () => {
  assert.match(mapPageSource, /function FleetBounds\(\{ trackers, fitKey \}\)/)
  assert.match(mapPageSource, /trackersRef\.current = trackers/)
  assert.match(mapPageSource, /\}, \[map, fitKey\]\)/)
  assert.doesNotMatch(mapPageSource, /\}, \[map, trackers\]\)/)
})

test('la Live Map bloque les transitions marqueurs pendant zoom\/pan', () => {
  assert.match(mapPageSource, /function MapInteractionGuard\(\)/)
  assert.match(mapPageSource, /leaflet-transform-lock/)
  assert.match(mapPageSource, /map\.on\('zoomstart movestart'/)
  assert.match(mapPageSource, /<MapInteractionGuard \/>/)
})
