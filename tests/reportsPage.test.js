import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const reportsPageSource = fs.readFileSync(new URL('../src/pages/ReportsPage.jsx', import.meta.url), 'utf8')

test('la page Rapports restaure les anciens rapports opérationnels', () => {
  const expectedReports = [
    'SYNTHESE OPERATIONNELLE',
    'FLOTTE & TRAJETS',
    'ALERTES',
    'MISSIONS',
    'TABLEAU CROISE',
    'LIVRAISONS DETAILLEES',
    'PAR CLIENT',
    'PAR PRODUIT',
    'PAR CAMION',
    'PAR DESTINATION',
    'PERFORMANCE CHAUFFEURS',
    'PERFORMANCE JOURNALIERE',
    'SYNTHESE CARBURANT',
    'LOTS / OBJECTIFS',
    'PROJETS',
  ]

  for (const label of expectedReports) {
    assert.match(reportsPageSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(reportsPageSource, /OPERATIONAL_REPORT_TYPES/)
  assert.match(reportsPageSource, /selectedOperationalReport/)
})

test('la table des rapports opérationnels formate proprement les objets au lieu de JSON brut', () => {
  assert.match(reportsPageSource, /formatObjectAsInlineSummary/)
  assert.match(reportsPageSource, /entries\.join\(' · '\)/)
  assert.doesNotMatch(reportsPageSource, /typeof value === 'object'\) return JSON\.stringify\(value\)/)
})

test('la table générique déplie les sous-clés des colonnes objet \(ex: pivot values\)', () => {
  assert.match(reportsPageSource, /const firstObject = rows\.find/)
  assert.match(reportsPageSource, /nestedKeys\.forEach/)
  assert.match(reportsPageSource, /key: `\$\{key\}\.\$\{nestedKey\}`/)
})
