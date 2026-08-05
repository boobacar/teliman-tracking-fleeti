import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALERT_STATUSES,
  buildAlertKey,
  countUnprocessed,
  defaultAlertPriority,
  ESCALATION_AFTER_MS,
  mergeAlertActions,
  transitionAlertAction,
} from '../src/backend/alertActions.js'

const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const alertsPageSource = readFileSync(new URL('../src/pages/AlertsPage.jsx', import.meta.url), 'utf8')

test('buildAlertKey regroupe le même incident (camion + type + jour)', () => {
  const a = buildAlertKey({ tracker_id: 42, event: 'speedup', time: '2026-08-05T09:00:00Z' })
  const b = buildAlertKey({ trackerId: 42, event: 'speedup', time: '2026-08-05T18:30:00Z' })
  const c = buildAlertKey({ tracker_id: 42, event: 'speedup', time: '2026-08-06T09:00:00Z' })
  const d = buildAlertKey({ tracker_id: 43, event: 'speedup', time: '2026-08-05T09:00:00Z' })
  const e = buildAlertKey({ tracker_id: 42, event: 'fuel_level_leap', time: '2026-08-05T09:00:00Z' })
  assert.equal(a, b, 'même jour + même camion + même type = même incident')
  assert.notEqual(a, c, 'jour différent = incident distinct')
  assert.notEqual(a, d, 'camion différent = incident distinct')
  assert.notEqual(a, e, 'type différent = incident distinct')
  assert.equal(buildAlertKey({}), 'unknown|unknown|unknown')
})

test('defaultAlertPriority hiérarchise les types', () => {
  assert.equal(defaultAlertPriority('speedup'), 'high')
  assert.equal(defaultAlertPriority('fuel_level_leap'), 'medium')
  assert.equal(defaultAlertPriority('geofence_exit'), 'medium')
  assert.equal(defaultAlertPriority('autre_chose'), 'normal')
})

test('mergeAlertActions attache le cycle de vie aux événements', () => {
  const now = 1_800_000_000_000
  const history = [
    { tracker_id: 1, event: 'speedup', time: now - 60_000 },
    { tracker_id: 2, event: 'excessive_parking', time: now - 120_000 },
  ]
  const actions = [
    { alertKey: buildAlertKey(history[1]), status: 'processing', priority: 'high', assignedTo: 'Sékou', comment: 'Vérifié', history: [{ at: now, changes: 'processing' }] },
  ]
  const alerts = mergeAlertActions(history, actions, now)
  assert.equal(alerts.length, 2)
  const [speed, parking] = alerts
  assert.equal(speed.status, 'new')
  assert.equal(speed.priority, 'high') // défaut speedup
  assert.equal(speed.escalated, false)
  assert.equal(parking.status, 'processing')
  assert.equal(parking.assignedTo, 'Sékou')
  assert.equal(parking.comment, 'Vérifié')
  assert.equal(parking.actionHistory.length, 1)
})

test('mergeAlertActions escalade les alertes nouvelles de plus de 24 h', () => {
  const now = 1_800_000_000_000
  const oldEvent = { tracker_id: 3, event: 'excessive_parking', time: now - (ESCALATION_AFTER_MS + 60_000) }
  const alerts = mergeAlertActions([oldEvent], [], now)
  assert.equal(alerts[0].escalated, true)
  assert.equal(alerts[0].effectivePriority, 'high') // priorité remontée
  assert.equal(alerts[0].priority, 'normal') // priorité d'origine conservée
})

test('mergeAlertActions ne marque pas escaladée une alerte traitée', () => {
  const now = 1_800_000_000_000
  const oldEvent = { tracker_id: 4, event: 'excessive_parking', time: now - (ESCALATION_AFTER_MS + 60_000) }
  const key = buildAlertKey(oldEvent)
  const alerts = mergeAlertActions([oldEvent], [{ alertKey: key, status: 'resolved', resolvedAt: now }], now)
  assert.equal(alerts[0].escalated, false)
})

test('countUnprocessed compte les nouvelles', () => {
  assert.equal(countUnprocessed([{ status: 'new' }, { status: 'processing' }, { status: 'new' }]), 2)
  assert.equal(countUnprocessed([]), 0)
})

test("transitionAlertAction enregistre l'historique et les dates", () => {
  const now = '2026-08-05T10:00:00.000Z'
  const first = transitionAlertAction(null, { status: 'acknowledged', priority: 'high', assignedTo: 'Awa' }, now)
  assert.equal(first.status, 'acknowledged')
  assert.equal(first.acknowledgedAt, now)
  assert.equal(first.resolvedAt, null)
  assert.equal(first.history.length, 1)
  assert.match(first.history[0].changes, /acknowledged/)

  const second = transitionAlertAction(first, { status: 'resolved', comment: 'Livré et signé' }, '2026-08-05T12:00:00.000Z')
  assert.equal(second.status, 'resolved')
  assert.equal(second.resolvedAt, '2026-08-05T12:00:00.000Z')
  assert.equal(second.acknowledgedAt, now) // conservée
  assert.equal(second.history.length, 2)

  const third = transitionAlertAction(second, { status: 'processing' }, '2026-08-05T13:00:00.000Z')
  assert.equal(third.resolvedAt, null, 'quitter résolue efface la date de résolution')
  assert.equal(third.history.length, 3)
})

test('transitionAlertAction ignore un patch vide', () => {
  const base = transitionAlertAction(null, { status: 'new' }, '2026-08-05T10:00:00.000Z')
  const same = transitionAlertAction(base, { status: 'new' }, '2026-08-05T11:00:00.000Z')
  assert.equal(same.history.length, 0)
})

test('le serveur expose le cycle de vie des alertes', () => {
  assert.match(serverSource, /app\.patch\('\/api\/alerts\/:key'/)
  assert.match(serverSource, /app\.delete\('\/api\/alerts\/:key'/)
  assert.match(serverSource, /mergeAlertActions\(data\.history, actions, Date\.now\(\)\)/)
  assert.match(serverSource, /statusCounts/)
  assert.match(serverSource, /manage_alerts/)
  assert.match(serverSource, /alertActionPatchSchema/)
})

test('la page alertes couvre le cycle complet et les actions', () => {
  assert.match(alertsPageSource, /Reconnaître/)
  assert.match(alertsPageSource, /Prendre en charge/)
  assert.match(alertsPageSource, /Résoudre/)
  assert.match(alertsPageSource, /Réinitialiser/)
  assert.match(alertsPageSource, /Responsable/)
  assert.match(alertsPageSource, /Commentaire d'exploitation/)
  assert.match(alertsPageSource, /Historique des actions/)
  assert.match(alertsPageSource, /Escaladée/)
  assert.match(alertsPageSource, /updateAlertAction/)
  assert.match(alertsPageSource, /resetAlertAction/)
  assert.match(alertsPageSource, /statusCounts/)
  assert.match(alertsPageSource, /STATUS_LABELS/)
})

test('les statuts autorisés forment le cycle complet', () => {
  assert.deepEqual(ALERT_STATUSES, ['new', 'acknowledged', 'processing', 'resolved'])
})
