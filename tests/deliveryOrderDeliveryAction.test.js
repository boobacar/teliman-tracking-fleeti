// Garde-fou sur la clôture d'un bon (« Marquer livré »).
//
// Panne constatée : des bons passés « En cours » puis désactivés automatiquement
// (une nouvelle mission sur le même camion appelle setDeliveryOrderActiveOnTracker,
// qui met active = 0 sans toucher au statut) ne pouvaient plus être clôturés : le
// bouton était désactivé par la condition `!item.active` et le gestionnaire sortait
// immédiatement. L'agent voyait un bouton inerte, sans explication.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('../src/pages/DeliveryOrdersPage.jsx', import.meta.url), 'utf8')
const confirmDialog = readFileSync(new URL('../src/components/ConfirmDialog.jsx', import.meta.url), 'utf8')

test('la clôture n’est plus bloquée par la désactivation automatique du bon', () => {
  const handler = page.slice(page.indexOf('const markDelivered'), page.indexOf('const removeOrder'))
  assert.ok(handler.length > 0, 'gestionnaire markDelivered introuvable')
  assert.doesNotMatch(handler, /if \(!item\.active \|\| item\.status === 'Livré'\) return/, 'le garde-fou historique doit avoir disparu')
  assert.doesNotMatch(handler, /if \(!item\.active\) return/)
  assert.match(handler, /item\.status === 'Livré'/)
  // La clôture force bien l'état attendu côté serveur
  assert.match(handler, /updateDeliveryOrder\(item\.id, \{ status: 'Livré', active: false \}\)/)
  // L'agent doit voir le résultat, la clôture était auparavant totalement silencieuse
  assert.match(handler, /setDeliveryNotice\(\{ kind: 'success'/)
})

test('le bouton reste actif tant que le bon n’est pas livré', () => {
  const disabledConditions = [...page.matchAll(/disabled=\{saving \|\| ([^}]+)\}/g)].map((match) => match[1])
  assert.ok(disabledConditions.length >= 2, 'les boutons bureau et mobile doivent être couverts')
  for (const condition of disabledConditions) {
    assert.doesNotMatch(condition, /!item\.active/, 'la désactivation automatique ne doit pas rendre le bouton inerte')
    assert.match(condition, /statusLabel === 'Livré'/)
  }
})

test('un bon suspendu est expliqué à l’agent (bureau et mobile)', () => {
  assert.match(page, /delivery-suspended-label/)
  const markers = (page.match(/delivery-suspended-label/g) || []).length
  assert.ok(markers >= 2, 'le repère doit exister en tableau et en carte mobile')
  assert.match(page, /Mission suspendue/)
})

test('tous les statuts réellement utilisés sont filtrables', () => {
  assert.match(page, /const statusChips = useMemo/)
  assert.match(page, /deliveryOrders\.map\(\(item\) => item\.status\)/)
  assert.doesNotMatch(page, /\{\[\['all', 'Tous'\], \['active', 'Actifs'\](.*)\]\.map\(\(\[value, label\]\)/)
})

test('une confirmation ne peut plus rester sans réponse', () => {
  // Le résolveur doit vivre hors de l'état React : résolu dans un updater, il
  // pouvait être perdu quand une demande en remplaçait une autre (bouton inerte).
  assert.match(confirmDialog, /pendingRef/)
  assert.doesNotMatch(confirmDialog, /setRequest\(\(current\) => \{\s*current\?\.resolve/)
  assert.match(confirmDialog, /pendingRef\.current\?\.\(false\)/)
})

// Vérifie l'invariant côté base : un bon désactivé par une autre mission garde son
// statut, et c'est cette combinaison (état inexpliqué) qui doit rester clôturable.
test('la désactivation automatique ne touche pas le statut du bon précédent', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'teliman-delivery-'))
  const db = await import('../src/backend/database.js')
  db.initDatabase(join(dir, 'test.db'))

  const base = {
    trackerId: '39151', truckLabel: '39151WWCI01', driver: 'Test', client: 'Test', goods: 'Test',
    quantity: '1', status: 'En cours', active: true, date: '2026-10-13',
    loadingPoint: 'Départ', destination: 'Arrivée', notes: '', completedAt: null,
    proofNote: '', proofStatus: 'En attente', proofPhotoDataUrl: '', proofPhotoDataUrls: [],
    departureDateTime: null, arrivalDateTime: null,
  }
  db.insertDeliveryOrderAtomic({ ...base, id: 1001, reference: 'REF-1', active: true })
  db.insertDeliveryOrderAtomic({ ...base, id: 1002, reference: 'REF-2', active: true })

  const afterFirst = db.readDeliveryOrderById(1001)
  const afterSecond = db.readDeliveryOrderById(1002)
  assert.equal(afterSecond.active, true)
  assert.equal(afterFirst.active, false, 'la première mission du camion est désactivée')
  assert.equal(afterFirst.status, 'En cours', 'son statut ne doit pas être inventé')

  // Mise à jour partielle telle que l'envoie le bouton : statut livré + désactivation
  db.updateDeliveryOrderAtomic(1001, { ...afterFirst, status: 'Livré', active: false, completedAt: new Date().toISOString() })
  const closed = db.readDeliveryOrderById(1001)
  assert.equal(closed.status, 'Livré')
  assert.equal(closed.active, false)
  assert.ok(closed.completedAt)
})
