import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const mapSource = readFileSync(new URL('../src/pages/MapPage.jsx', import.meta.url), 'utf8')

test('le serveur expose un flux SSE positions-live', () => {
  assert.match(serverSource, /app\.get\('\/api\/positions-live\/stream'/)
  assert.match(serverSource, /text\/event-stream/)
  assert.match(serverSource, /ssePositionClients\.add\(res\)/)
  assert.match(serverSource, /broadcastPositionsLive\(payload\)/)
})

test('un ticker serveur évalue les géofences et diffuse même sans navigateur', () => {
  assert.match(serverSource, /setInterval\(\(\) => \{/)
  assert.match(serverSource, /refreshPositionsLive\(\)\.catch/)
  assert.match(serverSource, /\}, 3000\)/)
  assert.match(serverSource, /evaluateGeofenceTransitions\(payload\.positions\)/)
})

test('MapPage consomme le SSE avec repli polling si le flux meurt', () => {
  assert.match(mapSource, /new EventSource\(`\/api\/positions-live\/stream/)
  assert.match(mapSource, /encodeURIComponent\(sessionToken\)/)
  assert.match(mapSource, /eventSource\.onmessage/)
  assert.match(mapSource, /eventSource\.onerror/)
  assert.match(mapSource, /lastSseAt\.value < 9000/)
  assert.match(mapSource, /eventSource\?\.close\(\)/)
})
