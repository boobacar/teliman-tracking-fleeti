import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fuelVoucherSchema } from '../src/backend/validation.js'

const source = readFileSync(new URL('../src/pages/FuelVouchersPage.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('la page Bons carburant suit le poste de pilotage opérationnel des BL', () => {
  assert.match(source, /<h1>Bons carburant<\/h1>/)
  assert.match(source, /showCreateForm/)
  assert.match(source, /fuel-kpi-grid/)
  assert.match(source, /fuel-operations-table/)
  assert.match(source, /fuel-mobile-card/)
  assert.match(source, /delivery-reset-filters/)
})

test('le formulaire carburant groupe affectation et coût sans modifier le calcul métier', () => {
  assert.match(source, /<legend>Identification<\/legend>/)
  assert.match(source, /<legend>Affectation<\/legend>/)
  assert.match(source, /<legend>Volume et coût<\/legend>/)
  assert.match(source, /Quantité × prix unitaire/)
  assert.match(source, /quantityLiters: toNumber\(form\.quantityLiters\)/)
  assert.match(source, /unitPrice: toNumber\(form\.unitPrice\)/)
})

test('les vues carburant desktop et mobile exposent preuve, chauffeur et actions tactiles', () => {
  assert.match(source, /Chauffeur non renseigné/)
  assert.match(source, /delivery-proof-state/)
  assert.match(source, /className="ghost-btn icon-btn"/)
  assert.match(source, /<Camera size=\{22\}/)
  assert.match(source, /<Trash2 size=\{22\}/)
  assert.match(css, /\.fuel-operations-table\s*\{[\s\S]*min-width:\s*1040px/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.fuel-desktop-table\s*\{\s*display:\s*none/)
})

test('le schéma bon carburant accepte un payload sans amount (calculé côté backend)', () => {
  const result = fuelVoucherSchema.safeParse({
    voucherNumber: 'CARB-001',
    trackerId: '9000001',
    truckLabel: 'Plateau',
    driver: 'XX',
    supplier: 'SHELL BOUAKE',
    dateTime: '2026-08-18T12:00:00.000Z',
    quantityLiters: 100,
    unitPrice: 650,
  })
  assert.equal(result.success, true, JSON.stringify(result.error?.issues))
})
