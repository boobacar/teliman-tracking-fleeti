import { Buffer } from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildDeliveryOrderWhatsAppMessage,
  buildWhatsAppMessageFromTemplate,
  buildWhatsAppConfigFromEnv,
  DEFAULT_WHATSAPP_TEMPLATES,
  createWhatsAppHistoryEntry,
  detectDeliveryOrderWhatsAppEvents,
  resolveAlertLogoPath,
  resolveAlertWhatsAppRecipients,
  buildFleetAlertWhatsAppMessage,
  buildGeofenceAlertWhatsAppMessage,
  sendFleetAlertWhatsAppNotifications,
  resolveClientWhatsAppRecipients,
  sendWhatsAppTextMessage,
} from '../src/backend/whatsappNotifications.js'
import { buildImagePreview, createBaileysWhatsAppClient, createOutboundMessageCache, evaluateInstanceLock, resolveCredsPurgeAction, toBaileysJid, withDelayedPreKeyDeletion } from '../src/backend/baileysWhatsAppClient.js'
import { listAuthSnapshots } from '../src/backend/whatsappAuthStore.js'

// Logo de test : un vrai fichier sur disque (le client lit le fichier avant envoi).
function createTestLogoFile(contents = 'LOGO-TELIMAN') {
  const dir = mkdtempSync(join(tmpdir(), 'teliman-wa-logo-'))
  const file = join(dir, 'teliman-logistique-logo.jpg')
  writeFileSync(file, contents)
  return file
}

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

  assert.doesNotMatch(message, /^Teliman Logistique/, 'plus de titre en haut : le logo est joint à l’alerte')
  assert.match(message, /^Le véhicule TG 1234 AB \(Kouadio Jean\) vient de dépasser la limite de vitesse à 96 km\/h\./)
  assert.match(message, /vient de dépasser la limite de vitesse/)
  assert.match(message, /TG 1234 AB/)
  assert.match(message, /Kouadio Jean/)
  assert.match(message, /96 km\/h/)
  assert.match(message, /maps\.google\.com/)
  assert.match(message, /07\/05\/2026/)
  assert.doesNotMatch(message, /TELIMAN LOGISTIQUE/)
  assert.doesNotMatch(message, /Alerte générée automatiquement/)
  assert.doesNotMatch(message, /Position :/)
  assert.match(message, /L'équipe Teliman Logistique$/)
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

  assert.doesNotMatch(message, /^Teliman Logistique/)
  assert.match(message, /est à l'arrêt/)
  assert.match(message, /3100WWCI01/)
  assert.doesNotMatch(message, /Chauffeur:/)
  assert.doesNotMatch(message, /Non assigné/)
  assert.match(message, /L'équipe Teliman Logistique$/)
})

test('buildFleetAlertWhatsAppMessage ajoute le bloc Mission en cours quand une mission est active', () => {
  const message = buildFleetAlertWhatsAppMessage({
    event: 'speedup',
    truckLabel: 'TG 1234 AB',
    driver: 'Kouadio Jean',
    speed: 88,
    time: '2026-05-07T12:34:00.000Z',
    lat: 5.345,
    lng: -4.024,
    address: 'Abidjan',
    mission: { reference: 'BL-2026-001', client: 'Société X', destination: 'Abidjan', goods: 'Ciment', quantity: '32,500' },
  })

  assert.match(message, /Mission en cours/)
  assert.match(message, /Bon n°BL-2026-001/)
  assert.doesNotMatch(message, /Client :/, 'la ligne client a été retirée du bloc mission')
  assert.match(message, /Marchandise : Ciment\n▪️ Quantité : 32,500/, 'quantité juste sous la marchandise')
})

test('le bloc mission s’arrête à la quantité et ignore une quantité absente', () => {
  const withQuantity = buildFleetAlertWhatsAppMessage({
    event: 'speedup',
    truckLabel: 'TG 1234 AB',
    time: '2026-05-07T12:34:00.000Z',
    mission: { reference: 'BL-1', destination: 'Bouaké', goods: 'Sable 0x5', quantity: '56,300' },
  })
  assert.match(withQuantity, /▪️ Bon n°BL-1\n▪️ Destination : Bouaké\n▪️ Marchandise : Sable 0x5\n▪️ Quantité : 56,300\nCordialement,/)

  const withoutQuantity = buildFleetAlertWhatsAppMessage({
    event: 'speedup',
    truckLabel: 'TG 1234 AB',
    time: '2026-05-07T12:34:00.000Z',
    mission: { reference: 'BL-1', destination: 'Bouaké', goods: 'Sable 0x5' },
  })
  assert.doesNotMatch(withoutQuantity, /Quantité/)
})

test('buildFleetAlertWhatsAppMessage n’affiche pas de bloc mission sans mission active', () => {
  const message = buildFleetAlertWhatsAppMessage({
    event: 'excessive_parking',
    truckLabel: '3100WWCI01',
    time: '2026-05-08T09:09:00.000Z',
    lat: 5.5774149,
    lng: -3.1890516,
  })

  assert.doesNotMatch(message, /Mission en cours/)
})

test('buildGeofenceAlertWhatsAppMessage inclut action, zone, position, heure et mission', () => {
  const message = buildGeofenceAlertWhatsAppMessage({
    eventType: 'enter',
    geofenceName: 'Korhogo client',
    trackerId: 42,
    truckLabel: 'TG 1234 AB',
    driver: 'Kouadio Jean',
    speed: 35,
    time: '2026-05-08T10:15:00.000Z',
    lat: 5.2662133,
    lng: -4.0027433,
    address: 'Korhogo',
    mission: { reference: 'BL-2026-002', client: 'Société Y', destination: 'Korhogo', goods: 'Arachides' },
  })

  assert.doesNotMatch(message, /^Teliman Logistique/, 'plus de titre en haut : le logo est joint à l\'alerte')
  assert.match(message, /^Le véhicule TG 1234 AB \(Kouadio Jean\) vient d'entrer dans la zone « Korhogo client » à 35 km\/h\./)
  assert.doesNotMatch(message, /Client :/, 'la ligne client a été retirée du bloc mission')
  assert.match(message, /TG 1234 AB/)
  assert.match(message, /Kouadio Jean/)
  assert.match(message, /35 km\/h/)
  assert.match(message, /Korhogo/)
  assert.match(message, /maps\.google\.com/)
  assert.doesNotMatch(message, /Position :/)
  assert.match(message, /Mission en cours/)
  assert.match(message, /Bon n°BL-2026-002/)
  assert.match(message, /L'équipe Teliman Logistique$/)
})

test('buildGeofenceAlertWhatsAppMessage gère la sortie de zone', () => {
  const message = buildGeofenceAlertWhatsAppMessage({
    eventType: 'exit',
    geofenceName: 'Bouaké carrière',
    trackerId: 7,
    truckLabel: 'CI-2026-TL',
    time: '2026-05-08T11:00:00.000Z',
    lat: 7.6938,
    lng: -5.0303,
  })

  assert.doesNotMatch(message, /^Teliman Logistique/)
  assert.match(message, /^Le véhicule CI-2026-TL vient de sortir de la zone « Bouaké carrière »\./)
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
  assert.ok(calls.every((call) => call.message.includes("est à l'arrêt")))
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
    alertLogoEnabled: true,
    alertLogoPath: '',
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

test('buildImagePreview fournit un aperçu JPEG 32 px + les dimensions d’origine', async () => {
  const sharp = (await import('sharp')).default
  const jpeg = await sharp({ create: { width: 320, height: 72, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()

  const preview = await buildImagePreview(jpeg, { warn() {} })
  assert.equal(preview.width, 320, 'largeur d’origine conservée')
  assert.equal(preview.height, 72, 'hauteur d’origine conservée')
  assert.ok(preview.jpegThumbnail?.length > 0, 'aperçu produit')
  // Vrai JPEG en sortie (signature SOI) — sinon WhatsApp affiche une vignette cassée
  assert.equal(preview.jpegThumbnail[0], 0xff)
  assert.equal(preview.jpegThumbnail[1], 0xd8)

  // Une donnée non image ne doit jamais lever : l’envoi continue sans aperçu
  assert.deepEqual(await buildImagePreview(Buffer.from('pas une image'), { warn() {} }), {})
})

test('l’envoi avec logo joint l’aperçu et les dimensions (image affichée entière dans WhatsApp)', async () => {
  const sharp = (await import('sharp')).default
  const jpeg = await sharp({ create: { width: 320, height: 72, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  const dir = mkdtempSync(join(tmpdir(), 'teliman-wa-img-'))
  const logoPath = join(dir, 'teliman-logistique-logo.jpg')
  writeFileSync(logoPath, jpeg)

  const sent = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-img-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: 'MSG-IMG' } } },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+221 77 626 00 20', 'Alerte avec logo', { imagePath: logoPath })

  assert.equal(result.sent, true)
  assert.equal(result.media, 'logo')
  const payload = sent.at(-1)?.payload
  assert.ok(payload?.image?.length, 'image jointe')
  assert.equal(payload.caption, 'Alerte avec logo')
  assert.equal(payload.width, 320, 'dimensions transmises (cadrage correct)')
  assert.equal(payload.height, 72, 'dimensions transmises (cadrage correct)')
  assert.ok(payload.jpegThumbnail?.length > 0, 'aperçu transmis — sans lui WhatsApp zoome/recadre l’image')
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

// --- Logo Teliman Logistique sur les alertes WhatsApp ---------------------------

test('buildWhatsAppConfigFromEnv lit le logo des alertes (chemin + activation)', () => {
  const config = buildWhatsAppConfigFromEnv({ WHATSAPP_ALERT_LOGO_PATH: '/srv/teliman/logo.jpg' })
  assert.equal(config.alertLogoPath, '/srv/teliman/logo.jpg')
  assert.equal(config.alertLogoEnabled, true, 'logo actif par défaut')
  assert.equal(buildWhatsAppConfigFromEnv({ WHATSAPP_ALERT_LOGO: 'false' }).alertLogoEnabled, false)
})

test('resolveAlertLogoPath renvoie le logo des alertes actives seulement', () => {
  assert.equal(resolveAlertLogoPath({ alertLogoPath: '/tmp/logo.jpg' }), '/tmp/logo.jpg')
  assert.equal(resolveAlertLogoPath({ alertLogoPath: '/tmp/logo.jpg', alertLogoEnabled: false }), '')
  assert.equal(resolveAlertLogoPath({}), '')
  assert.equal(resolveAlertLogoPath(), '')
})

test('sendWhatsAppTextMessage joint le logo aux alertes et jamais aux BL', async () => {
  const jobs = []
  const config = { enabled: true, provider: 'baileys', alertLogoPath: '/tmp/logo.jpg', baileysQueue: { enqueue: (job) => jobs.push(job) } }
  const baileysClient = { sendText: async () => ({ sent: true }) }

  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Alerte flotte', config, baileysClient, context: { source: 'fleet_alert' } })
  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Sortie zone', config, baileysClient, context: { source: 'geofence' } })
  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'BL créé', config, baileysClient, context: { source: 'delivery_order' } })

  assert.equal(jobs[0].imagePath, '/tmp/logo.jpg', 'alerte flotte habillée du logo')
  assert.equal(jobs[1].imagePath, '/tmp/logo.jpg', 'alerte géofence habillée du logo')
  assert.equal(jobs[2].imagePath, '', 'notification BL en texte seul')
  assert.equal(jobs[0].deferrable, false)
  assert.equal(jobs[2].deferrable, true)
})

test('sendWhatsAppTextMessage n’ajoute pas de logo quand la fonctionnalité est désactivée', async () => {
  const jobs = []
  const config = { enabled: true, provider: 'baileys', alertLogoPath: '/tmp/logo.jpg', alertLogoEnabled: false, baileysQueue: { enqueue: (job) => jobs.push(job) } }

  await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Alerte flotte', config, baileysClient: { sendText: async () => ({ sent: true }) }, context: { source: 'fleet_alert' } })

  assert.equal(jobs[0].imagePath, '')
})

test('les alertes flotte et géofence partent avec le logo en pièce jointe (image + légende)', async () => {
  const logoPath = createTestLogoFile()
  const sent = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload })
        return { key: { id: 'MSG-LOGO' } }
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
    typingSimulation: false,
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  const message = buildFleetAlertWhatsAppMessage({ event: 'speedup', truckLabel: 'TG 1234 AB', speed: 92, time: '2026-09-11T10:00:00.000Z' })
  const result = await client.sendText('+225 07 01 02 03 04', message, { imagePath: logoPath })

  assert.equal(result.sent, true)
  assert.equal(result.media, 'logo')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].payload.caption, message, 'le texte de l’alerte devient la légende de l’image')
  assert.equal(sent[0].payload.mimetype, 'image/jpeg')
  assert.ok(Buffer.isBuffer(sent[0].payload.image), 'le logo est envoyé en buffer')
  assert.match(sent[0].payload.caption, /Teliman Logistique/)
})

test('un logo illisible ne fait PAS perdre l’alerte : repli en texte seul', async () => {
  const sent = []
  const warnings = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload })
        return { key: { id: 'MSG-TEXT' } }
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
    typingSimulation: false,
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  const result = await client.sendText('+225 07 01 02 03 04', 'Alerte zone', { imagePath: '/tmp/logo-inexistant-teliman.jpg' })

  assert.equal(result.sent, true)
  assert.equal(result.media, 'text')
  assert.deepEqual(sent.map((entry) => entry.payload), [{ text: 'Alerte zone' }])
  assert.ok(warnings.some((line) => /logo introuvable/.test(line)))
})

test('une légende trop longue (> 1024) part en texte seul au lieu d’être tronquée par WhatsApp', async () => {
  const logoPath = createTestLogoFile()
  const sent = []
  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir: '/tmp/teliman-wa-test',
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async (jid, payload) => {
        sent.push({ jid, payload })
        return { key: { id: 'MSG-LONG' } }
      },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
    typingSimulation: false,
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  const longMessage = 'A'.repeat(1100)
  const result = await client.sendText('+225 07 01 02 03 04', longMessage, { imagePath: logoPath })

  assert.equal(result.media, 'text')
  assert.equal(sent[0].payload.text, longMessage)
  assert.equal(sent[0].payload.image, undefined)
})

test('l’historique WhatsApp enregistre le mode d’envoi (logo ou texte)', () => {
  const withLogo = createWhatsAppHistoryEntry({
    result: { source: 'geofence', recipient: '22177000000', sent: true, media: 'logo' },
    message: 'Alerte zone',
    source: 'geofence',
    now: () => '2026-09-11T10:00:00.000Z',
  })
  const withoutLogo = createWhatsAppHistoryEntry({ result: { sent: true, media: 'text' }, message: 'Alerte zone', source: 'geofence' })

  assert.equal(withLogo.media, 'logo')
  assert.equal(withLogo.status, 'sent')
  assert.equal(withoutLogo.media, 'text')
})

// --- Protection des creds WhatsApp (pas de scan QR inutile) ---------------------

test('resolveCredsPurgeAction ne détruit les creds qu’après 3 refus 401 consécutifs', () => {
  // Un 401 ISOLÉ ne doit jamais coûter un scan QR : les 401 transitoires
  // (« Connection Failure », « conflict: device_removed » fantôme) sont fréquents
  // lors des reconnexions → on garde les creds et on retente.
  assert.equal(resolveCredsPurgeAction({ statusCode: 401 }), 'retry_with_creds')
  assert.equal(resolveCredsPurgeAction({ message: 'Unauthorized connection' }), 'retry_with_creds')
  assert.equal(resolveCredsPurgeAction({ statusCode: 401, consecutive401: 2, max401BeforeQr: 3 }), 'retry_with_creds')

  // 3e refus consécutif (aucune connexion réussie entre-temps) → session morte
  assert.equal(resolveCredsPurgeAction({ statusCode: 401, consecutive401: 3, max401BeforeQr: 3 }), 'purge_invalid')
  assert.equal(resolveCredsPurgeAction({ statusCode: 401, consecutive401: 9, max401BeforeQr: 3 }), 'purge_invalid')

  // Déconnexions réseau transitoires → creds TOUJOURS conservés, même après des heures
  for (const message of ['Connection Failure', 'Connection Terminated', 'WebSocket Error ()', 'Stream Errored (restart required)']) {
    assert.equal(resolveCredsPurgeAction({ statusCode: null, message }), 'keep', message)
  }
  assert.equal(resolveCredsPurgeAction({}), 'keep')
})

test('le client restaure les creds depuis le snapshot au démarrage (aucun scan QR)', async () => {
  const authDir = join(mkdtempSync(join(tmpdir(), 'teliman-client-auth-')), 'whatsapp-auth')
  const backupRoot = join(mkdtempSync(join(tmpdir(), 'teliman-client-backups-')), 'backups')
  mkdirSync(join(backupRoot, '20260911T155411Z'), { recursive: true })
  writeFileSync(join(backupRoot, '20260911T155411Z', 'creds.json'), '{"registrationId":42}')
  assert.equal(existsSync(join(authDir, 'creds.json')), false)

  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir,
    authBackupDir: backupRoot,
    socketFactory: async () => ({ ev: { on: (name, handler) => { handlers[name] = handler } } }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()

  assert.equal(readFileSync(join(authDir, 'creds.json'), 'utf8'), '{"registrationId":42}', 'creds restaurés sur disque')
  assert.equal(client.getStatus().credsRestoredFrom, '20260911T155411Z')
  assert.equal(client.getStatus().credsProtection, true)
})

test('le client ne restaure pas de creds périmés par-dessus une purge volontaire', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'teliman-client-auth-'))
  const backupRoot = join(mkdtempSync(join(tmpdir(), 'teliman-client-backups-')), 'backups')
  mkdirSync(join(backupRoot, '20260911T155411Z'), { recursive: true })
  writeFileSync(join(backupRoot, '20260911T155411Z', 'creds.json'), '{"registrationId":42}')
  writeFileSync(join(authDir, 'creds.json'), '{"registrationId":"mort"}')

  const handlers = {}
  const client = createBaileysWhatsAppClient({
    authDir,
    authBackupDir: backupRoot,
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async () => ({ key: { id: 'MSG' } }),
      logout: async () => {},
      end: () => {},
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    logger: { info() {}, warn() {}, error() {} },
    typingSimulation: false,
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  // Déconnexion demandée : purge volontaire → le snapshot ne doit pas ressusciter ces creds
  await client.disconnect({ clearSession: true })
  assert.equal(existsSync(join(authDir, 'creds.json')), false, 'creds purgés')

  await client.reconnect({ clearSession: false })
  assert.equal(existsSync(join(authDir, 'creds.json')), false, 'pas de restauration automatique après une purge volontaire')
})

test('le client conserve les creds sur 401 isolé et ne les archive qu’après 3 refus consécutifs', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'teliman-client-auth-'))
  const backupRoot = join(mkdtempSync(join(tmpdir(), 'teliman-client-backups-')), 'backups')
  writeFileSync(join(authDir, 'creds.json'), '{"registrationId":7}')

  const handlers = {}
  let cleaned = 0
  const client = createBaileysWhatsAppClient({
    authDir,
    authBackupDir: backupRoot,
    socketFactory: async () => ({ ev: { on: (name, handler) => { handlers[name] = handler } } }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    sessionCleaner: async () => { cleaned += 1 },
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  assert.ok(client.getStatus().lastCredsSnapshot, 'un snapshot est pris à la connexion')
  assert.equal(client.getStatus().lastCredsSnapshotAt?.length > 0, true)

  const unauthorized = {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 }, message: 'Unauthorized' } },
  }

  // 401 isolés (coupure réseau, « device_removed » transitoire) : creds CONSERVÉS
  await handlers['connection.update'](unauthorized)
  assert.equal(cleaned, 0, 'aucune purge au 1er 401')
  assert.equal(existsSync(join(authDir, 'creds.json')), true, 'les creds restent en place')
  await handlers['connection.update'](unauthorized)
  assert.equal(cleaned, 0, 'aucune purge au 2e 401')

  // 3e refus consécutif sans connexion réussie : session écartée (creds archivés)
  await handlers['connection.update'](unauthorized)
  assert.equal(cleaned, 1, 'session écartée au 3e refus consécutif')
  const snapshotNames = (await listAuthSnapshots(backupRoot)).map((snapshot) => snapshot.name)
  assert.ok(snapshotNames.length >= 1, 'snapshot conservé avant purge')
  assert.ok(snapshotNames.some((name) => name === client.getStatus().lastCredsSnapshot))
})

test('un verrou d’instance périmé (PID recyclé) ne laisse plus la passerelle muette', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'teliman-client-lock-'))
  writeFileSync(join(authDir, 'creds.json'), '{"registrationId":1}')
  // Cas réel du 23/09/2026 : verrou laissé par un process d'AVANT le redémarrage,
  // dont le PID a été recyclé par un autre programme (ici PID 1 = init). L'ancien
  // code refusait de se connecter indéfiniment → aucun message ne partait.
  writeFileSync(`${authDir}.lock`, JSON.stringify({ pid: 1, at: '2026-09-11T00:00:00.000Z' }))

  const handlers = {}
  let socketCreated = 0
  const client = createBaileysWhatsAppClient({
    authDir,
    socketFactory: async () => { socketCreated += 1; return { ev: { on: (name, handler) => { handlers[name] = handler } } } },
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  assert.equal(socketCreated, 1, 'un verrou périmé ne doit pas empêcher la connexion')
  const lock = JSON.parse(readFileSync(`${authDir}.lock`, 'utf8'))
  assert.equal(lock.pid, process.pid, 'le verrou est repris par le process courant')

  // La protection reste réelle pour un VRAI conflit (même programme, PID vivant) :
  // couvert par les cas unitaires de evaluateInstanceLock.
})

test('createOutboundMessageCache : garde les sortants, expire par TTL et borne la mémoire', () => {
  let clock = 0
  const cache = createOutboundMessageCache({ max: 2, ttlMs: 1_000, now: () => clock })

  cache.remember('A', { conversation: 'A' })
  cache.remember('B', { conversation: 'B' })
  assert.deepEqual(cache.get('A'), { conversation: 'A' })

  // Plafond atteint → le plus ancien est évincé (A part, B et C restent)
  clock = 500
  cache.remember('C', { conversation: 'C' })
  assert.equal(cache.get('A'), undefined, 'plus ancien évincé au-delà du plafond')
  assert.equal(cache.size(), 2)

  // TTL dépassé → plus rien de renvoyable
  clock = 2_000
  assert.equal(cache.get('B'), undefined)
  assert.equal(cache.get('C'), undefined)
  assert.equal(cache.size(), 0)

  // Robustesse : identifiant ou contenu manquant ne pollue pas la mémoire
  cache.remember('', { conversation: 'x' })
  cache.remember('D', null)
  assert.equal(cache.size(), 0)
})

test('WhatsApp demande un renvoi (retry) : le message sortant est renvoyé, un message hors mémoire ne lève pas', async () => {
  const authDir = mkdtempSync(join(tmpdir(), 'teliman-wa-retry-'))
  const handlers = {}
  const sent = []
  let factoryArgs = null
  const client = createBaileysWhatsAppClient({
    authDir,
    socketFactory: async (args) => {
      factoryArgs = args
      return {
        ev: { on: (name, handler) => { handlers[name] = handler } },
        onWhatsApp: async (jid) => [{ jid, exists: true }],
        sendMessage: async (jid, payload) => {
          sent.push({ jid, payload })
          return { key: { id: `MSG-${sent.length}`, remoteJid: jid }, message: payload }
        },
      }
    },
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'data:image/png;base64,x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  // Sans getMessage, Baileys (défaut : async () => undefined) ne peut RIEN renvoyer :
  // le destinataire reste bloqué à vie sur « En attente de ce message… ».
  assert.equal(typeof factoryArgs.getMessage, 'function', 'getMessage transmis à la socket')

  await handlers['connection.update']({ connection: 'open' })
  const result = await client.sendText('+221 77 620 00 20', 'Le véhicule 4400WWCI01 est sorti de zone')
  assert.equal(result.sent, true)

  const renvoye = await factoryArgs.getMessage({ id: result.messageId, remoteJid: '221776260020@s.whatsapp.net' })
  assert.deepEqual(renvoye, { text: 'Le véhicule 4400WWCI01 est sorti de zone' }, 'contenu du message renvoyé tel quel')
  assert.equal(client.getStatus().retryRequestsServed, 1)
  assert.equal(client.getStatus().outboundMessagesCached, 1)

  assert.equal(await factoryArgs.getMessage({ id: 'INCONNU', remoteJid: 'x@s.whatsapp.net' }), undefined)
  assert.equal(client.getStatus().retryRequestsMissed, 1)
  assert.equal(client.getStatus().retryRequestsServed, 1, 'un renvoi impossible ne compte pas comme servi')
})

test('un 401 réarme la relance : le start() programmé retente vraiment (sinon muet, sans QR)', async () => {
  const handlers = {}
  let sockets = 0
  const client = createBaileysWhatsAppClient({
    authDir: mkdtempSync(join(tmpdir(), 'teliman-wa-401-')),
    socketFactory: async () => {
      sockets += 1
      return { ev: { on: (name, handler) => { handlers[name] = handler } } }
    },
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  assert.equal(sockets, 1)

  // WhatsApp refuse la session (401) : creds conservés + relance programmée
  const error = Object.assign(new Error('Connection Failure'), { output: { statusCode: 401 } })
  await handlers['connection.update']({ connection: 'close', lastDisconnect: { error } })
  assert.equal(client.getStatus().state, 'disconnected')
  assert.match(String(client.getStatus().lastError), /tentative 1\/3/)

  // Ce que fait le setTimeout interne : la relance doit réellement retenter
  await client.start()
  assert.equal(sockets, 2, 'sans réarmement, start() sortait sans retenter → passerelle muette')
})

test('l’arrêt local ferme la socket SANS délier l’appareil (logout = scan QR forcé)', async () => {
  const handlers = {}
  const calls = { logout: 0, end: 0 }
  const client = createBaileysWhatsAppClient({
    authDir: mkdtempSync(join(tmpdir(), 'teliman-wa-unlink-')),
    socketFactory: async () => ({
      ev: { on: (name, handler) => { handlers[name] = handler } },
      onWhatsApp: async (jid) => [{ jid, exists: true }],
      sendMessage: async () => ({ key: { id: 'M-1' }, message: {} }),
      logout: async () => { calls.logout += 1 },
      end: () => { calls.end += 1 },
    }),
    authStateFactory: async () => ({ state: {}, saveCreds: async () => {} }),
    qrCodeFactory: async () => 'x',
    logger: { info() {}, warn() {}, error() {} },
  })

  await client.start()
  await handlers['connection.update']({ connection: 'open' })

  // Ce que fait shutdown() de server.js à chaque redémarrage du process
  const result = await client.disconnect({ unlink: false })
  assert.equal(result.remoteUnlinkOk, true)
  assert.equal(calls.logout, 0, 'logout() délierait l’appareil → scan QR à chaque restart')
  assert.equal(calls.end, 1, 'socket fermée localement')
  assert.equal(client.getStatus().connected, false)

  // La déconnexion DEMANDÉE depuis l'interface doit, elle, toujours délier
  await client.start()
  await handlers['connection.update']({ connection: 'open' })
  await client.disconnect()
  assert.equal(calls.logout, 1, 'déconnexion explicite = déliaison réelle')
})

test('verrou d’instance : un PID recyclé ou un verrou d’avant démarrage ne bloque pas la passerelle', () => {
  const bootTimeMs = Date.parse('2026-09-23T05:29:05.000Z')
  const base = { ownPid: 1753, bootTimeMs, ownCommandLine: 'node /home/pi/teliman-tracking-fleeti/server.js' }

  // Pas de verrou, notre propre verrou : utilisables
  assert.equal(evaluateInstanceLock({ ...base, lock: null }).usable, true)
  assert.equal(evaluateInstanceLock({ ...base, lock: { pid: 1753, at: '2026-09-23T05:30:00.000Z' } }).usable, true)

  // Verrou écrit AVANT le démarrage courant (cas réel du 23/09 : PID 1758 d'avant-boot)
  const stale = evaluateInstanceLock({
    ...base,
    lock: { pid: 1758, at: '2026-09-23T03:39:46.358Z' },
    pidAlive: () => true,
    pidCmdLine: () => 'node /home/pi/GymCrew/server/src/server.js',
  })
  assert.equal(stale.usable, true, 'un verrou antérieur au démarrage ne peut pas être vivant')
  assert.match(stale.reason, /recycl|antérieur/i)

  // PID vivant mais appartenant à un AUTRE programme → périmé
  const recycled = evaluateInstanceLock({
    ...base,
    lock: { pid: 1758, at: '2026-09-23T06:00:00.000Z' },
    pidAlive: () => true,
    pidCmdLine: () => 'node /home/pi/EMGA/backend/server.js',
  })
  assert.equal(recycled.usable, true)
  assert.match(recycled.reason, /autre programme/)

  // Conflit RÉEL : même programme, PID vivant, verrou postérieur au démarrage
  const real = evaluateInstanceLock({
    ...base,
    lock: { pid: 1900, at: '2026-09-23T06:00:00.000Z' },
    pidAlive: () => true,
    pidCmdLine: () => 'node /home/pi/teliman-tracking-fleeti/server.js',
  })
  assert.equal(real.usable, false, 'deux processs identiques ne doivent pas partager la session')
  assert.match(real.reason, /déjà utilisée/)

  // PID détenteur disparu
  assert.equal(evaluateInstanceLock({ ...base, lock: { pid: 4242, at: '2026-09-23T06:00:00.000Z' }, pidAlive: () => false }).usable, true)
})

// Horloge manuelle : les timers sont injectés, aucun test n'attend 5 minutes.
function fakeTimers() {
  let seq = 0
  const scheduled = new Map()
  return {
    setTimer: (fn, ms) => {
      const id = ++seq
      scheduled.set(id, { fn, ms })
      return id
    },
    clearTimer: (id) => { scheduled.delete(id) },
    fireAll: () => {
      const entries = [...scheduled.values()]
      scheduled.clear()
      for (const entry of entries) entry.fn()
    },
    count: () => scheduled.size,
    delays: () => [...scheduled.values()].map((entry) => entry.ms),
  }
}

test('une prekey utilisée n’est PLUS supprimée immédiatement (renvoi WhatsApp possible)', async () => {
  const writes = []
  const store = { get: async () => ({}), set: async (data) => { writes.push(data) }, clear: async () => { writes.push('CLEAR') } }
  const timers = fakeTimers()
  const keys = withDelayedPreKeyDeletion(store, { graceMs: 5 * 60_000, setTimer: timers.setTimer, clearTimer: timers.clearTimer })

  // Utilisation d'une prekey → Baileys demande la suppression
  await keys.set({ 'pre-key': { 42: null } })
  assert.deepEqual(writes, [], 'aucune suppression immédiate : un renvoi de WhatsApp passe encore')
  assert.equal(keys.pendingPreKeyDeletions(), 1)
  assert.deepEqual(timers.delays(), [5 * 60_000], 'grâce de 5 minutes')

  timers.fireAll()
  assert.deepEqual(writes, [{ 'pre-key': { 42: null } }], 'suppression appliquée après la grâce')
  assert.equal(keys.pendingPreKeyDeletions(), 0)
})

test('les autres magasins de clés passent immédiatement, et une prekey réécrite annule la suppression', async () => {
  const writes = []
  const store = { get: async () => ({ 1: 'x' }), set: async (data) => { writes.push(data) }, clear: async () => { writes.push('CLEAR') } }
  const timers = fakeTimers()
  const keys = withDelayedPreKeyDeletion(store, { setTimer: timers.setTimer, clearTimer: timers.clearTimer })

  await keys.set({ session: { 'a@s.whatsapp.net': { session: 1 } }, 'pre-key': { 7: null } })
  assert.deepEqual(writes, [{ session: { 'a@s.whatsapp.net': { session: 1 } } }], 'la session part tout de suite')
  assert.equal(keys.pendingPreKeyDeletions(), 1)

  // WhatsApp (re)charge une prekey du même id avant l'échéance → pas de suppression
  await keys.set({ 'pre-key': { 7: { keyPair: 'neuf' } } })
  assert.deepEqual(writes[1], { 'pre-key': { 7: { keyPair: 'neuf' } } })
  assert.equal(keys.pendingPreKeyDeletions(), 0, 'suppression en attente annulée')
  timers.fireAll()
  assert.equal(writes.length, 2, 'aucune suppression différée après réécriture')

  // clear() (logout/purge) annule aussi les suppressions en attente
  await keys.set({ 'pre-key': { 9: null } })
  assert.equal(keys.pendingPreKeyDeletions(), 1)
  await keys.clear()
  assert.equal(keys.pendingPreKeyDeletions(), 0)
  timers.fireAll()
  assert.equal(writes.length, 3, 'rien de ressuscité après un clear')

  // Délégation de lecture intacte
  assert.deepEqual(await keys.get('pre-key', [1]), { 1: 'x' })
})
