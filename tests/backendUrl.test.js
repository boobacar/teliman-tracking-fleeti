import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackendUrl } from '../src/lib/backendUrl.js'

test('normalizeBackendUrl corrige le domaine API mal orthographié taliman vers teliman', () => {
  assert.equal(
    normalizeBackendUrl('https://api.talimanlogistique.com/'),
    'https://api.telimanlogistique.com',
  )
})

test('normalizeBackendUrl garde le fallback localhost si aucune URL backend n’est fournie', () => {
  assert.equal(normalizeBackendUrl(''), 'http://localhost:8787')
})
