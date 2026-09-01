import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')

test('la page WhatsApp est branchée dans une route et le menu latéral', () => {
  assert.match(appSource, /WhatsAppPage/)
  assert.match(appSource, /path="\/whatsapp"/)
  assert.match(layoutSource, /id: '\/whatsapp'/)
  assert.match(layoutSource, /label: 'WhatsApp'/)
})

test('la page WhatsApp affiche uniquement le numéro réellement connecté', () => {
  const pageSource = readFileSync(new URL('../src/pages/WhatsAppPage.jsx', import.meta.url), 'utf8')

  assert.doesNotMatch(pageSource, /\+225 07 00 184 839/)
  assert.doesNotMatch(pageSource, /2250700184839/)
  assert.match(pageSource, /const isConnected = whatsAppStatus\?\.connected === true/)
  assert.match(pageSource, /Aucun numéro connecté/)
  assert.match(pageSource, /wa\.me\//)
})

test('les utilisateurs opérationnels reçoivent la permission page_whatsapp par défaut', () => {
  assert.match(serverSource, /page_whatsapp/)
})

test('l’historique WhatsApp est filtré et paginé pour éviter une longue liste d’alertes', () => {
  const pageSource = readFileSync(new URL('../src/pages/WhatsAppPage.jsx', import.meta.url), 'utf8')

  assert.match(pageSource, /HISTORY_PAGE_SIZE\s*=\s*5/)
  assert.match(pageSource, /historyPage/)
  assert.match(pageSource, /filteredHistory/)
  assert.match(pageSource, /entry\.status !== 'skipped'/)
  assert.match(pageSource, /visibleHistory/)
  assert.match(pageSource, /slice\(historyStartIndex, historyEndIndex\)/)
  assert.match(pageSource, /Page \{historyPage\}\/\{historyTotalPages\}/)
  assert.match(pageSource, /Précédent/)
  assert.match(pageSource, /Suivant/)
})

test('la page WhatsApp ne montre plus le panneau Cloud API Meta', () => {
  const source = readFileSync(new URL('../src/pages/WhatsAppPage.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /Cloud API officielle \\(Meta\\)/)
  assert.doesNotMatch(source, /cloudApiConfigured/)
  assert.doesNotMatch(source, /webhookConfigured/)
  assert.doesNotMatch(source, /WhatsApp Manager/)
  // Le canal Baileys reste : connexion QR, test d'envoi, templates BL, historique
  assert.match(source, /whatsapp-connection-panel/)
  assert.match(source, /Envoyer un message test WhatsApp/)
})

test('l’historique WhatsApp peut être effacé via un bouton dédié et un endpoint protégé', () => {
  const pageSource = readFileSync(new URL('../src/pages/WhatsAppPage.jsx', import.meta.url), 'utf8')
  const libSource = readFileSync(new URL('../src/lib/fleeti.js', import.meta.url), 'utf8')

  // Frontend : bouton d'effacement confirmé qui appelle clearWhatsAppHistory
  assert.match(pageSource, /Effacer l’historique/)
  assert.match(pageSource, /clearWhatsAppHistory/)
  assert.match(pageSource, /confirmAndRun/)
  assert.match(pageSource, /irréversible/)
  assert.match(libSource, /clearWhatsAppHistory = .*\/api\/whatsapp\/history\/clear/)

  // Backend : endpoint POST protégé par la permission manage_whatsapp qui vide l'historique
  assert.match(serverSource, /app\.post\('\/api\/whatsapp\/history\/clear', requirePermission\('manage_whatsapp'\)/)
  assert.match(serverSource, /writeWhatsAppHistory\(\[\]\)/)
})
