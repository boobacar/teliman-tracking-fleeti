import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackendUrl } from '../src/lib/backendUrl.js'

test('normalizeBackendUrl corrige le domaine API mal orthographié taliman vers teliman', () => {
  assert.equal(
    normalizeBackendUrl('https://api.talimanlogistique.com/'),
    'https://api.telimanlogistique.com',
  )
})

test('normalizeBackendUrl garde le fallback localhost si aucune URL backend n’est fournie en local', () => {
  assert.equal(normalizeBackendUrl('', { currentFrontendHost: 'localhost' }), 'http://localhost:8787')
})

test('normalizeBackendUrl bascule vers l’API publique quand un autre frontend public reçoit une URL backend privée', () => {
  assert.equal(
    normalizeBackendUrl('https://home-server.tail660cfd.ts.net', { currentFrontendHost: 'example.com' }),
    'https://home-server-1.tail660cfd.ts.net',
  )
})

test('normalizeBackendUrl utilise l’API publique par défaut si aucun backend n’est fourni sur un frontend public', () => {
  assert.equal(
    normalizeBackendUrl('', { currentFrontendHost: 'example.com' }),
    'https://home-server-1.tail660cfd.ts.net',
  )
})

test('normalizeBackendUrl utilise le proxy même origine sur le déploiement Vercel', () => {
  assert.equal(
    normalizeBackendUrl('https://home-server.tail660cfd.ts.net', { currentFrontendHost: 'teliman-tracking-fleeti.vercel.app' }),
    '',
  )
})
