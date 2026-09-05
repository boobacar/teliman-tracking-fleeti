import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveReconnectDelay } from '../src/backend/baileysWhatsAppClient.js'

const MAX = 10
const BASE_MS = 5_000
const MAX_MS = 5 * 60_000

test('backoff exponentiel jusqu à la limite', () => {
  assert.equal(resolveReconnectDelay({ attempts: 1, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), 5_000)
  assert.equal(resolveReconnectDelay({ attempts: 2, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), 10_000)
  assert.equal(resolveReconnectDelay({ attempts: 3, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), 20_000)
  assert.equal(resolveReconnectDelay({ attempts: 4, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), 40_000)
})

test('le délai est plafonné à maxMs (jamais infini)', () => {
  const delay = resolveReconnectDelay({ attempts: MAX, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS })
  assert.ok(Number.isFinite(delay), 'délai doit être fini')
  assert.ok(delay <= MAX_MS, 'délai ne doit pas dépasser maxMs')
  assert.equal(delay, MAX_MS)
})

test('NE JAMAIS abandonner : au-delà de maxAttempts on garde un retry lent permanent', () => {
  // Le bug racine : l ancien code s arrêtait (state=error, plus aucun retry) après
  // maxAttempts. On garantit ici que le délai reste fini et > 0 pour TOUT attempt,
  // donc le setTimeout de reconnexion est toujours reprogrammé.
  for (const attempts of [MAX + 1, MAX + 2, 50, 500]) {
    const delay = resolveReconnectDelay({ attempts, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS })
    assert.ok(Number.isFinite(delay), `attempt ${attempts}: délai doit être fini`)
    assert.ok(delay > 0, `attempt ${attempts}: délai doit être > 0 (pas d abandon)`)
    assert.ok(delay <= MAX_MS, `attempt ${attempts}: délai doit rester borné`)
    assert.equal(delay, MAX_MS, `attempt ${attempts}: retry lent permanent`)
  }
})

test('attempts <= 0 renvoie un délai de base (robustesse)', () => {
  assert.equal(resolveReconnectDelay({ attempts: 0, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), BASE_MS)
  assert.equal(resolveReconnectDelay({ attempts: -3, maxAttempts: MAX, baseMs: BASE_MS, maxMs: MAX_MS }), BASE_MS)
})

test('valeurs par défaut cohérentes (5s de base, 5 min plafond)', () => {
  assert.equal(resolveReconnectDelay({ attempts: 1, maxAttempts: MAX }), 5_000)
  assert.equal(resolveReconnectDelay({ attempts: MAX + 1, maxAttempts: MAX }), 5 * 60_000)
})
