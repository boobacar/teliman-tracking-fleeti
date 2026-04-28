import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDriverSummaries,
  buildDriverReportTotals,
  deliveryActivityDate,
  latestDeliveryActivityYmd,
} from '../src/lib/driverReport.js'

test('deliveryActivityDate utilise completedAt quand date est vide', () => {
  assert.equal(deliveryActivityDate({ date: null, completedAt: '2026-04-25T01:59:25.116Z' }), '2026-04-25T01:59:25.116Z')
})

test('buildDriverSummaries agrège les BL chauffeur avec date vide mais completedAt renseigné', () => {
  const summaries = buildDriverSummaries({
    from: '2026-04-25',
    to: '2026-04-25',
    filteredTrackers: [{ id: 3537762, label: '3216WWCI01', state: { movement_status: 'moving', gps: { location: { lat: 7.1, lng: -5.2 }, speed: 42 } } }],
    deliveryOrders: [
      { id: 1, reference: '0001721', date: null, completedAt: '2026-04-25T01:59:25.116Z', driver: 'BAMBA LAMA', truckLabel: '3216WWCI01', trackerId: 3537762, quantity: '55,160', client: 'K1 MINE', destination: 'Mine' },
      { id: 2, reference: '0001822', date: null, completedAt: '2026-04-25T01:55:09.292Z', driver: 'BAMBA LAMA', truckLabel: '3216WWCI01', trackerId: 3537762, quantity: '53,180', client: 'K1 MINE', destination: 'Mine' },
      { id: 3, reference: 'OLD', date: '2026-04-24T10:00:00Z', driver: 'AUTRE', quantity: '10', client: 'X', destination: 'Y' },
    ],
  })

  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].driver, 'BAMBA LAMA')
  assert.equal(summaries[0].blCount, 2)
  assert.equal(Number(summaries[0].totalTonnage.toFixed(3)), 108.34)
  assert.equal(summaries[0].currentLocation, '7.10000, -5.20000')
})

test('latestDeliveryActivityYmd prend la dernière activité exploitable', () => {
  assert.equal(latestDeliveryActivityYmd([
    { reference: 'A', date: '2026-04-24T10:00:00Z' },
    { reference: 'B', date: null, completedAt: '2026-04-25T01:59:25.116Z' },
  ]), '2026-04-25')
})

test('buildDriverSummaries affiche aussi les chauffeurs assignés sans BL sur la période', () => {
  const summaries = buildDriverSummaries({
    from: '2026-04-25',
    to: '2026-04-25',
    filteredTrackers: [
      { id: 3537762, label: '3216WWCI01', employeeName: 'BAMBA LAMA', state: { movement_status: 'moving', gps: { location: { lat: 7.1, lng: -5.2 }, speed: 42 } } },
      { id: 3580652, label: '5273WWCI01', employeeName: 'MAKO DOSSO', state: { movement_status: 'idle', gps: { location: { lat: 8.1, lng: -6.2 }, speed: 0 } } },
    ],
    deliveryOrders: [
      { id: 1, date: null, completedAt: '2026-04-25T01:59:25.116Z', driver: 'BAMBA LAMA', truckLabel: '3216WWCI01', trackerId: 3537762, quantity: '55,160', client: 'K1 MINE', destination: 'Mine' },
    ],
  })

  assert.equal(summaries.length, 2)
  assert.deepEqual(summaries.map((item) => item.driver), ['BAMBA LAMA', 'MAKO DOSSO'])
  const inactive = summaries.find((item) => item.driver === 'MAKO DOSSO')
  assert.equal(inactive.blCount, 0)
  assert.equal(inactive.totalTonnage, 0)
  assert.equal(inactive.truckLabel, '5273WWCI01')
  assert.equal(inactive.currentLocation, '8.10000, -6.20000')
})

test('buildDriverReportTotals calcule les indicateurs de synthèse', () => {
  const totals = buildDriverReportTotals([
    { driver: 'A', blCount: 2, totalTonnage: 12.5, clients: ['C1'], truckLabel: 'T1' },
    { driver: 'B', blCount: 1, totalTonnage: 3, clients: ['C1', 'C2'], truckLabel: 'T2' },
  ])

  assert.deepEqual(totals, { drivers: 2, blCount: 3, tonnage: 15.5, clients: 2, trucks: 2 })
})
