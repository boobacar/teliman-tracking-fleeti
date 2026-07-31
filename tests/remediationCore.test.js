import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeBackendUrl } from '../src/lib/backendUrl.js'
import { printDeliveryOrder } from '../src/lib/printDeliveryOrder.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('le Funnel ts.net force les API same-origin même avec une URL backend configurée', () => {
  assert.equal(normalizeBackendUrl('http://100.67.148.58:8787', { currentFrontendHost: 'home-server-1.tail660cfd.ts.net' }), '')
  assert.equal(normalizeBackendUrl('', { currentFrontendHost: 'home-server-1.tail660cfd.ts.net' }), '')
})

test('l’impression BL échappe toutes les données métier et coupe window.opener', () => {
  let written = ''
  const printWindow = {
    document: { write(value) { written = value }, close() {} },
    focus() {},
    print() {},
    opener: {},
  }
  const previousWindow = globalThis.window
  globalThis.window = { open: () => printWindow }
  try {
    printDeliveryOrder({
      reference: '<img src=x onerror=alert(1)>',
      truckLabel: '<b>TRUCK</b>',
      driver: 'A & B',
      client: '"client"',
      destination: "'destination'",
      goods: '<script>bad()</script>',
      quantity: '1<2',
      status: '<svg/onload=bad()>',
      loadingPoint: '<iframe>',
      notes: '<script>bad()</script>',
    })
  } finally {
    globalThis.window = previousWindow
  }
  assert.doesNotMatch(written, /<img|<script|<iframe|<svg|<b>TRUCK/)
  assert.match(written, /&lt;img/)
  assert.match(written, /A &amp; B/)
  assert.equal(printWindow.opener, null)
})

test('un lot de photos BL est compressé avant un unique PATCH atomique', () => {
  const source = read('src/pages/DeliveryOrdersPage.jsx')
  assert.match(source, /const uploadProofPhotos = async \(item, files\)/)
  assert.match(source, /Promise\.all\(files\.map\(fileToDataUrl\)\)/)
  assert.match(source, /proofPhotoDataUrls: \[\.\.\.currentPhotos, \.\.\.newPhotos\]/)
  assert.doesNotMatch(source, /for \(const file of files\)[\s\S]{0,120}uploadProofPhoto/)
})

test('les routes Flotte et Chauffeurs resynchronisent leur mode et un tracker navigue vers son détail', () => {
  const fleet = read('src/pages/FleetPage.jsx')
  const trackers = read('src/pages/TrackersPage.jsx')
  assert.match(fleet, /useEffect\(\(\) => setMode\(initialMode\), \[initialMode\]\)/)
  assert.match(trackers, /useNavigate\(\)/)
  assert.match(trackers, /navigate\(`\/tracker\/\$\{tracker\.id\}`\)/)
})

test('les invariants BL interdisent un bon Livré actif et verrouillent sa clôture', () => {
  const source = read('src/pages/DeliveryOrdersPage.jsx')
  assert.match(source, /form\.status === 'Livré' \? \{ \.\.\.form, active: false \} : form/)
  assert.match(source, /disabled=\{saving \|\| !item\.active \|\| item\.status === 'Livré'\}/)
  assert.match(source, /Clôturer le bon de livraison/)
})

test('App charge les domaines autorisés indépendamment et la suspension démonte le shell métier', () => {
  const source = read('src/App.jsx')
  assert.match(source, /function hasPermission\(user, permission\)/)
  assert.match(source, /Promise\.allSettled\(secondaryLoads\.map/)
  assert.match(source, /hasPermission\(currentUser, 'page_reports'\)/)
  assert.match(source, /hasPermission\(currentUser, 'manage_delivery_orders'\)/)
  assert.match(source, /if \(serviceIssue === 'suspended'\) \{[\s\S]*return \([\s\S]*<GlobalServerMessageBanner/)
  assert.doesNotMatch(source, /\{serviceIssue && <GlobalServerMessageBanner/)
})

test('App applique aussi le filtre sans recherche et limite les états globaux au dashboard', () => {
  const source = read('src/App.jsx')
  assert.match(source, /const searchFiltered = useMemo\(\(\) => filteredTrackers/)
  assert.match(source, /location\.pathname === '\/' && isEmptySearch/)
  assert.match(source, /serviceIssue \? null : error/)
})

test('une panne de vérification auth reste une panne et ErrorBoundary se réinitialise à la navigation', () => {
  const app = read('src/App.jsx')
  const boundary = read('src/components/ErrorBoundary.jsx')
  assert.match(app, /catch \(err\)[\s\S]{0,180}setServiceIssue\(err\?\.kind \|\| 'serverError'\)/)
  assert.match(app, /<ErrorBoundary resetKey=\{location\.pathname\}>/)
  assert.match(boundary, /componentDidUpdate\(previousProps\)/)
  assert.match(boundary, /previousProps\.resetKey !== this\.props\.resetKey/)
})

test('la conformité distingue inconnu de valide et possède son propre schéma d’export', () => {
  const source = read('src/pages/ReportsPage.jsx')
  assert.match(source, /let insuranceStatus = 'unknown'/)
  assert.match(source, /if \(type === 'fleet-compliance'\)/)
  assert.match(source, /headers: \['CAMION', 'MODÈLE', 'GARAGE', 'ASSURANCE RC', 'STATUT RC'/)
  assert.match(source, /garage_organization_name/)
  assert.match(source, /statusLabel = row\.insuranceStatus === 'unknown' \? 'Inconnue'/)
})

test('un export opérationnel est bloqué tant que le payload ne correspond pas à type et période', () => {
  const source = read('src/pages/ReportsPage.jsx')
  assert.match(source, /const \[operationalPayloadKey, setOperationalPayloadKey\]/)
  assert.match(source, /const requestKey = `\$\{type\}\|\$\{from\}\|\$\{to\}`/)
  assert.match(source, /setOperationalPayload\(null\)/)
  assert.match(source, /setOperationalPayloadKey\(requestKey\)/)
  assert.match(source, /const exportDisabled = loading \|\| fleetLoading \|\| operationalLoading/)
  assert.match(source, /disabled=\{exportDisabled\}/)
})

test('le rapport Chauffeurs applique le filtre aux KPI et au PDF et décrit la période réelle', () => {
  const source = read('src/pages/DriversReportPage.jsx')
  assert.match(source, /buildDriverReportTotals\(visibleSummaries\)/)
  assert.match(source, /body: visibleSummaries\.map/)
  assert.match(source, /Total chauffeurs: \$\{visibleSummaries\.length\}/)
  assert.doesNotMatch(source, /Données sur les 7 derniers jours/)
})
