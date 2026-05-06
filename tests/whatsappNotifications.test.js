import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeliveryOrderWhatsAppMessage,
  buildWhatsAppMessageFromTemplate,
  buildWhatsAppConfigFromEnv,
  DEFAULT_WHATSAPP_TEMPLATES,
  createWhatsAppHistoryEntry,
  detectDeliveryOrderWhatsAppEvents,
  resolveClientWhatsAppRecipients,
  sendWhatsAppTextMessage,
} from '../src/backend/whatsappNotifications.js'
import { createBaileysWhatsAppClient, toBaileysJid } from '../src/backend/baileysWhatsAppClient.js'

const order = {
  id: 101,
  reference: 'BL-2026-001',
  client: 'K1 MINE',
  truckLabel: 'TG 1234 AB',
  driver: 'Kouadio Jean',
  loadingPoint: 'Abidjan Port',
  destination: 'Bouaké',
  goods: 'Gravier',
  quantity: '32.5',
  status: 'Prévu',
  date: '2026-05-06T10:00:00.000Z',
  departureDateTime: '2026-05-06T11:15:00.000Z',
  arrivalDateTime: '2026-05-06T18:45:00.000Z',
  notes: 'Contact gardien à l’arrivée',
}

test('resolveClientWhatsAppRecipients retrouve et normalise les téléphones du client du BL', () => {
  assert.deepEqual(resolveClientWhatsAppRecipients(order, {
    clientPhones: {
      'K1 MINE': [' +225 07 01 02 03 04 ', '002250501020304', '+225 07 01 02 03 04'],
      AUTRE: ['+225 01 00 00 00 00'],
    },
  }), ['2250501020304', '2250701020304'])
})

test('detectDeliveryOrderWhatsAppEvents déclenche seulement création BL et passage au statut Livré', () => {
  assert.deepEqual(detectDeliveryOrderWhatsAppEvents(null, order), ['created'])

  assert.deepEqual(detectDeliveryOrderWhatsAppEvents({ ...order, status: 'Prévu' }, { ...order, status: 'En cours' }), [])
  assert.deepEqual(detectDeliveryOrderWhatsAppEvents({ ...order, status: 'En cours' }, { ...order, status: 'Livré' }), ['arrived'])
  assert.deepEqual(detectDeliveryOrderWhatsAppEvents({ ...order, status: 'En cours' }, { ...order, status: 'livre' }), ['arrived'])
  assert.deepEqual(detectDeliveryOrderWhatsAppEvents({ ...order, departureDateTime: null }, order), [])
  assert.deepEqual(detectDeliveryOrderWhatsAppEvents({ ...order, arrivalDateTime: null }, order), [])
})

test('buildDeliveryOrderWhatsAppMessage inclut tous les détails importants du BL', () => {
  const message = buildDeliveryOrderWhatsAppMessage('departed', order)

  assert.match(message, /Départ confirmé/)
  assert.match(message, /BL-2026-001/)
  assert.match(message, /K1 MINE/)
  assert.match(message, /TG 1234 AB/)
  assert.match(message, /Kouadio Jean/)
  assert.match(message, /Abidjan Port/)
  assert.match(message, /Bouaké/)
  assert.match(message, /Gravier/)
  assert.match(message, /32\.5/)
  assert.match(message, /Contact gardien/)
})

test('sendWhatsAppTextMessage utilise WhatsApp Cloud API quand la configuration est complète', async () => {
  const calls = []
  const result = await sendWhatsAppTextMessage({
    to: '2250701020304',
    message: 'Bonjour Teliman',
    config: {
      enabled: true,
      accessToken: 'token-test',
      phoneNumberId: '123456789',
      apiVersion: 'v20.0',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
      }
    },
  })

  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'wamid.TEST')
  assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/123456789/messages')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token-test')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '2250701020304',
    type: 'text',
    text: { preview_url: false, body: 'Bonjour Teliman' },
  })
})

test('sendWhatsAppTextMessage ne bloque pas les BL quand WhatsApp API est désactivée ou incomplète', async () => {
  const result = await sendWhatsAppTextMessage({
    to: '2250701020304',
    message: 'Bonjour Teliman',
    config: { enabled: true, accessToken: '', phoneNumberId: '' },
    fetchImpl: async () => {
      throw new Error('ne doit pas appeler fetch')
    },
  })

  assert.equal(result.sent, false)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /non configurée/i)
})

test('buildWhatsAppConfigFromEnv active le provider Baileys avec un dossier auth persistant', () => {
  assert.deepEqual(buildWhatsAppConfigFromEnv({
    WHATSAPP_PROVIDER: 'baileys',
    WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
    WHATSAPP_BAILEYS_AUTH_DIR: '/tmp/teliman-wa-auth',
  }), {
    enabled: true,
    provider: 'baileys',
    accessToken: '',
    phoneNumberId: '',
    apiVersion: 'v20.0',
    baileysAuthDir: '/tmp/teliman-wa-auth',
  })
})

test('toBaileysJid transforme un numéro international en identifiant WhatsApp', () => {
  assert.equal(toBaileysJid('+225 07 01 02 03 04'), '2250701020304@s.whatsapp.net')
})

test('sendWhatsAppTextMessage délègue l’envoi au client Baileys quand le provider est baileys', async () => {
  const calls = []
  const result = await sendWhatsAppTextMessage({
    to: '+225 07 01 02 03 04',
    message: 'Bonjour via Baileys',
    config: { enabled: true, provider: 'baileys' },
    baileysClient: {
      sendText: async (to, message) => {
        calls.push({ to, message })
        return { sent: true, messageId: 'BAILEYS-1' }
      },
    },
  })

  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'BAILEYS-1')
  assert.deepEqual(calls, [{ to: '2250701020304', message: 'Bonjour via Baileys' }])
})

test('createBaileysWhatsAppClient expose le statut, le QR et envoie un message via socket injectée', async () => {
  const sent = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload })
        return { key: { id: 'MSG-1' } }
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async (qr) => `data:image/png;base64,${Buffer.from(qr).toString('base64')}`,
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'connecting', qr: 'QR-CODE-CONTENT' })
  assert.equal(client.getStatus().state, 'qr')
  assert.equal(client.getQr().qr, 'QR-CODE-CONTENT')
  assert.match(client.getQr().qrDataUrl, /^data:image\/png;base64,/)

  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+225 07 01 02 03 04', 'Message test')
  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'MSG-1')
  assert.deepEqual(sent, [{ jid: '2250701020304@s.whatsapp.net', payload: { text: 'Message test' } }])
})

test('createBaileysWhatsAppClient expose le vrai numéro connecté et peut se déconnecter puis redémarrer', async () => {
  const handlers = {}
  let logoutCalls = 0
  let cleanCalls = 0
  let socketCreations = 0
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => {
      socketCreations += 1
      return {
        user: { id: '221776260020:12@s.whatsapp.net', name: 'Teliman Test' },
        ev: { on: (name, handler) => { handlers[name] = handler } },
        logout: async () => { logoutCalls += 1 },
        end: () => {},
        sendMessage: async () => ({ key: { id: 'MSG' } }),
      }
    },
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async (qr) => `data:image/png;base64,${Buffer.from(qr).toString('base64')}`,
    sessionCleaner: async () => { cleanCalls += 1 },
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  assert.equal(client.getStatus().connectedPhone, '+221 77 626 00 20')
  assert.equal(client.getStatus().connectedName, 'Teliman Test')

  const logoutResult = await client.disconnect({ clearSession: true })
  assert.equal(logoutResult.ok, true)
  assert.equal(logoutCalls, 1)
  assert.equal(cleanCalls, 1)
  assert.equal(client.getStatus().state, 'disconnected')
  assert.equal(client.getStatus().connectedPhone, '')

  await client.reconnect({ clearSession: false })
  assert.equal(socketCreations, 2)
})

test('buildWhatsAppMessageFromTemplate remplace les variables BL modifiables', () => {
  const message = buildWhatsAppMessageFromTemplate('created', order, {
    created: 'Bonjour {{client}}, votre BL {{reference}} vers {{destination}} est prêt. Camion {{truckLabel}}.',
  })

  assert.equal(message, 'Bonjour K1 MINE, votre BL BL-2026-001 vers Bouaké est prêt. Camion TG 1234 AB.')
  assert.match(DEFAULT_WHATSAPP_TEMPLATES.departed, /{{departureDateTime}}/)
})

test('createWhatsAppHistoryEntry construit une ligne historique sans secrets et avec aperçu message', () => {
  const entry = createWhatsAppHistoryEntry({
    result: { eventType: 'created', recipient: '2250701020304', sent: false, skipped: true, reason: 'Baileys non connecté', messageId: 'MSG-1' },
    order,
    message: 'Bonjour Teliman '.repeat(20),
    source: 'delivery_order',
    senderPhone: '+225 69 28 93 04',
    now: () => '2026-05-06T15:00:00.000Z',
  })

  assert.equal(entry.status, 'skipped')
  assert.equal(entry.eventType, 'created')
  assert.equal(entry.orderReference, 'BL-2026-001')
  assert.equal(entry.client, 'K1 MINE')
  assert.equal(entry.recipient, '2250701020304')
  assert.equal(entry.senderPhone, '+225 69 28 93 04')
  assert.equal(entry.reason, 'Baileys non connecté')
  assert.equal(entry.sentAt, '2026-05-06T15:00:00.000Z')
  assert.ok(entry.messagePreview.length <= 180)
  assert.equal(entry.accessToken, undefined)
})
