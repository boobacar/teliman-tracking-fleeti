import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTemplateBodyComponents,
  buildTemplateMessagePayload,
  buildTextMessagePayload,
  classifyWhatsAppError,
  extractGraphErrorCode,
  isWebhookChallengeValid,
  normalizeWhatsAppPhone,
  parseWhatsAppWebhook,
  sendWhatsAppFreeFormText,
  sendWhatsAppTemplateMessage,
} from '../src/backend/whatsappApi.js'

const CONFIG = { accessToken: 'TOKEN', phoneNumberId: '12345', apiVersion: 'v20.0' }

test('buildTemplateMessagePayload construit un payload template Graph correct', () => {
  const payload = buildTemplateMessagePayload({ to: '+2250701020304', templateName: 'teliman_notification', components: buildTemplateBodyComponents(['Salut']) })
  assert.equal(payload.messaging_product, 'whatsapp')
  assert.equal(payload.type, 'template')
  assert.equal(payload.to, '2250701020304')
  assert.equal(payload.template.name, 'teliman_notification')
  assert.equal(payload.template.language.code, 'fr')
  assert.deepEqual(payload.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Salut' }] }])
})

test('buildTemplateMessagePayload omet les composants vides', () => {
  const payload = buildTemplateMessagePayload({ to: '2250701020304', templateName: 'x' })
  assert.equal(payload.template.components, undefined)
})

test('sendWhatsAppTemplateMessage envoie le bon payload et retourne le messageId', async () => {
  const calls = []
  const fakeFetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid-1' }] }) }
  }
  const result = await sendWhatsAppTemplateMessage({ to: '2250701020304', templateName: 'teliman_alerte', components: buildTemplateBodyComponents(['A']), config: CONFIG, fetchImpl: fakeFetch })
  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'wamid-1')
  assert.equal(calls[0].type, 'template')
})

test('sendWhatsAppTemplateMessage classe les erreurs Meta (131026 template introuvable)', async () => {
  const fakeFetch = async () => ({ ok: false, json: async () => ({ error: { message: '(#131026) Template not found', code: 131026 } }) })
  const result = await sendWhatsAppTemplateMessage({ to: '2250701020304', templateName: 'missing', config: CONFIG, fetchImpl: fakeFetch })
  assert.equal(result.sent, false)
  assert.equal(result.errorKind, 'template_not_found')
  assert.equal(result.code, 131026)
})

test('sendWhatsAppFreeFormText envoie un texte libre et détecte l’exigence de template', async () => {
  const calls = []
  const fakeFetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: false, json: async () => ({ error: { message: '(#131047) Re-engagement message', code: 131047 } }) }
  }
  const result = await sendWhatsAppFreeFormText({ to: '2250701020304', body: 'Hello', config: CONFIG, fetchImpl: fakeFetch })
  assert.equal(calls[0].type, 'text')
  assert.equal(result.errorKind, 'requires_template')
  assert.equal(result.code, 131047)
})

test('classifyWhatsAppError distingue rate-limit, template requis et API', () => {
  assert.equal(classifyWhatsAppError({ error: { code: 130429 } }).kind, 'rate_limited')
  assert.equal(classifyWhatsAppError({ error: { code: 131026 } }).kind, 'template_not_found')
  assert.equal(classifyWhatsAppError({ error: { code: 131047 } }).kind, 'requires_template')
  assert.equal(classifyWhatsAppError({ error: { code: 10 } }).kind, 'api')
  assert.equal(classifyWhatsAppError({}).kind, 'unknown')
  assert.equal(extractGraphErrorCode({ error: { message: 'Oups (#80007)' } }), 80007)
})

test('parseWhatsAppWebhook normalise messages reçus et statuts', () => {
  const parsed = parseWhatsAppWebhook({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '12345' },
      messages: [{ from: '+2250701020304', id: 'wamid-in', timestamp: '1700000000', type: 'text', text: { body: 'Où est mon camion ?' } }],
      statuses: [{ id: 'wamid-1', status: 'failed', timestamp: '1700000001', errors: [{ code: 131047, title: 'Re-engagement' }] }],
    } }] }],
  })
  assert.equal(parsed.phoneNumberId, '12345')
  assert.equal(parsed.messages.length, 1)
  assert.equal(parsed.messages[0].from, '2250701020304')
  assert.equal(parsed.messages[0].text, 'Où est mon camion ?')
  assert.equal(parsed.statuses[0].errorCode, 131047)
})

test('isWebhookChallengeValid valide le challenge Meta', () => {
  assert.equal(isWebhookChallengeValid({ 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '1234' }, 'abc'), true)
  assert.equal(isWebhookChallengeValid({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1234' }, 'abc'), false)
  assert.equal(isWebhookChallengeValid({}, 'abc'), false)
  assert.equal(isWebhookChallengeValid({ 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '1234' }, ''), false)
})

test('normalizeWhatsAppPhone gère les formats 225', () => {
  assert.equal(normalizeWhatsAppPhone('+2250701020304'), '2250701020304')
  assert.equal(normalizeWhatsAppPhone('0701020304'), '2250701020304')
  assert.equal(normalizeWhatsAppPhone('002250701020304'), '2250701020304')
  assert.equal(normalizeWhatsAppPhone(''), '')
})
