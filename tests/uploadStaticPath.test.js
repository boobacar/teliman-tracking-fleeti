import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')

test('delivery proof uploads are authenticated and served from the configured runtime directory', () => {
  assert.match(
    serverSource,
    /app\.use\('\/uploads',[\s\S]+getSessionUser\(req\)[\s\S]+express\.static\(UPLOADS_BASE_DIR/,
    'Express must authenticate /uploads and serve TELIMAN_UPLOADS_DIR/UPLOADS_BASE_DIR',
  )
  assert.match(serverSource, /Cache-Control', 'no-store'/)
  assert.match(serverSource, /X-Content-Type-Options', 'nosniff'/)
})
