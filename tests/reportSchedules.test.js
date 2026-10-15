// Réglage de l'heure d'envoi par type de rapport : validation, déclenchement,
// et anti-doublon (un rapport ne part qu'une fois par jour).
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  REPORT_TYPES, defaultScheduleFor, defaultSchedules, formatHourMinute, formatScheduleLabel,
  isReportDue, normalizeSchedule, reportDayKey, reportTypeExists, validateReportScheduleInput,
} from '../src/backend/reportSchedules.js'

test('chaque type de rapport a sa propre heure par défaut', () => {
  assert.equal(REPORT_TYPES.length, 3, 'quotidien, hebdomadaire et bus')
  const daily = defaultScheduleFor('report_daily')
  const weekly = defaultScheduleFor('report_weekly')
  assert.deepEqual({ hour: daily.hour, minute: daily.minute, weekday: daily.weekday }, { hour: 20, minute: 0, weekday: null })
  assert.deepEqual({ hour: weekly.hour, minute: weekly.minute, weekday: weekly.weekday }, { hour: 8, minute: 0, weekday: 1 })
  assert.equal(defaultSchedules().length, 3)
  const bus = defaultScheduleFor('report_bus')
  assert.deepEqual({ hour: bus.hour, minute: bus.minute, weekday: bus.weekday }, { hour: 19, minute: 0, weekday: null }, 'le rapport bus part à 19h')
  assert.equal(reportTypeExists('report_daily'), true)
  assert.equal(reportTypeExists('report_hourly'), false)
})

test('l’heure est validée explicitement (pas de correction silencieuse)', () => {
  assert.deepEqual(validateReportScheduleInput({ hour: 21, minute: 30 }), { hour: 21, minute: 30 })
  assert.deepEqual(validateReportScheduleInput({ weekday: null }), { weekday: null })
  assert.throws(() => validateReportScheduleInput({ hour: 24 }), /Heure invalide/)
  assert.throws(() => validateReportScheduleInput({ hour: -1 }), /Heure invalide/)
  assert.throws(() => validateReportScheduleInput({ minute: 60 }), /Minutes invalides/)
  assert.throws(() => validateReportScheduleInput({ weekday: 7 }), /Jour de la semaine invalide/)
  assert.throws(() => validateReportScheduleInput({}), /Aucun réglage/)
})

test('le déclenchement tombe exactement sur la minute configurée', () => {
  const schedule = { reportKey: 'report_daily', hour: 20, minute: 0, weekday: null, enabled: true }
  assert.equal(isReportDue(schedule, new Date('2026-10-13T20:00:20')), true)
  assert.equal(isReportDue(schedule, new Date('2026-10-13T20:01:00')), false)
  assert.equal(isReportDue(schedule, new Date('2026-10-13T19:00:00')), false)
  assert.equal(isReportDue({ ...schedule, minute: 30 }, new Date('2026-10-13T20:30:10')), true)
  assert.equal(isReportDue({ ...schedule, enabled: false }, new Date('2026-10-13T20:00:00')), false)
})

test('un rapport hebdomadaire ne part que le jour choisi', () => {
  const weekly = { reportKey: 'report_weekly', hour: 8, minute: 0, weekday: 1, enabled: true } // lundi
  const monday = new Date('2026-10-12T08:00:05') // lundi 12/10/2026
  const tuesday = new Date('2026-10-13T08:00:05')
  assert.equal(monday.getDay(), 1)
  assert.equal(isReportDue(weekly, monday), true)
  assert.equal(isReportDue(weekly, tuesday), false)
  // Changer d'heure ne touche pas l'autre type de rapport
  const daily = defaultScheduleFor('report_daily')
  assert.equal(isReportDue(daily, monday), false)
})

test('normalizeSchedule fusionne un réglage partiel sans perdre le reste', () => {
  const base = defaultScheduleFor('report_daily')
  const changed = normalizeSchedule('report_daily', { hour: 6 }, base)
  assert.deepEqual({ hour: changed.hour, minute: changed.minute, enabled: changed.enabled }, { hour: 6, minute: 0, enabled: true })
  const disabled = normalizeSchedule('report_weekly', { enabled: false }, defaultScheduleFor('report_weekly'))
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.hour, 8)
})

test('clé de journée : un envoi par jour et par type', () => {
  const now = new Date('2026-10-13T20:00:00')
  assert.equal(reportDayKey('report_daily', now), 'report_daily:2026-10-13')
  assert.equal(formatHourMinute(20, 0), '20h00')
  assert.equal(formatHourMinute(6, 5), '06h05')
  assert.equal(formatScheduleLabel({ hour: 20, minute: 0, weekday: null }), 'tous les jours à 20h00')
  assert.equal(formatScheduleLabel({ hour: 8, minute: 0, weekday: 1 }), 'chaque lundi à 08h00')
})

test('les plannings et le journal d’envoi survivent à un redémarrage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'teliman-reports-'))
  const db = await import('../src/backend/database.js')
  db.initDatabase(join(dir, 'test.db'))

  assert.deepEqual(db.readReportSchedules(), [], 'aucun planning avant réglage')

  const saved = db.upsertReportSchedule({ reportKey: 'report_daily', hour: 21, minute: 15, weekday: null, enabled: true })
  assert.equal(saved.hour, 21)
  assert.equal(saved.minute, 15)
  const weekly = db.upsertReportSchedule({ reportKey: 'report_weekly', hour: 7, weekday: 5, enabled: true })
  assert.equal(weekly.weekday, 5)
  assert.equal(db.readReportSchedule('report_daily').hour, 21, 'régler un type ne modifie pas l’autre')

  // Le même jour, un envoi déjà journalisé ne doit pas repartir
  assert.equal(db.readReportSend('report_daily', 'report_daily:2026-10-13'), null)
  db.recordReportSend({ reportKey: 'report_daily', dayKey: 'report_daily:2026-10-13', recipients: ['221770000000'], status: 'sent' })
  const send = db.readReportSend('report_daily', 'report_daily:2026-10-13')
  assert.equal(send.status, 'sent')
  assert.deepEqual(send.recipients, ['221770000000'])
  // Rejouer le même jour met à jour la ligne au lieu d'en créer une seconde
  db.recordReportSend({ reportKey: 'report_daily', dayKey: 'report_daily:2026-10-13', recipients: ['221770000000'], status: 'sent' })
  assert.equal(db.readReportSends(10).filter((row) => row.reportKey === 'report_daily').length, 1)
  assert.equal(db.readReportSends(10).length, 1)
})
