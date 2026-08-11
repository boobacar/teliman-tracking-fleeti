import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackendUrl } from '../src/lib/backendUrl.js'

test('normalizeBackendUrl corrige le domaine API mal orthographié taliman vers teliman', () => {
  assert.equal(
    normalizeBackendUrl('https://api.talimanlogistique.com/'),
    'https://api.telimanlogistique.com',
  )
})

test('normalizeBackendUrl utilise la même origine sur un hôte local (SPA + API sur le même Express)', () => {
  // Vite (dev) proxy /api et /uploads vers 8787 ; en prod la SPA est servie par
  // Express lui-même. L'URL absolue locale n'est donc jamais nécessaire.
  assert.equal(normalizeBackendUrl('', { currentFrontendHost: 'localhost' }), '')
  assert.equal(normalizeBackendUrl('', { currentFrontendHost: '127.0.0.1' }), '')
  assert.equal(normalizeBackendUrl('', { currentFrontendHost: 'home-server-1.tail660cfd.ts.net' }), '')
})

test('normalizeBackendUrl ignore une VITE_BACKEND_URL périmée (ancienne IP Tailscale hors ligne) sur hôte privé', () => {
  assert.equal(normalizeBackendUrl('http://100.65.78.40:8787', { currentFrontendHost: '127.0.0.1' }), '')
  assert.equal(normalizeBackendUrl('http://100.65.78.40:8787', { currentFrontendHost: '100.67.148.58' }), '')
  assert.equal(normalizeBackendUrl('http://100.65.78.40:8787', { currentFrontendHost: 'home-server-1.tail660cfd.ts.net' }), '')
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

test('normalizeBackendUrl appelle DIRECTEMENT le backend public depuis Vercel (proxy /api instable, 502 DNS)', () => {
  assert.equal(
    normalizeBackendUrl('', { currentFrontendHost: 'teliman-tracking-fleeti.vercel.app' }),
    'https://home-server-1.tail660cfd.ts.net',
  )
  // Une vieille VITE_BACKEND_URL privée (IP Tailscale hors ligne) est aussi corrigée
  assert.equal(
    normalizeBackendUrl('http://100.65.78.40:8787', { currentFrontendHost: 'teliman-tracking-fleeti.vercel.app' }),
    'https://home-server-1.tail660cfd.ts.net',
  )
})
