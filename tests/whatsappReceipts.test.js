// Accusés de réception WhatsApp : sans ce suivi, un rapport marqué « envoyé » pouvait ne
// jamais atteindre le destinataire sans que rien ne le signale (cas du rapport de Mado).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReceiptTracker } from '../src/backend/baileysWhatsAppClient.js'

test('statut WhatsApp : livré au téléphone, lu ensuite', () => {
  const tracker = createReceiptTracker()
  assert.equal(tracker.classify(1), '', 'en attente : rien à signaler')
  assert.equal(tracker.classify(2), '', 'accepté par le serveur : le journal a déjà « envoyé »')
  assert.equal(tracker.classify(3), 'delivered')
  assert.equal(tracker.classify(4), 'read')
  assert.equal(tracker.classify(5), 'read')
  assert.equal(tracker.classify(undefined), '')
})

test('un message envoyé est suivi jusqu’à son accusé', () => {
  const tracker = createReceiptTracker()
  tracker.remember('MSG1', { to: '221771234567', kind: 'document', status: 'sent' })
  const known = tracker.resolve('MSG1')
  assert.equal(known.to, '221771234567')
  assert.equal(known.kind, 'document')
  assert.ok(known.at, 'l’horodatage d’envoi est mémorisé')
  tracker.remember('MSG1', { ...known, status: 'delivered' })
  assert.equal(tracker.resolve('MSG1').status, 'delivered')
  tracker.forget('MSG1')
  assert.equal(tracker.resolve('MSG1'), null)
})

test('identifiant vide : rien n’est mémorisé', () => {
  const tracker = createReceiptTracker()
  tracker.remember('', { to: 'x' })
  assert.equal(tracker.size, 0)
  assert.equal(tracker.resolve(''), null)
})

test('la mémoire est bornée (pas de fuite sur un long service)', () => {
  const tracker = createReceiptTracker({ maxEntries: 3 })
  for (const id of ['A', 'B', 'C', 'D']) tracker.remember(id, { to: 'x', status: 'sent' })
  assert.equal(tracker.size, 3)
  assert.equal(tracker.resolve('A'), null, 'le plus ancien est oublié')
  assert.ok(tracker.resolve('D'), 'le plus récent est conservé')
})
