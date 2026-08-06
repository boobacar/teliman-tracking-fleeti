import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboardSource = readFileSync(new URL('../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

test('le dashboard expose 12 indicateurs journaliers cliquables', () => {
  const kpiIds = ['flotte', 'actifs', 'mouvement', 'offline', 'surveillance', 'speedup', 'parking', 'carburant', 'km', 'missions', 'livraisons', 'alertes']
  for (const id of kpiIds) {
    assert.match(dashboardSource, new RegExp(`id: '${id}'`), `KPI manquant : ${id}`)
  }
  assert.match(dashboardSource, /kpis\.map\(\(kpi\) =>/)
  assert.match(dashboardSource, /aria-label="Indicateurs journaliers cliquables"/)
})

test('chaque KPI ouvre une liste filtrée ou navigue', () => {
  assert.match(dashboardSource, /function KpiCard/)
  assert.match(dashboardSource, /kpiFocus/)
  assert.match(dashboardSource, /focusedKpi/)
  assert.match(dashboardSource, /Ouvrir sur la carte/)
  assert.match(dashboardSource, /kpi\.navigate/)
  assert.match(dashboardSource, /navigate: '\/delivery-orders'/)
  assert.match(dashboardSource, /navigate: '\/alerts'/)
})

test('les compteurs métier du dashboard sont calculés', () => {
  assert.match(dashboardSource, /eventCounts\?\.speedup/)
  assert.match(dashboardSource, /eventCounts\?\.excessive_parking/)
  assert.match(dashboardSource, /eventCounts\?\.fuel_level_leap/)
  assert.match(dashboardSource, /latestDayMileage/)
  assert.match(dashboardSource, /deliveryOrders \|\| \[\]\)\.filter\(\(order\) => order\.active\)/)
  assert.match(dashboardSource, /statusCounts\?\.new/)
})

test('le dashboard reçoit les BL et les événements pour les KPI mission/alertes', () => {
  assert.match(appSource, /deliveryOrders=\{deliveryOrders\} importantEvents=\{importantEvents\} \/>/) // on DashboardPage
})
