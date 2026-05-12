import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')

test('delivery proof uploads are served from the configured runtime uploads directory', () => {
  assert.match(
    serverSource,
    /app\.use\('\/uploads',\s*express\.static\(UPLOADS_BASE_DIR\)\)/,
    'Express must serve /uploads from TELIMAN_UPLOADS_DIR/UPLOADS_BASE_DIR, not from the repo-local uploads directory',
  )
})
