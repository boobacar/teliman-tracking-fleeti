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

test('le numéro API WhatsApp Teliman est centralisé sur la page', () => {
  const pageSource = readFileSync(new URL('../src/pages/WhatsAppPage.jsx', import.meta.url), 'utf8')

  assert.match(pageSource, /\+225 07 00 184 839/)
  assert.match(pageSource, /2250700184839/)
  assert.match(pageSource, /wa\.me\//)
})

test('les utilisateurs opérationnels reçoivent la permission page_whatsapp par défaut', () => {
  assert.match(serverSource, /page_whatsapp/)
})
