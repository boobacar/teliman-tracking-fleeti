import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SERVICE_WORKER_SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

test('le service worker laisse passer les requêtes vers le backend public externe', () => {
  assert.match(SERVICE_WORKER_SOURCE, /if \(url\.origin !== self\.location\.origin\) return/)
  assert.ok(
    SERVICE_WORKER_SOURCE.indexOf('url.origin !== self.location.origin')
      < SERVICE_WORKER_SOURCE.indexOf("url.pathname.startsWith('/api/')"),
  )
})