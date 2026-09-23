// Contrôle par les sources : la page « Alertes & Rapports » est bien branchée
// (route, navigation, API de routage, styles) — style de test utilisé par le projet.
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('la page Alertes & Rapports existe et utilise l’API de routage', () => {
  const pagePath = new URL('../src/pages/AlertRoutingPage.jsx', import.meta.url)
  assert.equal(existsSync(pagePath), true, 'page manquante')
  const source = read('src/pages/AlertRoutingPage.jsx')

  assert.match(source, /export function AlertRoutingPage/)
  assert.match(source, /loadAlertRouting/, 'la page doit lire /api/alert-routing')
  assert.match(source, /createAlertSubscription/, 'cocher une case crée une règle')
  assert.match(source, /deleteAlertSubscription/, 'décocher supprime la règle')
  assert.match(source, /updateAlertRecipient/, 'activation/désactivation du destinataire')
  assert.match(source, /deleteAlertRecipient/)
  // Le principe de bascule doit être expliqué à l'opérateur.
  assert.match(source, /contrôle total/)
  // Portées : zone, client, camion
  assert.match(source, /Toutes les zones/)
  assert.match(source, /Tous les clients/)
  assert.match(source, /Tous les camions/)
})

test('la page est routée avec la permission manage_data et présente dans le menu', () => {
  const app = read('src/App.jsx')
  assert.match(app, /const AlertRoutingPage = lazy\(\(\) => import\('\.\/pages\/AlertRoutingPage'\)/)
  assert.match(app, /<Route path="\/alertes-diffusion" element=\{guard\('manage_data', <AlertRoutingPage \/>\)\} \/>/)

  const layout = read('src/components/Layout.jsx')
  assert.match(layout, /id: '\/alertes-diffusion', label: 'Alertes & Rapports'/)
  assert.match(layout, /permission: 'manage_data'/)
})

test('les appels API du routage existent côté cliente et côté serveur', () => {
  const lib = read('src/lib/fleeti.js')
  assert.match(lib, /export const loadAlertRouting = \(\) => getJson\('\/api\/alert-routing'\)/)
  assert.match(lib, /export const createAlertSubscription/)
  assert.match(lib, /export const updateAlertSubscription/)
  assert.match(lib, /export const deleteAlertSubscription/)

  const server = read('server.js')
  assert.match(server, /app\.get\('\/api\/alert-routing'/)
  assert.match(server, /app\.post\('\/api\/alert-subscriptions', requirePermission\('manage_data'\)/)
  assert.match(server, /app\.put\('\/api\/alert-subscriptions\/:id', requirePermission\('manage_data'\)/)
  assert.match(server, /app\.delete\('\/api\/alert-subscriptions\/:id', requirePermission\('manage_data'\)/)
  // Sans mappage explicite, le garde-fou « default-deny » renvoie 403 à tout le monde.
  assert.match(server, /if \(pathName\.startsWith\('\/api\/alert-routing'\)\) return \['manage_data', 'page_alerts'\]/)
  assert.match(server, /if \(pathName\.startsWith\('\/api\/alert-subscriptions'\)\) return \['manage_data'\]/)
  // Le routage doit réellement filtrer les envois (et non juste stocker des règles).
  assert.match(server, /function routedAlertPhones\(category, context = \{\}\)/)
  assert.match(server, /routedAlertPhones\(geofenceAlertCategoryKey\(event\?\.eventType\)/)
  assert.match(server, /routedAlertPhones\(fleetCategory, \{ truckLabel: fleetTruckLabel \}\)/)
  assert.match(server, /routedAlertPhones\(boundaryCategory, \{ clientName: order\.client \}\)/)
  // L'ancien comportement « tout le monde reçoit tout » ne doit plus exister.
  assert.equal(/getAlertRecipientPhones\(\)/.test(server), false)
  assert.equal(/getClientScopedAlertPhones/.test(server), false)
})

test('les styles de la page sont présents (grille de cases, sans effet au survol)', () => {
  const css = read('src/App.css')
  for (const selector of ['.alert-routing-grid', '.alert-routing-item', '.alert-routing-toggle', '.alert-routing-header']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')))
  }
  assert.equal(/\.alert-routing-item:hover/.test(css), false, 'pas d’effet au survol sur les sections')
})
