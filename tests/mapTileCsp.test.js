import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')

test('CSP autorise les tuiles OpenStreetMap et Esri utilisées par Live Map', () => {
  assert.match(serverSource, /https:\/\/\*\.tile\.openstreetmap\.org/)
  assert.match(serverSource, /https:\/\/server\.arcgisonline\.com/)
})
