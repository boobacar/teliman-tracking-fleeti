// PDF officiel du rapport : les sections du rapport doivent être transposées sans
// perte, et le document doit réellement se compiler.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildReportPdfInput, renderReportPdf, REPORT_PDF_TEMPLATE } from '../src/backend/reportPdf.js'

const SECTIONS = {
  header: 'TELIMAN LOGISTIQUE - Rapport journalier du 14/10/2026 (20h)',
  day: '2026-10-14',
  general: { activeTrucks: 2, fleetSize: 8, missions: 3, zones: [{ label: 'Korhogo', count: 1 }] },
  actives: [{ plate: 'AB246JJ', driver: 'Yacouba SARIA', missions: [{ client: 'LAFARGE', route: 'Bouaké → Korhogo', goods: 'CIMENT CPJ', count: 2, departure: '12h05', closing: '13h23', status: 'Livré', quantity: '50' }], zones: [{ text: 'Fadiadougou, mine — 4 passages (5h48 → 8h26)' }], position: 'Bouaké', distanceKm: 143, driving: '3h16', rest: '13h14', incidents: [{ label: 'stationnements prolongés', count: 7 }] }],
  inactives: [{ plate: '602604WWCI01', driver: 'Adama CAMARA', reason: 'Pas de mission' }],
  quantities: [{ client: 'LAFARGE', missions: 2, charged: '50', delivered: '50', inProgress: '0' }],
}

test('mise en forme pour le gabarit : aucune section perdue', () => {
  const input = buildReportPdfInput(SECTIONS, { dateLabel: '14/10/2026' })
  assert.equal(input.date, '14/10/2026')
  assert.equal(input.general.activeTrucks, 2)
  assert.equal(input.general.fleetSize, 8)
  assert.equal(input.general.zones.length, 1)
  assert.equal(input.actives.length, 1)
  assert.equal(input.actives[0].missions[0].client, 'LAFARGE')
  assert.equal(input.inactives[0].plate, '602604WWCI01')
  assert.equal(input.quantities[0].charged, '50')
})

test('mise en forme : sections absentes remplacées par des listes vides', () => {
  const input = buildReportPdfInput({}, { dateLabel: '' })
  assert.deepEqual(input.actives, [])
  assert.deepEqual(input.inactives, [])
  assert.deepEqual(input.quantities, [])
  assert.equal(input.general.missions, 0)
})

test('rendu réel du PDF (Typst)', { skip: !existsSync(REPORT_PDF_TEMPLATE) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rapport-pdf-'))
  const outPath = join(dir, 'rapport.pdf')
  const result = await renderReportPdf(SECTIONS, { dateLabel: '14/10/2026', outPath })
  assert.ok(existsSync(outPath), 'le PDF doit exister')
  assert.ok(statSync(outPath).size > 10000, `PDF trop petit : ${statSync(outPath).size} octets`)
  assert.ok(result.bytes > 10000)
  rmSync(dir, { recursive: true, force: true })
})
