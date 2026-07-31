import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const app = read('src/App.jsx')
const api = read('src/lib/fleeti.js')
const layout = read('src/components/Layout.jsx')
const oil = read('src/pages/OilChangesPage.jsx')
const alerts = read('src/pages/AlertsPage.jsx')
const css = read('src/App.css')
const protectedImage = read('src/components/ProtectedImage.jsx')
const deliveryDetail = read('src/pages/DeliveryOrderDetailPage.jsx')
const fuelDetail = read('src/pages/FuelVoucherDetailPage.jsx')
const fleet = read('src/pages/FleetPage.jsx')
const map = read('src/pages/MapPage.jsx')
const whatsapp = read('src/pages/WhatsAppPage.jsx')
const deliveries = read('src/pages/DeliveryOrdersPage.jsx')
const fuels = read('src/pages/FuelVouchersPage.jsx')
const main = read('src/main.jsx')
const hooksSource = read('src/hooks.js')

test('le shell ne charge ni mocks, ni Leaflet, ni Recharts et lazy-load le dashboard', () => {
  assert.doesNotMatch(app, /data\/mock|fallbackEvents|from 'leaflet'|from 'recharts'/)
  assert.match(app, /const DashboardPage = lazy/)
  assert.match(main, /navigator\.serviceWorker\.register\('\/sw\.js'\)/)
})

test('la couche API utilise le token de session seul et centralise toutes les requêtes JSON', () => {
  assert.doesNotMatch(api, /x-user-email|teliman_user_email/)
  assert.equal((api.match(/\bfetch\(/g) || []).length, 1)
  assert.match(api, /error\.kind = 'sessionExpired'/)
  assert.match(api, /\.kind = 'timeout'/)
  assert.match(api, /\.kind = 'offline'/)
  assert.match(api, /\/api\/auth\/logout/)
})

test('les routes sont uniques, gardées par permission et fournissent 403 et 404', () => {
  assert.match(app, /function PermissionRoute/)
  assert.match(app, /Accès refusé/)
  assert.match(app, /Page introuvable/)
  assert.equal((app.match(/<Routes>/g) || []).length, 1)
  assert.match(app, /initialMode="drivers"/)
  assert.match(fleet, /useState\(initialMode\)/)
  assert.doesNotMatch(app, /path="\/drivers"[^\n]*filteredTrackers=\{filteredTrackers\}/)
})

test('le menu mobile expose son état et gère focus et Escape', () => {
  assert.match(layout, /aria-expanded=\{mobileNavOpen\}/)
  assert.match(layout, /aria-controls="mobile-navigation"/)
  assert.match(layout, /id="mobile-navigation"/)
  assert.match(layout, /event\.key === 'Escape'/)
  assert.match(layout, /\.focus\(\)/)
})

test('les tableaux Vidanges et Alertes ont une alternative mobile explicite', () => {
  assert.match(oil, /mobile-oil-fleet-list/)
  assert.match(oil, /mobile-oil-history-list/)
  assert.match(alerts, /mobile-alert-rules-list/)
  assert.match(css, /\.mobile-oil-fleet-list/)
  assert.match(css, /\.mobile-alert-rules-list/)
  for (const width of [390, 680, 768, 900]) assert.match(css, new RegExp(`max-width: ${width}px`))
})

test('les primitives accessibles couvrent dialogue date, pagination et confirmations', () => {
  const picker = read('src/components/StableDatePicker.jsx')
  const pagination = read('src/components/Pagination.jsx')
  const confirm = read('src/components/ConfirmDialog.jsx')
  assert.match(picker, /role="dialog"/)
  assert.match(picker, /aria-modal="false"/)
  assert.match(picker, /aria-label="Heure"/)
  assert.match(pagination, /aria-current=\{p === page \? 'page'/)
  assert.match(confirm, /role="alertdialog"/)
  assert.match(confirm, /aria-modal="true"/)
  assert.match(confirm, /event\.key === 'Escape'/)
})

test('les mots de passe administrateur sont masqués et les toasts sont annoncés', () => {
  const admin = read('src/pages/AdminUsersPage.jsx')
  const delivery = read('src/pages/DeliveryOrdersPage.jsx')
  assert.doesNotMatch(admin, /password[^>]+type="text"/s)
  assert.ok((admin.match(/type="password"/g) || []).length >= 2)
  assert.ok((admin.match(/autoComplete="new-password"/g) || []).length >= 2)
  assert.match(app, /role="status" aria-live="polite"/)
  assert.match(delivery, /role="status" aria-live="polite"/)
})

test('le polling respecte la visibilité du document et bloque les courses', () => {
  const hooks = read('src/hooks.js')
  assert.match(hooks, /document\.visibilityState === 'hidden'/)
  assert.match(hooks, /inFlight/)
  assert.match(hooks, /visibilitychange/)
})

test('les pollings spécialisés et suppressions sensibles respectent visibilité et confirmation accessible', () => {
  assert.match(map, /document\.hidden/)
  assert.match(whatsapp, /useAutoRefresh/)
  assert.match(hooksSource, /document\.visibilityState === 'hidden'/)
  assert.match(oil, /document\.hidden/)
  for (const source of [deliveries, fuels, oil, deliveryDetail, fuelDetail]) {
    assert.match(source, /useAccessibleConfirm/)
    assert.match(source, /confirmationDialog/)
  }
})

test('les preuves privées sont chargées avec la session sans token dans l’URL', () => {
  assert.match(api, /loadProtectedMediaObjectUrl/)
  assert.match(api, /getSessionHeaders\(\)/)
  assert.match(protectedImage, /URL\.revokeObjectURL/)
  assert.match(deliveryDetail, /<ProtectedImage source=\{photo\}/)
  assert.match(fuelDetail, /<ProtectedImage source=\{photo\}/)
  assert.doesNotMatch(api, /[?&](?:token|sessionToken)=/)
})
