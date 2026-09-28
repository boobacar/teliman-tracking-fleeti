// Régression du 28/09/2026 : « les agents mettent une photo mais je ne les vois pas ».
// Le formulaire de preuve de livraison envoie toujours `proofStatus`, mais ce champ
// manquait au schéma de validation. Les schémas étant `.strict()`, le PATCH était
// rejeté en bloc (HTTP 400 « Unrecognized key ») et la photo n'était jamais écrite.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateBody, deliveryOrderSchema, deliveryOrderUpdateSchema } from '../src/backend/validation.js'

const DATA_URL = `data:image/jpeg;base64,${'A'.repeat(64)}`
const ordersPage = readFileSync(new URL('../src/pages/DeliveryOrdersPage.jsx', import.meta.url), 'utf8')
const detailPage = readFileSync(new URL('../src/pages/DeliveryOrderDetailPage.jsx', import.meta.url), 'utf8')

test('une photo de BL avec son statut POD est acceptée (payload réel de l’interface)', () => {
  // Copie exacte de ce qu'envoie uploadProofPhotos dans DeliveryOrdersPage.jsx.
  const payload = {
    proofPhotoDataUrl: DATA_URL,
    proofPhotoDataUrls: [DATA_URL],
    proofStatus: 'Reçue',
  }
  const validated = validateBody(deliveryOrderUpdateSchema, payload)
  assert.deepEqual(validated.proofPhotoDataUrls, [DATA_URL])
  assert.equal(validated.proofStatus, 'Reçue')
})

test('les trois statuts proposés par l’interface sont acceptés', () => {
  for (const proofStatus of ['En attente', 'Reçue', 'Validée']) {
    assert.doesNotThrow(() => validateBody(deliveryOrderUpdateSchema, { proofStatus }))
  }
})

test('le retrait d’une photo (statut remis à « En attente ») passe la validation', () => {
  // DeliveryOrderDetailPage.removePhotoAt envoie un tableau vide + le statut remis à zéro.
  const validated = validateBody(deliveryOrderUpdateSchema, {
    proofPhotoDataUrls: [],
    proofPhotoDataUrl: '',
    proofStatus: 'En attente',
  })
  assert.deepEqual(validated.proofPhotoDataUrls, [])
  assert.equal(validated.proofStatus, 'En attente')
})

test('proofNote est accepté à la création comme à la mise à jour', () => {
  assert.doesNotThrow(() => validateBody(deliveryOrderUpdateSchema, { proofNote: 'Livré à l’entrepôt du client' }))
  assert.doesNotThrow(() => validateBody(deliveryOrderSchema, {
    trackerId: '123', truckLabel: '3952WWCI01', proofNote: 'ok', proofStatus: 'Reçue',
  }))
})

test('le schéma reste strict : une clé inconnue est toujours refusée', () => {
  // On ne veut pas « élargir » le schéma au point de masquer les fautes de frappe.
  assert.throws(() => validateBody(deliveryOrderUpdateSchema, { proofStatuss: 'Reçue' }), /Unrecognized key/)
})

test('les pages qui envoient proofStatus restent couvertes par le schéma', () => {
  // Garde-fou : si l'interface se met à envoyer un nouveau champ de preuve, ce test
  // rappelle qu'il faut l'ajouter au schéma (sinon rejet total de l'enregistrement).
  assert.match(ordersPage, /proofStatus:/)
  assert.match(detailPage, /proofStatus:/)
  for (const key of ['proofStatus', 'proofNote', 'proofPhotoDataUrl', 'proofPhotoDataUrls']) {
    assert.ok(key in deliveryOrderUpdateSchema.shape, `${key} doit être déclaré dans le schéma`)
  }
})
