import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMasterDataPayload, normalizeAlertWhatsAppRecipientsMap, normalizeClientPhonesMap } from '../src/backend/masterData.js'

test('normalizeClientPhonesMap conserve plusieurs numéros de téléphone par client', () => {
  assert.deepEqual(normalizeClientPhonesMap({
    ' K1 MINE ': [' +225 07 00 00 00 00 ', '+225 05 00 00 00 00', '+225 07 00 00 00 00'],
    'LAFARGE': '+225 01 00 00 00 00',
    'Client sans numéro': ['   '],
    '': ['+225 01'],
  }), {
    'K1 MINE': ['+225 05 00 00 00 00', '+225 07 00 00 00 00'],
    'LAFARGE': ['+225 01 00 00 00 00'],
  })
})

test('normalizeAlertWhatsAppRecipientsMap conserve les destinataires WhatsApp par type d’alerte', () => {
  assert.deepEqual(normalizeAlertWhatsAppRecipientsMap({
    speedup: [' +225 07 69 28 93 04 ', '+221 77 626 00 20', '+225 07 69 28 93 04'],
    excessive_parking: '+225 05 00 00 00 00',
    fuel_level_leap: ['+225 01 00 00 00 00'],
    unknown: ['+225 99'],
  }), {
    excessive_parking: ['+225 05 00 00 00 00'],
    speedup: ['+221 77 626 00 20', '+225 07 69 28 93 04'],
  })
})

test('buildMasterDataPayload garde les listes de téléphones clients avec les autres référentiels', () => {
  const payload = buildMasterDataPayload({
    clients: ['K1 MINE', 'CADERAC'],
    clientPhones: { 'K1 MINE': ['+225 07 00 00 00 00', '+225 05 00 00 00 00'] },
    purchaseOrders: { 'K1 MINE': 'BC-001' },
    alertWhatsAppRecipients: { speedup: ['+225 07 69 28 93 04'] },
  })

  assert.deepEqual(payload.clientPhones, { 'K1 MINE': ['+225 05 00 00 00 00', '+225 07 00 00 00 00'] })
  assert.deepEqual(payload.alertWhatsAppRecipients, { speedup: ['+225 07 69 28 93 04'] })
  assert.deepEqual(payload.clients, ['CADERAC', 'K1 MINE'])
  assert.deepEqual(payload.purchaseOrders, { 'K1 MINE': 'BC-001' })
})
