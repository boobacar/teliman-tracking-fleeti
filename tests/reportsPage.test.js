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
