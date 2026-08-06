import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const layoutSource = readFileSync(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('la version et le commit sont injectés au build et affichés dans la sidebar', () => {
  assert.match(viteConfig, /__APP_VERSION__/)
  assert.match(viteConfig, /__APP_COMMIT__/)
  assert.match(pkg.scripts.build, /VITE_COMMIT=\$\(git rev-parse --short HEAD/)
  assert.match(layoutSource, /__APP_VERSION__/)
  assert.match(layoutSource, /__APP_COMMIT__/)
  assert.match(layoutSource, /sidebar-version/)
})

test('le déploiement vérifié est scripté (tests → build → backup → restart → health)', () => {
  assert.ok(existsSync(new URL('../scripts/deploy.sh', import.meta.url)), 'scripts/deploy.sh absent')
  const script = readFileSync(new URL('../scripts/deploy.sh', import.meta.url), 'utf8')
  assert.match(script, /npm test/)
  assert.match(script, /npm run build/)
  assert.match(script, /cp -r dist/)
  assert.match(script, /pm2 restart teliman-tracking-fleeti/)
  assert.match(script, /\/api\/health\/live/)
})
