// Routage des alertes : qui reçoit quoi (logique pure + aller-retour SQLite réel).
import { mkdtempSync, rmSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALERT_CATEGORIES,
  defaultCategoriesFor,
  describeRecipientRouting,
  isValidAlertCategory,
  recipientWantsEvent,
  resolveRoutedRecipients,
  subscriptionAllows,
  validateSubscriptionInput,
} from '../src/backend/alertRouting.js'
import {
  closeDatabase,
  deleteAlertRecipient,
  initDatabase,
  insertAlertRecipient,
  insertAlertSubscription,
  readAlertRecipients,
  readAlertSubscriptions,
  updateAlertSubscription,
} from '../src/backend/database.js'

const INTERNAL = { id: 1, name: 'Boubacar', phone: '+221 77 620 00 20', scope: 'internal', active: true }
const CLIENT_A = { id: 2, name: 'Contact Lafarge', phone: '225 07 04 44 66 83', scope: 'client', clientName: 'LAFARGE', active: true }
const CLIENT_B = { id: 3, name: 'Contact K1', phone: '225 07 68 75 67 47', scope: 'client', clientName: 'K1 MINE', active: true }

test('sans règle, un destinataire interne garde le comportement historique', () => {
  assert.deepEqual(defaultCategoriesFor(INTERNAL), ['geofence_enter', 'geofence_exit', 'fleet_speedup', 'fleet_parking'])
  const context = { category: 'geofence_enter' }
  assert.equal(recipientWantsEvent(INTERNAL, [], context), true)
  assert.equal(recipientWantsEvent(INTERNAL, [], { category: 'fleet_speedup' }), true)
  // …et ne reçoit pas les messages destinés aux clients
  assert.equal(recipientWantsEvent(INTERNAL, [], { category: 'bl_departed', clientName: 'LAFARGE' }), false)
})

test('sans règle, un contact client ne reçoit QUE les bornes de ses missions', () => {
  assert.deepEqual(defaultCategoriesFor(CLIENT_A), ['bl_departed', 'bl_arrived'])
  assert.equal(recipientWantsEvent(CLIENT_A, [], { category: 'bl_departed', clientName: 'lafarge' }), true)
  assert.equal(recipientWantsEvent(CLIENT_A, [], { category: 'bl_arrived', clientName: 'LAFARGE' }), true)
  // Autre client → silence
  assert.equal(recipientWantsEvent(CLIENT_A, [], { category: 'bl_departed', clientName: 'K1 MINE' }), false)
  // Jamais les alertes internes de zone
  assert.equal(recipientWantsEvent(CLIENT_A, [], { category: 'geofence_enter', zoneId: 1 }), false)
})

test('une règle explicite bascule le destinataire en mode personnalisé (il ne reçoit plus que ce qui est coché)', () => {
  const subscriptions = [{ id: 10, recipientId: 1, category: 'geofence_exit', scopeType: 'all', scopeValue: '', active: true }]
  // Seule la catégorie cochée passe…
  assert.equal(recipientWantsEvent(INTERNAL, subscriptions, { category: 'geofence_exit' }), true)
  // …même les catégories historiquement reçues sont désormais exclues
  assert.equal(recipientWantsEvent(INTERNAL, subscriptions, { category: 'geofence_enter' }), false)
  assert.equal(recipientWantsEvent(INTERNAL, subscriptions, { category: 'fleet_speedup' }), false)
})

test('une règle peut se limiter à une zone, un camion ou un client', () => {
  const zoneRule = { recipientId: 1, category: 'geofence_enter', scopeType: 'zone', scopeValue: '1', active: true }
  assert.equal(subscriptionAllows(zoneRule, { category: 'geofence_enter', zoneId: 1 }), true)
  assert.equal(subscriptionAllows(zoneRule, { category: 'geofence_enter', zoneId: 5 }), false)

  const truckRule = { recipientId: 1, category: 'fleet_speedup', scopeType: 'truck', scopeValue: '4400WWCI01', active: true }
  assert.equal(subscriptionAllows(truckRule, { category: 'fleet_speedup', truckLabel: '4400wwci01' }), true)
  assert.equal(subscriptionAllows(truckRule, { category: 'fleet_speedup', truckLabel: '5273WWCI01' }), false)

  const clientRule = { recipientId: 2, category: 'bl_arrived', scopeType: 'client', scopeValue: 'Lafarge', active: true }
  assert.equal(subscriptionAllows(clientRule, { category: 'bl_arrived', clientName: 'LAFARGE' }), true)
  assert.equal(subscriptionAllows(clientRule, { category: 'bl_arrived', clientName: 'K1 MINE' }), false)

  // Une règle désactivée ne compte pas
  assert.equal(subscriptionAllows({ ...zoneRule, active: false }, { category: 'geofence_enter', zoneId: 1 }), false)
})

test('resolveRoutedRecipients déduplique par numéro et respecte chaque mode', () => {
  const recipients = [INTERNAL, CLIENT_A, CLIENT_B, { ...CLIENT_B, id: 4, name: 'Doublon K1', phone: '2250768756747' }]
  const routed = resolveRoutedRecipients({ recipients, subscriptions: [], category: 'geofence_enter', context: { zoneId: 1 } })
  assert.deepEqual(routed.map((recipient) => recipient.id), [1], 'seul l interne reçoit une entrée de zone')

  const arrived = resolveRoutedRecipients({ recipients, subscriptions: [], category: 'bl_arrived', context: { clientName: 'K1 MINE' } })
  assert.deepEqual(arrived.map((recipient) => String(recipient.phone).replace(/\D/g, '')), ['2250768756747'], 'un seul message malgré deux contacts identiques')
})

test('describeRecipientRouting expose le mode et les portées (pour l’interface)', () => {
  assert.equal(describeRecipientRouting(INTERNAL, []).mode, 'default')
  const custom = describeRecipientRouting(INTERNAL, [
    { id: 7, recipientId: 1, category: 'geofence_enter', scopeType: 'zone', scopeValue: '1', active: true },
  ])
  assert.equal(custom.mode, 'custom')
  assert.deepEqual(custom.categories, [{ id: 7, key: 'geofence_enter', label: 'Entrée de zone', scopeType: 'zone', scopeValue: '1' }])
})

test('validateSubscriptionInput refuse les catégories et portées invalides', () => {
  assert.equal(isValidAlertCategory('geofence_enter'), true)
  assert.equal(isValidAlertCategory('nimporte_quoi'), false)
  assert.throws(() => validateSubscriptionInput({ recipientId: 0, category: 'geofence_enter' }), /Destinataire invalide/)
  assert.throws(() => validateSubscriptionInput({ recipientId: 1, category: 'inconnue' }), /inconnue/)
  // Un rapport ne se restreint pas à une zone
  assert.throws(() => validateSubscriptionInput({ recipientId: 1, category: 'report_daily', scopeType: 'zone', scopeValue: '1' }), /impossible/)
  // Portée sans valeur → refus
  assert.throws(() => validateSubscriptionInput({ recipientId: 1, category: 'geofence_enter', scopeType: 'zone', scopeValue: '  ' }), /manquante/)
  // Portée « tout » → valeur nettoyée
  assert.deepEqual(
    validateSubscriptionInput({ recipientId: '1', category: 'geofence_enter', scopeType: 'all', scopeValue: 'ignore' }),
    { recipientId: 1, category: 'geofence_enter', scopeType: 'all', scopeValue: '' },
  )
  assert.equal(ALERT_CATEGORIES.length >= 9, true)
})

test('les règles survivent au cycle SQLite et partent avec le destinataire supprimé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'teliman-alert-routing-'))
  const dbPath = join(dir, 'teliman.db')
  try {
    initDatabase(dbPath)
    const recipient = insertAlertRecipient({ name: 'Amsatou', phone: '221776813582' })
    const rule = insertAlertSubscription({ recipientId: recipient.id, category: 'geofence_exit', scopeType: 'all' })
    assert.equal(rule.active, true)

    // Re-cocher une règle existante ne crée pas de doublon
    const again = insertAlertSubscription({ recipientId: recipient.id, category: 'geofence_exit', scopeType: 'all' })
    assert.equal(again.id, rule.id)
    assert.equal(readAlertSubscriptions().filter((item) => item.category === 'geofence_exit').length, 1)

    // Désactivation puis suppression
    updateAlertSubscription(rule.id, { active: false })
    assert.equal(readAlertSubscriptions()[0].active, false)

    // Une portée peut être précisée ensuite
    const scoped = insertAlertSubscription({ recipientId: recipient.id, category: 'bl_arrived', scopeType: 'client', scopeValue: 'LAFARGE' })
    assert.equal(scoped.scopeType, 'client')
    assert.equal(readAlertRecipients()[0].id, recipient.id)

    // Supprimer le destinataire emporte ses règles
    deleteAlertRecipient(recipient.id)
    assert.equal(readAlertRecipients().length, 0)
    assert.equal(readAlertSubscriptions().length, 0)
  } finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})
