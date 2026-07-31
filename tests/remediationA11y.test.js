import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const css = read('src/App.css')
const layout = read('src/components/Layout.jsx')
const confirmDialog = read('src/components/ConfirmDialog.jsx')
const imageDialog = read('src/components/ImageDialog.jsx')
const picker = read('src/components/StableDatePicker.jsx')
const pagination = read('src/components/Pagination.jsx')
const drivers = read('src/pages/DriversPage.jsx')
const admin = read('src/pages/AdminUsersPage.jsx')
const alerts = read('src/pages/AlertsPage.jsx')
const data = read('src/pages/DataPage.jsx')
const fuels = read('src/pages/FuelVouchersPage.jsx')
const deliveryOrders = read('src/pages/DeliveryOrdersPage.jsx')
const oil = read('src/pages/OilChangesPage.jsx')
const deliveryDetail = read('src/pages/DeliveryOrderDetailPage.jsx')
const fuelDetail = read('src/pages/FuelVoucherDetailPage.jsx')
const analytics = read('src/pages/AnalyticsPage.jsx')
const trackerDetail = read('src/pages/TrackerDetailPage.jsx')

function count(source, expression) {
  return (source.match(expression) || []).length
}

test('le shell fournit un lien d’évitement vers un contenu principal focalisable', () => {
  assert.match(layout, /className="skip-link"[^>]+href="#main-content"/)
  assert.match(layout, /<main[^>]+id="main-content"[^>]+tabIndex=\{-1\}/)
  assert.match(css, /\.skip-link\s*\{[^}]*position:\s*fixed/s)
  assert.match(css, /\.skip-link:focus-visible\s*\{/)
})

test('les dialogues confirmation et image sont modaux, pilotables au clavier et restaurent le focus', () => {
  assert.match(confirmDialog, /role="alertdialog"/)
  assert.match(confirmDialog, /aria-modal="true"/)
  assert.match(confirmDialog, /event\.key === 'Escape'/)
  assert.match(confirmDialog, /previousFocus\?\.focus/)
  assert.match(css, /\.confirm-dialog-backdrop\s*\{[^}]*position:\s*fixed[^}]*z-index:/s)
  assert.match(css, /\.confirm-dialog\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s)

  assert.match(imageDialog, /createPortal/)
  assert.match(imageDialog, /role="dialog"/)
  assert.match(imageDialog, /aria-modal="true"/)
  assert.match(imageDialog, /event\.key === 'Escape'/)
  assert.match(imageDialog, /aria-label="Fermer l’image"/)
  assert.match(imageDialog, /previousFocus\?\.focus/)
  assert.match(deliveryDetail, /<ImageDialog/)
  assert.match(fuelDetail, /<ImageDialog/)
  assert.doesNotMatch(deliveryDetail, /className="photo-lightbox"/)
  assert.doesNotMatch(fuelDetail, /className="photo-lightbox"/)
})

test('toutes les tables du lot ont un caption et des en-têtes de colonne explicitement scopés', () => {
  for (const [pageName, source] of Object.entries({ drivers, admin, alerts, fuels, oil })) {
    assert.equal(count(source, /<caption\b/g), count(source, /<table\b/g), `${pageName}: chaque table doit avoir un caption`)
    const headers = [...source.matchAll(/<th\b([^>]*)>/g)]
    assert.ok(headers.length > 0, `${pageName}: en-têtes attendus`)
    for (const header of headers) assert.match(header[1], /scope="col"/, `${pageName}: scope col manquant`)
  }
})

test('les lignes de bons carburant n’imitent plus des liens et exposent un vrai lien principal', () => {
  assert.doesNotMatch(fuels, /<tr[^>]+role="link"/)
  assert.doesNotMatch(fuels, /<tr[^>]+onClick=/)
  assert.match(fuels, /<Link[^>]+to=\{`\/fuel-voucher\/\$\{item\.id\}`\}/)
})

test('les BL utilisent de vrais liens sans parent interactif imbriqué', () => {
  assert.doesNotMatch(deliveryOrders, /<(?:tr|article)[^>]+role="link"/)
  assert.doesNotMatch(deliveryOrders, /<(?:tr|article)[^>]+onKeyDown=/)
  assert.match(deliveryOrders, /<Link className="touch-link" to=\{`\/delivery-order\/\$\{item\.id\}`\}/)
})

test('chaque page autorisée expose un h1 unique et les graphiques ont une alternative textuelle', () => {
  for (const [pageName, source] of Object.entries({ drivers, admin, alerts, data, fuels, oil, deliveryDetail, fuelDetail, analytics, trackerDetail })) {
    assert.ok(count(source, /<h1\b/g) >= 1, `${pageName}: un h1 attendu dans chaque état rendu`)
  }
  for (const source of Object.values({ analytics, trackerDetail })) {
    assert.match(source, /<figure\b/)
    assert.match(source, /<figcaption\b/)
    assert.match(source, /className="chart-data-summary"/)
    assert.match(source, /Aucune donnée/)
  }
})

test('les contrôles compacts ont des états ARIA, un focus visible et des cibles tactiles suffisantes', () => {
  assert.match(alerts, /aria-pressed=/)
  assert.match(admin, /role="switch"/)
  assert.match(data, /role="switch"/)
  assert.match(data, /type="checkbox" role="switch"/)
  assert.match(css, /\.ui-toggle-input:focus-visible\s*\+\s*\.ui-toggle-track/)
  assert.match(css, /\.pagination-btn\s*\{[^}]*min-width:\s*44px[^}]*height:\s*44px/s)
  assert.match(css, /\.stable-date-picker-inline-clear\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
  assert.match(css, /\.icon-btn\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/s)
  assert.match(css, /@media[^{]+max-width:\s*900px[\s\S]*?\.icon-btn\s*\{[^}]*width:\s*48px/s)
})

test('la vue chauffeurs mobile reste visible, labellisée et sans emoji', () => {
  assert.match(drivers, /<div className="mobile-cards-grid">/)
  assert.doesNotMatch(drivers, /mobile-cards-grid" style=\{\{ display: 'none' \}\}/)
  assert.doesNotMatch(drivers, /[➕⚡✅❌]/)
  assert.match(drivers, /aria-label="Prénom du chauffeur"/)
  assert.match(drivers, /aria-label="Camion assigné"/)
  assert.match(css, /@media[^{]+max-width:\s*900px[\s\S]*?\.drivers-page \.mobile-cards-grid\s*\{[^}]*display:\s*grid/s)
})

test('le calendrier évite les collisions viewport et rend le focus à chaque fermeture', () => {
  assert.match(picker, /window\.innerWidth/)
  assert.match(picker, /window\.innerHeight/)
  assert.match(picker, /Math\.max\(/)
  assert.match(picker, /closePopover/)
  assert.match(picker, /triggerRef\.current\?\.focus\(\)/)
  assert.match(pagination, /aria-current=\{p === page \? 'page'/)
})

test('le CSS ne masque plus génériquement les rapports mobiles et utilise un accent AA avec texte blanc', () => {
  assert.doesNotMatch(css, /\.delivery-table-panel \.reports-table-wrap\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(css, /^\s*\.delivery-table-panel\s*>\s*\.reports-table-wrap/m)
  assert.match(css, /\.delivery-orders-page \.delivery-table-panel > \.reports-table-wrap/)
  assert.match(css, /\.fuel-vouchers-page \.delivery-table-panel > \.reports-table-wrap/)
  assert.match(css, /--ops-accent:\s*#6f4525/i)
  assert.match(css, /--ops-accent-strong:\s*#7a4a27/i)
})

test('les référentiels confirment les suppressions, annoncent les mutations et retirent le badge de développement', () => {
  assert.match(data, /useAccessibleConfirm/)
  assert.match(data, /confirmationDialog/)
  assert.match(data, /role="status" aria-live="polite"/)
  assert.match(data, /try\s*\{/)
  assert.match(data, /catch \(err\)/)
  assert.doesNotMatch(data, /PHASE 3 UI/i)
})

test('les rôles et permissions sont humains, puis la validation vient après la matrice', () => {
  assert.match(admin, /Administrateur/)
  assert.match(admin, /Gérer les chauffeurs/)
  assert.match(admin, /Gérer WhatsApp/)
  assert.doesNotMatch(admin, />Créer<\/button>[\s\S]*ui-permissions-grid/)
  assert.match(admin, /ui-permissions-grid[\s\S]*type="submit"[^>]*>Créer l’utilisateur</)
})
