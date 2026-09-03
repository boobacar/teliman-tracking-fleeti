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
  resolveAlertWhatsAppRecipients,
  buildFleetAlertWhatsAppMessage,
  sendFleetAlertWhatsAppNotifications,
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

test('resolveAlertWhatsAppRecipients normalise les destinataires par type d’alerte flotte', () => {
  assert.deepEqual(resolveAlertWhatsAppRecipients('speedup', {
    alertWhatsAppRecipients: {
      speedup: [' +225 07 69 28 93 04 ', '00221776260020', '+225 07 69 28 93 04'],
      excessive_parking: ['+225 05 00 00 00 00'],
    },
  }), ['221776260020', '2250769289304'])

  assert.deepEqual(resolveAlertWhatsAppRecipients('excessive_parking', {
    alertWhatsAppRecipients: {
      speedup: ['+221 77 626 00 20'],
      excessive_parking: '+225 05 00 00 00 00',
    },
  }), ['2250500000000'])
})

test('buildFleetAlertWhatsAppMessage inclut véhicule, chauffeur, type, position et heure', () => {
  const message = buildFleetAlertWhatsAppMessage({
    event: 'speedup',
    tracker_id: 42,
    truckLabel: 'TG 1234 AB',
    driver: 'Kouadio Jean',
    speed: 96,
    time: '2026-05-07T12:34:00.000Z',
    lat: 5.345,
    lng: -4.024,
    address: '5.34500, -4.02400',
  })

  assert.match(message, /^ALERTE 🚨/)
  assert.match(message, /Excès de vitesse/)
  assert.match(message, /TG 1234 AB/)
  assert.match(message, /Kouadio Jean/)
  assert.match(message, /96 km\/h/)
  assert.match(message, /5\.34500, -4\.02400/)
  assert.match(message, /maps\.google\.com/)
  assert.match(message, /07\/05\/2026/)
  assert.doesNotMatch(message, /TELIMAN LOGISTIQUE/)
  assert.match(message, /\nAlerte générée automatiquement par Teliman Tracking\.$/)
})

test('buildFleetAlertWhatsAppMessage masque le chauffeur quand il est non assigné', () => {
  const message = buildFleetAlertWhatsAppMessage({
    event: 'excessive_parking',
    truckLabel: '3100WWCI01',
    driver: 'Non assigné',
    time: '2026-05-08T09:09:00.000Z',
    lat: 5.5774149,
    lng: -3.1890516,
  })

  assert.match(message, /^ALERTE 🚨/)
  assert.match(message, /Stationnement prolongé/)
  assert.match(message, /3100WWCI01/)
  assert.doesNotMatch(message, /Chauffeur:/)
  assert.doesNotMatch(message, /Non assigné/)
  assert.match(message, /\nAlerte générée automatiquement par Teliman Tracking\.$/)
})

test('sendFleetAlertWhatsAppNotifications envoie instantanément aux destinataires du type d’alerte', async () => {
  const calls = []
  const results = await sendFleetAlertWhatsAppNotifications({
    event: {
      event: 'excessive_parking',
      truckLabel: 'CI-2026-TL',
      driver: 'Awa Diarra',
      time: '2026-05-07T09:00:00.000Z',
      address: 'Zone industrielle Yopougon',
    },
    masterData: { alertWhatsAppRecipients: { excessive_parking: ['+225 07 00 00 00 00', '+221 77 626 00 20'] } },
    config: { enabled: true, provider: 'baileys' },
    baileysClient: {
      sendText: async (to, message) => {
        calls.push({ to, message })
        return { sent: true, messageId: `MSG-${to}` }
      },
    },
  })

  assert.equal(results.length, 2)
  assert.deepEqual(calls.map((call) => call.to), ['221776260020', '2250700000000'])
  assert.ok(calls.every((call) => call.message.includes('Stationnement prolongé')))
  assert.ok(results.every((result) => result.sent && result.source === 'fleet_alert'))
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

test('sendWhatsAppTextMessage ne bloque pas les BL quand le canal WhatsApp est indisponible', async () => {
  const result = await sendWhatsAppTextMessage({
    to: '2250701020304',
    message: 'Bonjour Teliman',
    config: { enabled: true, provider: 'meta' },
  })

  assert.equal(result.sent, false)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /Meta désactivé/i)
})

test('buildWhatsAppConfigFromEnv active le provider Baileys avec un dossier auth persistant', () => {
  assert.deepEqual(buildWhatsAppConfigFromEnv({
    WHATSAPP_PROVIDER: 'baileys',
    WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
    WHATSAPP_BAILEYS_AUTH_DIR: '/tmp/teliman-wa-auth',
  }), {
    enabled: true,
    provider: 'baileys',
    baileysAuthDir: '/tmp/teliman-wa-auth',
    baileysTyping: true,
    baileys463CooldownHours: 24,
    sendHours: null,
    queueEnabled: true,
    baileysQueue: null,
  })
})

test('buildWhatsAppConfigFromEnv lit la fenêtre horaire, la frappe simulée et le cooldown 463', () => {
  const config = buildWhatsAppConfigFromEnv({
    WHATSAPP_SEND_HOURS_START: '7',
    WHATSAPP_SEND_HOURS_END: '21',
    WHATSAPP_BAILEYS_TYPING: 'false',
    WHATSAPP_BAILEYS_463_COOLDOWN_HOURS: '48',
  })
  assert.deepEqual(config.sendHours, { start: 7, end: 21 })
  assert.equal(config.baileysTyping, false)
  assert.equal(config.baileys463CooldownHours, 48)
})

test('buildWhatsAppConfigFromEnv ignore une fenêtre horaire invalide', () => {
  assert.equal(buildWhatsAppConfigFromEnv({ WHATSAPP_SEND_HOURS_START: '7' }).sendHours, null)
  assert.equal(buildWhatsAppConfigFromEnv({ WHATSAPP_SEND_HOURS_START: '25', WHATSAPP_SEND_HOURS_END: '21' }).sendHours, null)
  assert.equal(buildWhatsAppConfigFromEnv({ WHATSAPP_SEND_HOURS_START: '22', WHATSAPP_SEND_HOURS_END: '6' }).sendHours ? 'ok' : 'null', 'ok') // fenêtre nocturne enveloppée
})

test('buildWhatsAppConfigFromEnv lit le flag de file d’attente', () => {
  assert.equal(buildWhatsAppConfigFromEnv({ WHATSAPP_QUEUE_ENABLED: 'false' }).queueEnabled, false)
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
      onWhatsApp: async (jid) => [{ jid, exists: true }],
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

test('createBaileysWhatsAppClient vérifie le compte WhatsApp réel avant envoi international', async () => {
  const checked = []
  const sent = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => {
        checked.push(jid)
        return [{ jid: '2250769289304@s.whatsapp.net', exists: true }]
      },
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload })
        return { key: { id: 'MSG-CI' } }
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async (qr) => `data:image/png;base64,${Buffer.from(qr).toString('base64')}`,
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+2250769289304', 'Message Côte d’Ivoire')

  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'MSG-CI')
  assert.deepEqual(checked, ['2250769289304@s.whatsapp.net'])
  assert.deepEqual(sent, [{ jid: '2250769289304@s.whatsapp.net', payload: { text: 'Message Côte d’Ivoire' } }])
})

test('createBaileysWhatsAppClient simule la frappe (composing) avant l’envoi', async () => {
  const events = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendPresenceUpdate: async (type, jid) => { events.push(`presence:${type}:${jid.split('@')[0]}`) },
      sendMessage: async (jid, payload) => { events.push(`send:${jid.split('@')[0]}`); return { key: { id: 'MSG-TYPING' } } },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
    typingDelayMs: { min: 1, max: 2 },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+225 07 01 02 03 04', 'Bonjour')

  assert.equal(result.sent, true)
  assert.deepEqual(events, [
    'presence:composing:2250701020304',
    'send:2250701020304',
    'presence:paused:2250701020304',
  ])
  assert.equal(client.getStatus().typingSimulation, true)
})

test('createBaileysWhatsAppClient ne re-tente pas un contact en erreur 463 pendant le cooldown', async () => {
  let sendAttempts = 0
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async () => {
        sendAttempts += 1
        const error = new Error('(#463) reachout timelock')
        throw error
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
    typingSimulation: false,
    reachoutCooldownHours: 24,
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  const first = await client.sendText('+225 07 01 02 03 04', 'Premier essai')
  assert.equal(first.errorKind, 'reachout_timelock')
  assert.equal(first.statusCode, 463)

  const second = await client.sendText('+225 07 01 02 03 04', 'Second essai')
  assert.equal(second.errorKind, 'reachout_timelock')
  assert.match(second.reason, /cooldown 463/i)

  assert.equal(sendAttempts, 1, 'une seule tentative réelle malgré 2 appels')
  assert.equal(client.getStatus().reachoutCooldownCount, 1)
})

test('sendWhatsAppTextMessage marque deferrable les jobs selon la source (Baileys)', async () => {
  const jobs = []
  const baileysQueue = { enqueue: (job) => jobs.push(job) }
  const config = { enabled: true, provider: 'baileys', baileysQueue }
  const baileysClient = { sendText: async () => ({ sent: true }) }

  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'BL créé', config, baileysClient, context: { source: 'delivery_order' } })
  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'ALERTE vitesse', config, baileysClient, context: { source: 'fleet_alert' } })
  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Sortie zone', config, baileysClient, context: { source: 'geofence' } })

  assert.equal(jobs.length, 3)
  assert.equal(jobs[0].deferrable, true, 'BL différé hors fenêtre horaire')
  assert.equal(jobs[1].deferrable, false, 'alerte flotte jamais différée')
  assert.equal(jobs[2].deferrable, false, 'alerte géofence jamais différée')
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

test('createWhatsAppHistoryEntry marque `queued` (et non `failed`) un message mis en file', () => {
  const entry = createWhatsAppHistoryEntry({
    result: { eventType: 'exit', recipient: '22177000000', sent: false, queued: true, reason: 'En file d’attente WhatsApp (Baileys).' },
    order: { id: '3537766', reference: '4400WWCI01', client: 'Géofence Bouaké, ville' },
    message: 'ALERTE GÉOFENCE 🚧 …',
    source: 'geofence',
    now: () => '2026-09-03T12:11:58.000Z',
  })
  assert.equal(entry.status, 'queued', 'un job en file ne doit pas être étiqueté failed')
  assert.equal(entry.source, 'geofence')
  assert.equal(entry.reason, 'En file d’attente WhatsApp (Baileys).')
})

test('sendWhatsAppTextMessage route Baileys via la file dédiée quand config.baileysQueue est présent', async () => {
  const jobs = []
  const baileysClient = { sendText: async () => ({ sent: true }) }
  const config = buildWhatsAppConfigFromEnv({ WHATSAPP_PROVIDER: 'baileys' })
  const result = await sendWhatsAppTextMessage({
    to: '+225 07 01 02 03 04',
    message: 'Alerte via Baileys',
    config: { ...config, baileysQueue: { enqueue: (job) => jobs.push(job) } },
    baileysClient,
  })
  assert.equal(result.queued, true)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].to, '2250701020304')
  assert.equal(jobs[0].config.baileysQueue, null) // pas de récursion
})

test('createBaileysWhatsAppClient détecte l’erreur 463 (Reachout Timelock) sans la retenter', async () => {
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async () => {
        const error = new Error('NackCallerReachoutTimelocked')
        error.output = { statusCode: 463 }
        throw error
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async (qr) => `data:image/png;base64,${Buffer.from(qr).toString('base64')}`,
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+225 07 01 02 03 04', 'Message bloqué')
  assert.equal(result.sent, false)
  assert.equal(result.skipped, false)
  assert.equal(result.errorKind, 'reachout_timelock')
  assert.equal(result.statusCode, 463)
  assert.match(result.reason, /463/)
})

test('createBaileysWhatsAppClient arrête la reconnexion sur session révoquée (403)', async () => {
  const handlers = {}
  let socketCreations = 0
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => {
      socketCreations += 1
      return {
        ev: { on: (name, handler) => { handlers[name] = handler } },
        onWhatsApp: async (jid) => [{ jid, exists: true }],
        sendMessage: async () => ({ key: { id: 'MSG' } }),
      }
    },
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async (qr) => `data:image/png;base64,${Buffer.from(qr).toString('base64')}`,
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  await handlers['connection.update']({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 403 }, message: 'logged out' } } })

  assert.equal(client.getStatus().state, 'loggedOut')
  assert.match(client.getStatus().lastError, /révoquée|403/)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(socketCreations, 1, 'aucun socket recréé après un 403')
})
