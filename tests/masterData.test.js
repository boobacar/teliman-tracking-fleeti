import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMasterDataPayload, normalizeClientPhonesMap } from '../src/backend/masterData.js'

test('normalizeClientPhonesMap conserve un numéro de téléphone par client', () => {
  assert.deepEqual(normalizeClientPhonesMap({
    ' K1 MINE ': ' +225 07 00 00 00 00 ',
    'Client sans numéro': '   ',
    '': '+225 01',
  }), {
    'K1 MINE': '+225 07 00 00 00 00',
  })
})

test('buildMasterDataPayload garde les téléphones clients avec les autres référentiels', () => {
  const payload = buildMasterDataPayload({
    clients: ['K1 MINE', 'CADERAC'],
    clientPhones: { 'K1 MINE': '+225 07 00 00 00 00' },
    purchaseOrders: { 'K1 MINE': 'BC-001' },
  })

  assert.deepEqual(payload.clientPhones, { 'K1 MINE': '+225 07 00 00 00 00' })
  assert.deepEqual(payload.clients, ['CADERAC', 'K1 MINE'])
  assert.deepEqual(payload.purchaseOrders, { 'K1 MINE': 'BC-001' })
})
