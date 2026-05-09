import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8')

test('la page et le menu Caméras sont retirés de la navigation principale', () => {
  assert.doesNotMatch(appSource, /CamerasPage/)
  assert.doesNotMatch(appSource, /path="\/cameras"/)
  assert.doesNotMatch(appSource, /\.\/pages\/CamerasPage/)
  assert.doesNotMatch(layoutSource, /id: '\/cameras'/)
  assert.doesNotMatch(layoutSource, /label: 'Caméras'/)
})
