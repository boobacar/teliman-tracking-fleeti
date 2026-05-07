import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mapPageSource = readFileSync(new URL('../src/pages/MapPage.jsx', import.meta.url), 'utf8')

test('la Live Map affiche les infos camion au survol du marqueur sans clic', () => {
  assert.match(mapPageSource, /Tooltip/)
  assert.match(mapPageSource, /<Tooltip[\s>]/)
  assert.match(mapPageSource, /eventHandlers=\{\{ click: \(\) => toggleTrackerSelection\(tracker\.id\) \}\}/)
})
