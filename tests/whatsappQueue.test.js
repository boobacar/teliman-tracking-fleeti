import test from 'node:test'
import assert from 'node:assert/strict'
import { createWhatsAppQueue, dayKey, isWithinSendHours, makeWarmupDailyLimit } from '../src/backend/whatsappQueue.js'
import { buildWhatsAppConfigFromEnv, sendWhatsAppTextMessage } from '../src/backend/whatsappNotifications.js'

test('dayKey bascule à minuit', () => {
  assert.equal(dayKey(new Date('2026-08-06T23:59:00Z')), '2026-08-06')
  assert.equal(dayKey(new Date('2026-08-07T00:00:01Z')), '2026-08-07')
})

test('la file envoie séquentiellement avec un débit minimal', async () => {
  const sentAt = []
  const queue = createWhatsAppQueue({
    sendFn: async () => { sentAt.push(Date.now()); return { sent: true } },
    minIntervalMs: 50,
  })
  queue.enqueue({ to: 'a' })
  queue.enqueue({ to: 'b' })
  queue.enqueue({ to: 'c' })
  await new Promise((resolve) => setTimeout(resolve, 500))
  queue.stop()
  assert.equal(sentAt.length, 3)
  assert.ok(sentAt[1] - sentAt[0] >= 45, `écart 1-2=${sentAt[1] - sentAt[0]}ms`)
  assert.ok(sentAt[2] - sentAt[1] >= 45, `écart 2-3=${sentAt[2] - sentAt[1]}ms`)
  assert.equal(queue.status().queued, 0)
})

test('la file retente un échec API puis renonce après maxRetries', async () => {
  let attempts = 0
  const queue = createWhatsAppQueue({
    sendFn: async () => { attempts += 1; return { sent: false, skipped: false, reason: '5xx' } },
    minIntervalMs: 10,
    maxRetries: 2,
  })
  let finalResult = null
  queue.enqueue({ to: 'a', onResult: (result) => { finalResult = result } })
  await new Promise((resolve) => setTimeout(resolve, 400))
  queue.stop()
  assert.equal(attempts, 3) // 1 essai + 2 retries
  assert.equal(finalResult.sent, false)
  assert.equal(queue.status().failedToday, 1)
  assert.equal(queue.status().retried, 2)
})

test('la file respecte le plafond journalier', async () => {
  const queue = createWhatsAppQueue({
    sendFn: async () => ({ sent: true }),
    minIntervalMs: 5,
    dailyLimit: 2,
  })
  queue.enqueue({ to: 'a' })
  queue.enqueue({ to: 'b' })
  queue.enqueue({ to: 'c' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  queue.stop()
  const status = queue.status()
  assert.equal(status.sentToday, 2)
  assert.ok(status.queued >= 1, 'le 3e reste en file')
  assert.equal(queue.status().queued, 1)
})

test('hors fenêtre horaire : les jobs deferrable restent en file, les alertes passent', async () => {
  // Heure serveur fixée à 03:00 — fenêtre 7-21 fermée
  const nowMs = Date.UTC(2026, 7, 19, 3, 0)
  const sent = []
  const queue = createWhatsAppQueue({
    sendFn: async (job) => { sent.push(job.to); return { sent: true } },
    minIntervalMs: 10,
    sendHours: { start: 7, end: 21 },
    now: () => nowMs,
  })
  queue.enqueue({ to: 'bl-client' }) // deferrable par défaut
  queue.enqueue({ to: 'alerte-vitesse', deferrable: false })
  await new Promise((resolve) => setTimeout(resolve, 250))
  queue.stop()

  assert.deepEqual(sent, ['alerte-vitesse'], 'seule l’alerte part hors fenêtre')
  assert.equal(queue.status().queued, 1, 'le BL reste en file')
  assert.equal(queue.status().outsideSendHours, true)
})

test('dans la fenêtre horaire : tous les jobs partent, deferrable compris', async () => {
  const sent = []
  const queue = createWhatsAppQueue({
    sendFn: async (job) => { sent.push(job.to); return { sent: true } },
    minIntervalMs: 5,
    sendHours: { start: 0, end: 24 }, // toujours ouvert
  })
  queue.enqueue({ to: 'bl-client' })
  queue.enqueue({ to: 'alerte-vitesse', deferrable: false })
  await new Promise((resolve) => setTimeout(resolve, 200))
  queue.stop()

  assert.equal(sent.length, 2)
  assert.equal(queue.status().outsideSendHours, false)
})

test('isWithinSendHours gère les fenêtres enveloppées (21-7)', () => {
  const night = { start: 21, end: 7 }
  assert.equal(isWithinSendHours(22, night), true)
  assert.equal(isWithinSendHours(3, night), true)
  assert.equal(isWithinSendHours(12, night), false)
  assert.equal(isWithinSendHours(8, night), false)
  assert.equal(isWithinSendHours(21, night), true)
  assert.equal(isWithinSendHours(7, night), false, 'end exclusif')
  assert.equal(isWithinSendHours(12, null), true, 'sans fenêtre configurée : toujours ouvert')
})

test('sendWhatsAppTextMessage passe par la file quand config.queue est présent', async () => {
  const jobs = []
  const queue = { enqueue: (job) => jobs.push(job) }
  const config = buildWhatsAppConfigFromEnv({})
  const result = await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Test', config: { ...config, accessToken: 'T', phoneNumberId: '1', queue } })
  assert.equal(result.queued, true)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].to, '2250701020304')
  assert.equal(jobs[0].config.queue, null) // pas de récursion
})

test('sendWhatsAppTextMessage utilise le template hors fenêtre 24h', async () => {
  const calls = []
  const fakeFetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid-t' }] }) }
  }
  const config = buildWhatsAppConfigFromEnv({
    WHATSAPP_ACCESS_TOKEN: 'T',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    WHATSAPP_DEFAULT_TEMPLATE_NAME: 'teliman_notification',
  })
  const result = await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Alerte !', config, fetchImpl: fakeFetch })
  assert.equal(result.sent, true)
  assert.equal(calls[0].type, 'template')
  assert.equal(calls[0].template.name, 'teliman_notification')
  assert.equal(calls[0].template.components[0].parameters[0].text, 'Alerte !')
})

test('sendWhatsAppTextMessage envoie en texte libre si la fenêtre 24h est ouverte', async () => {
  const calls = []
  const fakeFetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid-t' }] }) }
  }
  const config = buildWhatsAppConfigFromEnv({
    WHATSAPP_ACCESS_TOKEN: 'T',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    WHATSAPP_DEFAULT_TEMPLATE_NAME: 'teliman_notification',
  })
  config.windowCheck = () => true
  const result = await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Réponse', config, fetchImpl: fakeFetch })
  assert.equal(result.sent, true)
  assert.equal(calls[0].type, 'text')
})

test('sendWhatsAppTextMessage bascule sur template quand Meta rejette le texte hors fenêtre', async () => {
  const calls = []
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    calls.push(body.type)
    if (body.type === 'text') return { ok: false, json: async () => ({ error: { message: '(#131047) requires template', code: 131047 } }) }
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid-fallback' }] }) }
  }
  const config = buildWhatsAppConfigFromEnv({
    WHATSAPP_ACCESS_TOKEN: 'T',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    WHATSAPP_DEFAULT_TEMPLATE_NAME: 'teliman_notification',
  })
  config.windowCheck = () => true // fenêtre supposée ouverte mais Meta dit non
  const result = await sendWhatsAppTextMessage({ to: '2250701020304', message: 'Salut', config, fetchImpl: fakeFetch })
  assert.deepEqual(calls, ['text', 'template'])
  assert.equal(result.sent, true)
  assert.equal(result.messageId, 'wamid-fallback')
})

test('la file applique un jitter quand minIntervalMs est une plage', async () => {
  const sentAt = []
  const queue = createWhatsAppQueue({
    sendFn: async () => { sentAt.push(Date.now()); return { sent: true } },
    minIntervalMs: { min: 30, max: 60 },
  })
  queue.enqueue({ to: 'a' })
  queue.enqueue({ to: 'b' })
  queue.enqueue({ to: 'c' })
  await new Promise((resolve) => setTimeout(resolve, 500))
  queue.stop()
  assert.equal(sentAt.length, 3)
  assert.ok(sentAt[1] - sentAt[0] >= 25, `écart 1-2=${sentAt[1] - sentAt[0]}ms`)
  assert.ok(sentAt[2] - sentAt[1] >= 25, `écart 2-3=${sentAt[2] - sentAt[1]}ms`)
})

test('la file applique un warm-up progressif via une fonction dailyLimit', async () => {
  const queue = createWhatsAppQueue({
    sendFn: async () => ({ sent: true }),
    minIntervalMs: 5,
    dailyLimit: makeWarmupDailyLimit({ start: 2, rampPerDay: 1, max: 10 }),
  })
  queue.enqueue({ to: 'a' })
  queue.enqueue({ to: 'b' })
  queue.enqueue({ to: 'c' })
  queue.enqueue({ to: 'd' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  queue.stop()
  const status = queue.status()
  assert.equal(status.sentToday, 2, 'jour 0 : plafond = start (2)')
  assert.equal(status.queued, 2, 'les 2 suivants restent en file')
})

test('le circuit-breaker met la file en pause après trop d’échecs consécutifs puis reprend', async () => {
  let attempts = 0
  const queue = createWhatsAppQueue({
    sendFn: async () => { attempts += 1; return { sent: false, skipped: false, reason: '5xx' } },
    minIntervalMs: 10,
    maxRetries: 0,
    circuitBreaker: { maxConsecutiveFailures: 2, cooldownMs: 150 },
  })
  queue.enqueue({ to: 'a' })
  queue.enqueue({ to: 'b' })
  await new Promise((resolve) => setTimeout(resolve, 120))
  let status = queue.status()
  assert.equal(attempts, 2)
  assert.equal(status.paused, true, 'pause déclenchée après 2 échecs consécutifs')
  assert.ok(status.pausedUntil > Date.now(), 'pausedUntil dans le futur')

  // Après le cooldown, la file reprend
  await new Promise((resolve) => setTimeout(resolve, 250))
  queue.enqueue({ to: 'c' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  queue.stop()
  status = queue.status()
  assert.equal(status.paused, false, 'pause levée après cooldown')
  assert.equal(attempts, 3, 'le 3e job part après le cooldown')
})
