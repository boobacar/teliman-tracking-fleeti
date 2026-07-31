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

test('le frontend distingue suspension, panne réseau, timeout et session expirée', () => {
  assert.match(FLEETI_SOURCE, /export const loadServiceStatus = \(\) => getJson\('\/api\/service-status'\)/)
  assert.match(FLEETI_SOURCE, /SERVICE_SUSPENSION_EVENT = 'teliman:service-suspended'/)
  assert.match(FLEETI_SOURCE, /window\.dispatchEvent\(new CustomEvent\(SERVICE_SUSPENSION_EVENT/)
  assert.doesNotMatch(APP_SOURCE, /FORCE_GLOBAL_SERVER_MESSAGE/)
  assert.match(APP_SOURCE, /const \[serviceIssue, setServiceIssue\]/)
  assert.match(APP_SOURCE, /suspended: \['Service temporairement suspendu'/)
  assert.match(APP_SOURCE, /offline: \['Connexion indisponible'/)
  assert.match(APP_SOURCE, /timeout: \['Le serveur tarde à répondre'/)
  assert.match(APP_SOURCE, /sessionExpired: \['Session expirée'/)
  assert.match(APP_SOURCE, /<GlobalServerMessageBanner kind=\{serviceIssue\}/)
  assert.match(APP_SOURCE, />Réessayer<\/button>/)
  assert.match(APP_SOURCE, />Déconnexion<\/button>/)
})
