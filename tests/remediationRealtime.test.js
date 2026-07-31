import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const map = read('src/pages/MapPage.jsx')
const dashboard = read('src/pages/DashboardPage.jsx')
const whatsapp = read('src/pages/WhatsAppPage.jsx')
const trips = read('src/pages/TripsReportPage.jsx')
const hooks = read('src/hooks.js')
const sw = read('public/sw.js')

test('les pollings temps réel ne se chevauchent pas et exposent fraîcheur et erreurs distinctes', () => {
  assert.match(hooks, /setTimeout/)
  assert.doesNotMatch(hooks, /setInterval/)
  assert.match(map, /liveUpdatedAt/)
  assert.match(map, /liveError/)
  assert.match(map, /trackError/)
  assert.match(map, /TRACK_CACHE_TTL_MS/)
  assert.match(map, /Données (?:à jour|anciennes)/)
  assert.doesNotMatch(map, /livePollRef\.current = setInterval/)
})

test('la carte possède un titre principal et une liste textuelle synchronisée', () => {
  assert.match(map, /<h1[^>]*>Carte temps réel<\/h1>/)
  assert.match(map, /aria-label="Liste accessible des véhicules affichés"/)
  assert.match(map, /aria-pressed=/)
  assert.match(map, /Impossible de charger les tracés/)
})

test('le dashboard recharge ses données live et distingue loading error empty', () => {
  assert.match(dashboard, /useAutoRefresh\(loadDashboardLiveData/)
  assert.match(dashboard, /\[loadDashboardLiveData, lastRefreshAt\]/)
  assert.match(dashboard, /liveDataError/)
  assert.match(dashboard, /liveDataLoading/)
  assert.match(dashboard, /liveDataUpdatedAt/)
  assert.doesNotMatch(dashboard, /⚠/)
  assert.doesNotMatch(dashboard, /ExecutiveCard/)
})

test('WhatsApp charge les sous-domaines indépendamment et annonce le bon type de feedback', () => {
  assert.match(whatsapp, /Promise\.allSettled/)
  assert.match(whatsapp, /actionFeedback\.kind/)
  assert.match(whatsapp, /role="alert"/)
  assert.match(whatsapp, /translateWhatsAppError/)
  assert.match(whatsapp, /window\.confirm/)
  assert.match(whatsapp, /disabled=\{Boolean\(busyAction\) \|\| !isConnected\}/)
})

test('le rapport trajets filtre avant batch, masque les zéros et pagine le détail', () => {
  assert.match(trips, /candidateTrackers = filteredTrackers[\s\S]*selectedTrackerId/)
  assert.match(trips, /showZeroActivity/)
  assert.match(trips, /DETAIL_PAGE_SIZE/)
  assert.match(trips, /visibleTrips/)
  assert.match(trips, /Page \{detailPage\} sur \{detailTotalPages\}/)
  assert.match(trips, /TRIPS_CACHE_TTL_MS/)
})

test('le cache statique du service worker a une version déterministe', () => {
  assert.match(sw, /teliman-static-20260728-mapfix/)
})
