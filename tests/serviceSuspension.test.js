import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SERVER_SOURCE = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const APP_SOURCE = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const FLEETI_SOURCE = readFileSync(new URL('../src/lib/fleeti.js', import.meta.url), 'utf8')

test('le mode suspension expose un statut public et bloque les API de donnees', () => {
  assert.match(SERVER_SOURCE, /SERVICE_SUSPENSION_FILE/)
  assert.match(SERVER_SOURCE, /app\.get\('\/api\/service-status'/)
  assert.match(SERVER_SOURCE, /function blockSuspendedDataAccess/)
  assert.match(SERVER_SOURCE, /res\.status\(503\)\.json\(\{ ok: false, suspended: true, error: SERVICE_SUSPENSION_MESSAGE \}\)/)
  assert.match(SERVER_SOURCE, /app\.use\(blockSuspendedDataAccess\)/)
})

test('le frontend masque les routes de donnees et affiche le message demande en suspension', () => {
  assert.match(FLEETI_SOURCE, /export const loadServiceStatus = \(\) => getJson\('\/api\/service-status'\)/)
  assert.match(FLEETI_SOURCE, /SERVICE_SUSPENSION_EVENT = 'teliman:service-suspended'/)
  assert.match(FLEETI_SOURCE, /window\.dispatchEvent\(new CustomEvent\(SERVICE_SUSPENSION_EVENT/)
  assert.match(APP_SOURCE, /window\.addEventListener\(SERVICE_SUSPENSION_EVENT, handleServiceSuspended\)/)
  assert.match(APP_SOURCE, /<ServiceSuspendedPage loading=\{serviceStatusLoading\} \/>/)
  assert.match(APP_SOURCE, /<strong>impossible de joindre le serveur<\/strong>/)
})
