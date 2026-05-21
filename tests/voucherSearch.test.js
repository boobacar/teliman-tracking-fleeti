import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const deliveryOrdersPageSource = fs.readFileSync(new URL('../src/pages/DeliveryOrdersPage.jsx', import.meta.url), 'utf8')
const fuelVouchersPageSource = fs.readFileSync(new URL('../src/pages/FuelVouchersPage.jsx', import.meta.url), 'utf8')

test('la page Bons livraison propose une recherche multi-colonnes', () => {
  assert.match(deliveryOrdersPageSource, /matchesDeliveryOrderSearch/)
  assert.match(deliveryOrdersPageSource, /Recherche BL/)
  assert.match(deliveryOrdersPageSource, /aria-label="Recherche bons de livraison"/)
  for (const field of ['item.reference', 'item.truckLabel', 'item.driver', 'item.client', 'item.destination', 'item.goods']) {
    assert.match(deliveryOrdersPageSource, new RegExp(field.replace('.', '\\.')))
  }
  assert.match(deliveryOrdersPageSource, /statusOk && trackerOk && clientOk && dateOk && searchOk/)
})

test('la page Bons carburant propose une recherche multi-colonnes', () => {
  assert.match(fuelVouchersPageSource, /matchesFuelVoucherSearch/)
  assert.match(fuelVouchersPageSource, /Recherche carburant/)
  assert.match(fuelVouchersPageSource, /aria-label="Recherche bons de carburant"/)
  for (const field of ['item.voucherNumber', 'item.truckLabel', 'item.driver', 'item.supplier']) {
    assert.match(fuelVouchersPageSource, new RegExp(field.replace('.', '\\.')))
  }
  assert.match(fuelVouchersPageSource, /trackerOk && dateOk && searchOk/)
})
