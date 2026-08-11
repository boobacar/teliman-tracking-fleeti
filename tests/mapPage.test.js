import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mapPageSource = readFileSync(new URL('../src/pages/MapPage.jsx', import.meta.url), 'utf8')
const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('la Live Map charge la feuille de style Leaflet indispensable au positionnement des tuiles', () => {
  assert.match(mapPageSource, /import ['"]leaflet\/dist\/leaflet\.css['"]/)
})

test('la Live Map garde des contrôles opérationnels de recherche, recentrage et sélection', () => {
  assert.match(mapPageSource, /aria-label="Rechercher un camion sur la carte"/)
  assert.match(mapPageSource, />Recentrer</)
  assert.match(mapPageSource, />Tout afficher</)
  assert.match(mapPageSource, /tileLoadState/)
})

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

test('la Live Map bloque les transitions marqueurs pendant zoom/pan', () => {
  assert.match(mapPageSource, /function MapInteractionGuard\(\)/)
  assert.match(mapPageSource, /leaflet-transform-lock/)
  assert.match(mapPageSource, /map\.on\('zoomstart movestart'/)
  assert.match(mapPageSource, /<MapInteractionGuard \/>/)
})

test('la Live Map navigue via le routeur (navigate) et non via window.location.hash', () => {
  assert.match(mapPageSource, /useNavigate\(\)/)
  assert.match(mapPageSource, /navigate\(`\/tracker\/\$\{focusedTracker\.id\}`\)/)
  assert.match(mapPageSource, /navigate\(`\/delivery-order\/\$\{focusedOrder\.id\}`\)/)
  assert.doesNotMatch(mapPageSource, /window\.location\.hash/)
})

test('le poste de contrôle est ancré DANS la carte, en bas à gauche (portail → conteneur carte, pas le body)', () => {
  assert.match(mapPageSource, /createPortal\(/)
  assert.match(mapPageSource, /mapShellRef\.current/)
  assert.doesNotMatch(mapPageSource, /document\.body/)
  const panelCss = appCss.match(/\.map-control-panel \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(panelCss, /position: absolute;/)
  assert.match(panelCss, /bottom: 12px; left: 12px;/)
  assert.doesNotMatch(panelCss, /position: fixed;/)
})

test('la lecture de trajet suit automatiquement le point en cours (PlaybackFollow, setView, interruption)', () => {
  assert.match(mapPageSource, /function PlaybackFollow/)
  assert.match(mapPageSource, /map\.setView\(\[lat, lng\], map\.getZoom\(\), \{ animate: false \}\)/)
  assert.doesNotMatch(mapPageSource, /map\.panTo/)
  assert.match(mapPageSource, /<PlaybackFollow position=\{playbackPosition\}/)
  assert.match(mapPageSource, /onUserInterrupt=\{\(\) => setPlaybackFollowOn\(false\)\}/)
  assert.match(mapPageSource, /following=\{followOn && !!focusedTracker && !playbackActive\}/)
  assert.match(mapPageSource, /const playbackActive = !!/)
})

test('la Live Map est un poste de contrôle (panneau, âge, suivi, ETA)', () => {
  assert.match(mapPageSource, /map-control-panel/)
  assert.match(mapPageSource, /aria-label="Poste de contrôle"/)
  assert.match(mapPageSource, /formatPositionAge/)
  assert.match(mapPageSource, /Suivre le camion/)
  assert.match(mapPageSource, /function FollowController/)
  assert.match(mapPageSource, /function FlyToTarget/)
  assert.match(mapPageSource, /nearestClientZone/)
  assert.match(mapPageSource, />Fiche camion</)
  assert.match(mapPageSource, />Fiche mission</)
  assert.match(mapPageSource, /Aucun bon actif/)
})

test('la Live Map lit les trajets (lecture animée, sens, arrêts)', () => {
  assert.match(mapPageSource, /Lecture du trajet/)
  assert.match(mapPageSource, /buildDirectionArrows/)
  assert.match(mapPageSource, /createDirectionArrowIcon/)
  assert.match(mapPageSource, /detectStops/)
  assert.match(mapPageSource, /Temps d'arrêt/)
  assert.match(mapPageSource, /createPlaybackIcon/)
  assert.match(mapPageSource, /type="range"/)
})

test('la Live Map regroupe la flotte nombreuse et étend la recherche au BL/client', () => {
  assert.match(mapPageSource, /clusterTrackers/)
  assert.match(mapPageSource, /createClusterIcon/)
  assert.match(mapPageSource, /activeOrderByTrackerId/)
  assert.match(mapPageSource, /Camion, chauffeur, BL ou client/)
  assert.match(mapPageSource, />Tout afficher</)
})

test("la Live Map gère l'état des tuiles avec nouvelle tentative", () => {
  assert.match(mapPageSource, /tileLoadState/)
  assert.match(mapPageSource, />Réessayer</)
  assert.match(mapPageSource, /tileKey/)
})
