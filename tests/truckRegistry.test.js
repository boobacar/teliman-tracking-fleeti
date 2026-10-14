// Parc officiel : les nouvelles immatriculations doivent s'afficher partout (API,
// messages WhatsApp) sans jamais réécrire la base, qui reste alignée sur le GPS.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  OFFICIAL_TRUCKS,
  applyRegistryToPayload,
  canonicalLabel,
  driverFor,
  getTruckRegistry,
  normalizeTruckLabel,
  plateFor,
} from '../src/backend/truckRegistry.js'

test('affichage : immatriculations remplacées dans les champs concernés', () => {
  const payload = {
    orders: [{ truckLabel: '39151WWCI01', driver: 'SARIA YACOUBA', label: '3952WWCI01' }],
    fleet: { items: [{ label: '3216WWCI01', trackerId: 42 }] },
    events: [{ trackerLabel: '45792WWCI01' }],
  }
  const result = applyRegistryToPayload(payload)
  assert.equal(result.orders[0].truckLabel, 'AB246JJ')
  assert.equal(result.orders[0].label, 'AB229JJ')
  assert.equal(result.fleet.items[0].label, '602605WWCI01')
  assert.equal(result.fleet.items[0].trackerId, 42, 'les identifiants ne sont pas touchés')
  assert.equal(result.events[0].trackerLabel, 'AB154GR')
  assert.equal(result.orders[0].driver, 'Yacouba SARIA', 'le chauffeur officiel accompagne la plaque officielle')
})

test('affichage : les textes libres et les valeurs inconnues restent intacts', () => {
  const payload = {
    notes: 'Relire le BL de 39151WWCI01 avant clôture',
    client: 'LAFARGE',
    driver: 'Boubacar FALL',
    label: 'CAMION-INCONNU',
    quantity: '40,000',
  }
  const result = applyRegistryToPayload(payload)
  assert.equal(result.notes, 'Relire le BL de 39151WWCI01 avant clôture')
  assert.equal(result.client, 'LAFARGE')
  assert.equal(result.driver, 'Boubacar FALL', 'un chauffeur sans camion connu reste tel quel')
  assert.equal(result.label, 'CAMION-INCONNU')
  assert.equal(result.quantity, '40,000')
})

test('enregistrement : la plaque affichée repart vers l’étiquette GPS', () => {
  const body = { truckLabel: 'AB246JJ', driver: 'Yacouba SARIA', notes: 'AB246JJ à vérifier' }
  applyRegistryToPayload(body, { direction: 'storage' })
  assert.equal(body.truckLabel, '39151WWCI01')
  assert.equal(body.notes, 'AB246JJ à vérifier')
  // Une ancienne étiquette saisie directement reste l'ancienne étiquette.
  const legacy = { truckLabel: '3952WWCI01' }
  applyRegistryToPayload(legacy, { direction: 'storage' })
  assert.equal(legacy.truckLabel, '3952WWCI01')
})

test('parc officiel : plaques, chauffeurs, formats et coquilles', () => {
  assert.equal(plateFor('3100WWC101'), '602607WWCI01')
  assert.equal(plateFor('39151wwci01'), 'AB246JJ', 'casse ignorée')
  assert.equal(plateFor(' 4400WWCI01 '), '602606WWCI01', 'espaces ignorés')
  assert.equal(driverFor('45792WWCI01'), 'Yacouba DIOMANDE')
  assert.equal(normalizeTruckLabel('3100WWC101'), '3100WWCI01')
  assert.equal(canonicalLabel('602606WWCI01'), '4400WWCI01')
  assert.equal(canonicalLabel('PLAQUE-HORS-PARC'), 'PLAQUE-HORS-PARC')
  assert.equal(OFFICIAL_TRUCKS.length, 7)
})

test('parc officiel : fichier de données prioritaire et cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parc-'))
  writeFileSync(join(dir, 'truck-registry.json'), JSON.stringify({
    trucks: [{ oldLabel: '9999WWCI01', plate: 'AB999XX', driver: 'Test CHAUFFEUR' }],
  }))
  const entries = getTruckRegistry(dir)
  assert.equal(entries.length, 1)
  assert.equal(plateFor('9999WWCI01', { entries }), 'AB999XX')
  assert.equal(getTruckRegistry(dir), entries, 'le cache renvoie la même référence')
  rmSync(dir, { recursive: true, force: true })
})
