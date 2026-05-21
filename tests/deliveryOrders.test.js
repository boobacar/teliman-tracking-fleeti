import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeDeliveryOrders,
  formatDeliveryQuantity,
  normalizeDeliveryQuantity,
  normalizeDeliveryReference,
  parseDeliveryQuantity,
} from '../src/lib/deliveryOrders.js'

test('parseDeliveryQuantity accepts values with comma decimals and trailing T', () => {
  assert.equal(parseDeliveryQuantity('52,660T'), 52.66)
  assert.equal(parseDeliveryQuantity('51,540 t'), 51.54)
  assert.equal(parseDeliveryQuantity('49.180'), 49.18)
  assert.equal(parseDeliveryQuantity(''), 0)
})

test('normalizeDeliveryQuantity stores a single canonical format without T suffix', () => {
  assert.equal(normalizeDeliveryQuantity('52,660T'), '52,660')
  assert.equal(formatDeliveryQuantity('52,660T'), '52,660')
})

test('normalizeDeliveryReference treats padded BL numbers as the same reference', () => {
  assert.equal(normalizeDeliveryReference('BL 0002825'), '2825')
  assert.equal(normalizeDeliveryReference('0002825'), '2825')
})

test('dedupeDeliveryOrders keeps one row per BL reference and preserves parseable quantity', () => {
  const { rows, removed } = dedupeDeliveryOrders([
    { id: 1, reference: '0002825', quantity: '52,680', date: '2026-05-21T11:27:37.683Z', status: 'Prévu' },
    { id: 2, reference: 'BL 0002825', quantity: '52,660T', date: '2026-05-20T10:24:00.000Z', status: 'Livré' },
    { id: 3, reference: '0002826', quantity: '51,540T', date: '2026-05-20T10:32:00.000Z' },
  ])

  assert.equal(removed, 1)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => normalizeDeliveryReference(row.reference)).sort(), ['2825', '2826'])
  assert.equal(parseDeliveryQuantity(rows.find((row) => normalizeDeliveryReference(row.reference) === '2825')?.quantity), 52.66)
  assert.equal(rows.find((row) => normalizeDeliveryReference(row.reference) === '2825')?.status, 'Livré')
})
