// Garde-fou de la couche mobile : si quelqu'un supprime la feuille mobile, retire
// l'annotation des libellés ou la classe des tableaux de liste, ce test échoue.
// Contexte : audit du 13/10/2026 — 1 393 éléments hors écran sur 18 routes en 390 px,
// première carte de bon à 1 026 px (invisible sur un écran de 844 px).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const mobileCss = read('../src/styles/mobile.css')
const mainJsx = read('../src/main.jsx')
const labeler = read('../src/lib/mobileTableLabels.js')

test('la feuille mobile existe et couvre les points clés', () => {
  assert.ok(existsSync(new URL('../src/styles/mobile.css', import.meta.url)))
  assert.match(mobileCss, /@media \(max-width: 720px\)/)
  // 1. Rien ne dépasse la largeur de l'écran
  assert.match(mobileCss, /overflow-x: clip/)
  // 2. Une liste devient une pile de cartes avec libellés
  assert.match(mobileCss, /table\.mobile-cards thead\s*\{\s*display: none/)
  assert.match(mobileCss, /content: attr\(data-label\)/)
  // 3. Un tableau de rapport garde son en-tête et sa première colonne visibles
  assert.match(mobileCss, /position: sticky/)
  // 4. Les formulaires gardent leurs boutons accessibles
  assert.match(mobileCss, /\.delivery-form-actions[\s\S]{0,200}position: sticky/)
  // 5. Les messages sortent en bas, arrondis, au-dessus de la zone tactile système
  assert.match(mobileCss, /\.refresh-toast[\s\S]{0,220}env\(safe-area-inset-bottom\)/)
})

test('la feuille mobile est chargée après App.css (priorité de cascade)', () => {
  const importIndex = mainJsx.indexOf("'./styles/mobile.css'")
  const indexCss = mainJsx.indexOf("'./index.css'")
  assert.ok(importIndex > -1, 'main.jsx doit importer la feuille mobile')
  assert.ok(indexCss > -1 && importIndex > indexCss, 'la feuille mobile doit être importée en dernier')
  assert.match(mainJsx, /startMobileTableLabels\(\)/)
})

test('les libellés des cartes viennent des en-têtes de colonnes', () => {
  assert.match(labeler, /querySelectorAll\(TABLE_SELECTOR\)/)
  assert.match(labeler, /thead th/)
  assert.match(labeler, /setAttribute\('data-label'/)
  // rAF est suspendu dans un onglet en arrière-plan : on doit utiliser setTimeout
  assert.match(labeler, /setTimeout\(/)
  assert.doesNotMatch(labeler, /requestAnimationFrame\(/)
})

test('les tableaux de liste portent la classe mobile-cards', () => {
  for (const [page, minimum] of [['AlertsPage', 1], ['AdminUsersPage', 1], ['OilChangesPage', 2], ['GeofencesPage', 4], ['DashboardPage', 1]]) {
    const source = read(`../src/pages/${page}.jsx`)
    const count = (source.match(/mobile-cards/g) || []).length
    assert.ok(count >= minimum, `${page} doit marquer ses tableaux de liste (${count} trouvé, ${minimum} attendu)`)
  }
})

test('les tableaux de rapport restent des tableaux (pas de cartes)', () => {
  for (const page of ['TripsReportPage', 'DriversReportPage', 'ReportsPage']) {
    const source = read(`../src/pages/${page}.jsx`)
    assert.doesNotMatch(source, /className="reports-table mobile-cards"/, `${page} doit rester en tableau défilant`)
  }
})
