import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const DATA_PAGE_SOURCE = readFileSync(new URL('../src/pages/DataPage.jsx', import.meta.url), 'utf8')

test('les destinataires alertes WhatsApp utilisent des checkbox pour choisir une ou deux alertes', () => {
  const alertSection = DATA_PAGE_SOURCE.slice(
    DATA_PAGE_SOURCE.indexOf('title="Destinataires alertes WhatsApp"'),
    DATA_PAGE_SOURCE.indexOf('title="Numéro bon de commande"'),
  )

  assert.ok(alertSection.includes('Alertes à recevoir'))
  assert.ok(alertSection.includes('type="checkbox"'))
  assert.ok(alertSection.includes('checked={alertRecipientTypes.includes(\'speedup\')}'))
  assert.ok(alertSection.includes('checked={alertRecipientTypes.includes(\'excessive_parking\')}'))
  assert.ok(!alertSection.includes('<select'))
})
