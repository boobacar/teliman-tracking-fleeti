import assert from 'node:assert/strict'
import fs from 'node:fs'

import path from 'node:path'
import test from 'node:test'
import { evaluateStorage } from '../scripts/check-storage.js'


test('storage check refuse un UUID inattendu ou un montage lecture seule', () => {
  assert.throws(() => evaluateStorage({ uuid: 'bad', expectedUuid: 'good', options: 'rw,noatime', mountpoint: '/mnt/data' }), /UUID/)
  assert.throws(() => evaluateStorage({ uuid: 'good', expectedUuid: 'good', options: 'ro,noatime', mountpoint: '/mnt/data' }), /lecture seule/)
})

test('storage check accepte uniquement le UUID attendu en lecture-écriture', () => {
  assert.deepEqual(evaluateStorage({ uuid: 'good', expectedUuid: 'good', options: 'rw,noatime', mountpoint: '/mnt/data' }), {
    mountpoint: '/mnt/data', uuid: 'good', readWrite: true,
  })
})

test('les unités et la rotation bornent les logs sans noms de périphériques instables', () => {
  const repo = path.resolve(import.meta.dirname, '..')
  const service = fs.readFileSync(path.join(repo, 'scripts', 'systemd', 'teliman-backup.service'), 'utf8')
  const timer = fs.readFileSync(path.join(repo, 'scripts', 'systemd', 'teliman-backup.timer'), 'utf8')
  const rotate = fs.readFileSync(path.join(repo, 'scripts', 'logrotate-teliman.conf'), 'utf8')
  const runbook = fs.readFileSync(path.join(repo, 'docs', 'exploitation-sauvegarde-recuperation.md'), 'utf8')
  assert.match(service, /backup-teliman\.js/)
  assert.match(timer, /OnCalendar=.*daily|OnCalendar=\*-\*-\*/)
  assert.match(rotate, /rotate\s+\d+/)
  assert.match(rotate, /maxsize|size/)
  assert.match(runbook, /\/dev\/disk\/by-uuid\//)
  assert.doesNotMatch(runbook, /\/dev\/(sd[a-z]|mmcblk\d+p?)\d*/)
})
