// Notifications WhatsApp — canal Baileys uniquement (le canal Meta Cloud API a été retiré).
// Envois : BL (création / arrivée), alertes flotte (vitesse, stationnement), alertes géofence.
const EVENT_TITLES = {
  created: 'Création de BL',
  status_changed: 'Changement de statut',
  departed: 'Départ confirmé',
  arrived: 'Arrivée confirmée',
}

export const DEFAULT_WHATSAPP_TEMPLATES = {
  created: 'TELIMAN LOGISTIQUE - Création de BL\n\nRéférence BL: {{reference}}\nClient: {{client}}\nStatut: {{status}}\nCamion: {{truckLabel}}\nChauffeur: {{driver}}\nPoint de chargement: {{loadingPoint}}\nDestination: {{destination}}\nMarchandise: {{goods}}\nQuantité: {{quantity}}\nDate création: {{date}}\nDépart: {{departureDateTime}}\nArrivée: {{arrivalDateTime}}\nNotes: {{notes}}\n\nMerci de votre confiance.',
  status_changed: 'TELIMAN LOGISTIQUE - Changement de statut\n\nRéférence BL: {{reference}}\nClient: {{client}}\nNouveau statut: {{status}}\nCamion: {{truckLabel}}\nChauffeur: {{driver}}\nDestination: {{destination}}\n\nMerci de votre confiance.',
  departed: 'TELIMAN LOGISTIQUE - Départ confirmé\n\nRéférence BL: {{reference}}\nClient: {{client}}\nCamion: {{truckLabel}}\nChauffeur: {{driver}}\nDépart: {{departureDateTime}}\nPoint de chargement: {{loadingPoint}}\nDestination: {{destination}}\nMarchandise: {{goods}}\nQuantité: {{quantity}}\nNotes: {{notes}}\n\nMerci de votre confiance.',
  arrived: 'TELIMAN LOGISTIQUE - Arrivée confirmée\n\nRéférence BL: {{reference}}\nClient: {{client}}\nCamion: {{truckLabel}}\nChauffeur: {{driver}}\nArrivée: {{arrivalDateTime}}\nDestination: {{destination}}\nMarchandise: {{goods}}\nQuantité: {{quantity}}\n\nMerci de votre confiance.',
}

export function normalizeWhatsAppPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('225')) return digits
  if (digits.length === 10 && digits.startsWith('0')) return `225${digits}`
  return digits
}

export function resolveClientWhatsAppRecipients(order = {}, masterData = {}) {
  const client = String(order?.client || '').trim()
  if (!client) return []

  const clientPhones = masterData?.clientPhones || {}
  const exactPhones = clientPhones[client]
  const caseInsensitiveEntry = exactPhones
    ? null
    : Object.entries(clientPhones).find(([name]) => String(name || '').trim().toLowerCase() === client.toLowerCase())
  const rawPhones = exactPhones ?? caseInsensitiveEntry?.[1] ?? []
  const phoneList = Array.isArray(rawPhones) ? rawPhones : [rawPhones]

  return normalizeWhatsAppPhoneList(phoneList)
}

export function resolveAlertWhatsAppRecipients(eventType, masterData = {}) {
  const normalizedEvent = normalizeFleetAlertEventType(eventType)
  if (!normalizedEvent) return []
  const recipients = masterData?.alertWhatsAppRecipients?.[normalizedEvent] ?? []
  return normalizeWhatsAppPhoneList(recipients)
}

export function buildFleetAlertWhatsAppMessage(event = {}) {
  const eventType = normalizeFleetAlertEventType(event.event || event.eventType)
  const label = fleetAlertLabel(eventType)
  const truckLabel = display(event.truckLabel || event.trackerLabel || event.label || event.registration || event.plate || event.tracker_id)
  const driver = display(event.driver || event.driverName || event.employeeName)
  const time = formatDateTime(event.time || event.createdAt || event.sentAt)
  const speed = Number(event.speed)
  const speedLine = Number.isFinite(speed) && speed > 0 ? `Vitesse: ${speed} km/h` : ''
  const position = display(event.address || buildAlertCoordinates(event))
  const mapsUrl = buildGoogleMapsUrl(event)
  const driverLine = isUnassignedDriver(driver) ? '' : `Chauffeur: ${driver}`
  const lines = [
    'ALERTE 🚨',
    '',
    `Véhicule: ${truckLabel}`,
    driverLine,
    `Type d’alerte: ${label}`,
    speedLine,
    `Position: ${position}`,
    mapsUrl ? `Carte: ${mapsUrl}` : '',
    `Heure: ${time}`,
    '',
    'Alerte générée automatiquement par Teliman Tracking.',
  ]
  return lines.filter((line) => line !== '').join('\n')
}

export async function sendFleetAlertWhatsAppNotifications({ event, masterData = {}, config, fetchImpl = fetch, baileysClient = null, context = null } = {}) {
  const eventType = normalizeFleetAlertEventType(event?.event || event?.eventType)
  const recipients = resolveAlertWhatsAppRecipients(eventType, masterData)
  if (!eventType) return []
  const message = buildFleetAlertWhatsAppMessage({ ...event, event: eventType })
  if (!recipients.length) {
    return [{
      source: 'fleet_alert',
      eventType,
      sent: false,
      skipped: true,
      reason: `Aucun numéro WhatsApp configuré pour l’alerte ${fleetAlertLabel(eventType)}.`,
      message,
    }]
  }

  const results = []
  for (const recipient of recipients) {
    const result = await sendWhatsAppTextMessage({ to: recipient, message, config, fetchImpl, baileysClient, context: { source: 'fleet_alert', eventType, order: event, ...context } })
    results.push({ source: 'fleet_alert', eventType, recipient, message, ...result })
  }
  return results
}

export function buildGeofenceAlertWhatsAppMessage(event = {}) {
  const eventType = String(event.eventType || '').trim()
  const action = eventType === 'exit' ? 'SORTIE de zone' : 'ENTRÉE en zone'
  const zoneName = display(event.geofenceName || event.zoneName)
  const truckLabel = display(event.truckLabel || event.trackerLabel || event.label || event.tracker_id)
  const driver = display(event.driver || event.driverName || event.employeeName)
  const time = formatDateTime(event.time || event.createdAt || event.sentAt)
  const speed = Number(event.speed)
  const speedLine = Number.isFinite(speed) && speed > 0 ? `Vitesse: ${speed} km/h` : ''
  const position = display(event.address || buildAlertCoordinates(event))
  const mapsUrl = buildGoogleMapsUrl(event)
  const driverLine = isUnassignedDriver(driver) ? '' : `Chauffeur: ${driver}`
  const lines = [
    'ALERTE GÉOFENCE 🚧',
    '',
    `Véhicule: ${truckLabel}`,
    driverLine,
    `${action}: ${zoneName}`,
    speedLine,
    `Position: ${position}`,
    mapsUrl ? `Carte: ${mapsUrl}` : '',
    `Heure: ${time}`,
    '',
    'Alerte générée automatiquement par Teliman Tracking.',
  ]
  return lines.filter((line) => line !== '').join('\n')
}

export async function sendGeofenceAlertWhatsAppNotifications({ event, recipients = [], config = {}, fetchImpl = fetch, baileysClient = null, context = null } = {}) {
  const message = buildGeofenceAlertWhatsAppMessage(event)
  const phoneList = normalizeWhatsAppPhoneList(recipients)
  if (!phoneList.length) {
    return [{
      source: 'geofence',
      eventType: event?.eventType || '',
      sent: false,
      skipped: true,
      reason: 'Aucun numéro d’alerte configuré.',
      message,
    }]
  }
  const results = []
  for (const recipient of phoneList) {
    const result = await sendWhatsAppTextMessage({ to: recipient, message, config, fetchImpl, baileysClient, context: { source: 'geofence', eventType: event?.eventType || '', order: event, ...context } })
    results.push({ source: 'geofence', eventType: event?.eventType || '', recipient, message, ...result })
  }
  return results
}

export function detectDeliveryOrderWhatsAppEvents(previousOrder = null, nextOrder = {}) {
  if (!previousOrder) return ['created']

  const previousStatus = normalizeDeliveryStatus(previousOrder?.status)
  const nextStatus = normalizeDeliveryStatus(nextOrder?.status)
  if (previousStatus !== 'livre' && nextStatus === 'livre') return ['arrived']

  return []
}

export function buildDeliveryOrderWhatsAppMessage(eventType, order = {}) {
  return buildWhatsAppMessageFromTemplate(eventType, order, DEFAULT_WHATSAPP_TEMPLATES)
}

export function buildWhatsAppMessageFromTemplate(eventType, order = {}, templates = DEFAULT_WHATSAPP_TEMPLATES) {
  const template = String(templates?.[eventType] || DEFAULT_WHATSAPP_TEMPLATES[eventType] || DEFAULT_WHATSAPP_TEMPLATES.created)
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => templateValue(key, order))
}

export function buildLegacyDeliveryOrderWhatsAppMessage(eventType, order = {}) {
  const title = EVENT_TITLES[eventType] || 'Mise à jour BL'
  const lines = [
    `TELIMAN LOGISTIQUE - ${title}`,
    '',
    `Référence BL: ${display(order.reference)}`,
    `Client: ${display(order.client)}`,
    `Statut: ${display(order.status)}`,
    `Camion: ${display(order.truckLabel)}`,
    `Chauffeur: ${display(order.driver)}`,
    `Point de chargement: ${display(order.loadingPoint)}`,
    `Destination: ${display(order.destination)}`,
    `Marchandise: ${display(order.goods)}`,
    `Quantité: ${display(order.quantity)}`,
    `Date création: ${formatDateTime(order.date)}`,
    `Départ: ${formatDateTime(order.departureDateTime)}`,
    `Arrivée: ${formatDateTime(order.arrivalDateTime)}`,
  ]

  const notes = String(order.notes || '').trim()
  if (notes) lines.push(`Notes: ${notes}`)

  lines.push('', 'Merci de votre confiance.')
  return lines.join('\n')
}

export function createWhatsAppHistoryEntry({ result = {}, order = {}, message = '', source = 'delivery_order', senderPhone = '', now = () => new Date().toISOString() } = {}) {
  const status = result.sent ? 'sent' : result.skipped ? 'skipped' : 'failed'
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: now(),
    status,
    source,
    eventType: result.eventType || '',
    recipient: result.recipient || '',
    senderPhone: senderPhone || '',
    messageId: result.messageId || '',
    reason: result.reason || '',
    orderId: order?.id || '',
    orderReference: order?.reference || '',
    client: order?.client || '',
    messagePreview: truncateMessagePreview(message),
  }
}

export function buildWhatsAppConfigFromEnv(env = {}) {
  return {
    enabled: String(env.WHATSAPP_NOTIFICATIONS_ENABLED ?? 'true').toLowerCase() !== 'false',
    provider: String(env.WHATSAPP_PROVIDER || 'baileys').trim().toLowerCase() || 'baileys',
    baileysAuthDir: String(env.WHATSAPP_BAILEYS_AUTH_DIR || '').trim(),
    // Simulation de frappe Baileys (composing + délai humain) — protection anti-ban
    baileysTyping: String(env.WHATSAPP_BAILEYS_TYPING ?? 'true').toLowerCase() !== 'false',
    // Cooldown 463 par destinataire (heures) : ne pas re-tenter un contact en Reachout Timelock
    baileys463CooldownHours: Math.max(0, Number(env.WHATSAPP_BAILEYS_463_COOLDOWN_HOURS) || 24),
    // Fenêtre horaire d'envoi (heure serveur locale) : pas d'envoi en rafale la nuit
    sendHours: parseSendHours(env.WHATSAPP_SEND_HOURS_START, env.WHATSAPP_SEND_HOURS_END),
    queueEnabled: String(env.WHATSAPP_QUEUE_ENABLED ?? 'true').toLowerCase() !== 'false',
    // Injecté au démarrage du serveur (pas depuis l'environnement)
    baileysQueue: null,
  }
}

export async function sendWhatsAppTextMessage({ to, message, config = {}, fetchImpl = fetch, baileysClient = null, context = null } = {}) {
  const recipient = normalizeWhatsAppPhone(to)
  if (!recipient) return { sent: false, skipped: true, reason: 'Destinataire WhatsApp manquant.' }
  if (!message) return { sent: false, skipped: true, reason: 'Message WhatsApp vide.' }
  if (config.enabled === false) return { sent: false, skipped: true, reason: 'Notifications WhatsApp désactivées.' }
  // Canal Meta Cloud API retiré : seul le client Baileys (numéro connecté par QR) est actif.
  if (config.provider !== 'baileys' || !baileysClient) {
    return { sent: false, skipped: true, reason: 'Canal Meta désactivé — connectez un numéro via Baileys (QR).' }
  }
  // File dédiée Baileys : throttle avec jitter, warm-up, circuit-breaker, fenêtre
  // horaire (protection anti-ban). La file envoie sans baileysQueue pour éviter la récursion.
  if (config.baileysQueue) {
    const job = { to: recipient, message, config: { ...config, baileysQueue: null }, fetchImpl, context, deferrable: isDeferrableJob(context) }
    config.baileysQueue.enqueue(job)
    return { sent: false, queued: true, reason: 'En file d\u2019attente WhatsApp (Baileys).', recipient }
  }
  return baileysClient.sendText(recipient, message)
}

export async function sendDeliveryOrderWhatsAppNotifications({ previousOrder = null, order, masterData = {}, config, fetchImpl = fetch, baileysClient = null, templates = DEFAULT_WHATSAPP_TEMPLATES, context = null } = {}) {
  const events = detectDeliveryOrderWhatsAppEvents(previousOrder, order)
  const recipients = resolveClientWhatsAppRecipients(order, masterData)

  if (!events.length) return []
  if (!recipients.length) {
    return events.map((eventType) => ({
      eventType,
      sent: false,
      skipped: true,
      reason: `Aucun numéro WhatsApp configuré pour le client ${order?.client || '-'}.`,
      message: buildWhatsAppMessageFromTemplate(eventType, order, templates),
    }))
  }

  const results = []
  for (const eventType of events) {
    const message = buildWhatsAppMessageFromTemplate(eventType, order, templates)
    for (const recipient of recipients) {
      const result = await sendWhatsAppTextMessage({ to: recipient, message, config, fetchImpl, baileysClient, context: { source: 'delivery_order', eventType, order, ...context } })
      results.push({ eventType, recipient, message, ...result })
    }
  }
  return results
}

function templateValue(key, order = {}) {
  if (key === 'date' || key === 'departureDateTime' || key === 'arrivalDateTime') return formatDateTime(order[key])
  return display(order[key])
}

function normalizeWhatsAppPhoneList(value) {
  const items = Array.isArray(value) ? value : [value]
  return Array.from(new Set(items.map(normalizeWhatsAppPhone).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function normalizeFleetAlertEventType(value) {
  const eventType = String(value || '').trim()
  return ['speedup', 'excessive_parking'].includes(eventType) ? eventType : ''
}

function fleetAlertLabel(eventType) {
  if (eventType === 'speedup') return 'Excès de vitesse'
  if (eventType === 'excessive_parking') return 'Stationnement prolongé'
  return 'Alerte flotte'
}

function buildAlertCoordinates(event = {}) {
  const lat = Number(event.lat ?? event.location?.lat)
  const lng = Number(event.lng ?? event.location?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function buildGoogleMapsUrl(event = {}) {
  const lat = Number(event.lat ?? event.location?.lat)
  const lng = Number(event.lng ?? event.location?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `https://maps.google.com/?q=${lat},${lng}`
}

function truncateMessagePreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function normalizeDeliveryStatus(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('fr-FR', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isUnassignedDriver(value) {
  const text = String(value ?? '').trim()
  if (!text || text === '-') return true
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return ['non assigne', 'non-assigne', 'non affecte', 'non-affecte'].includes(normalized)
}

function display(value) {
  const text = String(value ?? '').trim()
  return text || '-'
}

// Les notifications transactionnelles (BL, test manuel) peuvent attendre l'ouverture
// de la fenêtre horaire ; les alertes (flotte, géofence) sont critiques → jamais différées.
function isDeferrableJob(context = null) {
  const source = String(context?.source || '').trim()
  return !['fleet_alert', 'geofence'].includes(source)
}

// Fenêtre horaire d'envoi : {start, end} valides (0-23 pour start, 0-24 pour end) ou null.
function parseSendHours(startValue, endValue) {
  const startText = String(startValue ?? '').trim()
  const endText = String(endValue ?? '').trim()
  if (!startText || !endText) return null
  const start = Number(startText)
  const end = Number(endText)
  if (!Number.isInteger(start) || start < 0 || start > 23) return null
  if (!Number.isInteger(end) || end < 0 || end > 24) return null
  return { start, end }
}
