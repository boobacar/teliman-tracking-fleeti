const DEFAULT_WHATSAPP_API_VERSION = 'v20.0'

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

  return Array.from(new Set(phoneList.map(normalizeWhatsAppPhone).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

export function detectDeliveryOrderWhatsAppEvents(previousOrder = null, nextOrder = {}) {
  if (!previousOrder) return ['created']

  const events = []
  const previousStatus = String(previousOrder?.status || '').trim()
  const nextStatus = String(nextOrder?.status || '').trim()
  if (previousStatus && nextStatus && previousStatus !== nextStatus) events.push('status_changed')

  const previousDeparture = normalizeComparableDate(previousOrder?.departureDateTime)
  const nextDeparture = normalizeComparableDate(nextOrder?.departureDateTime)
  if (!previousDeparture && nextDeparture) events.push('departed')

  const previousArrival = normalizeComparableDate(previousOrder?.arrivalDateTime)
  const nextArrival = normalizeComparableDate(nextOrder?.arrivalDateTime)
  if (!previousArrival && nextArrival) events.push('arrived')

  return events
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

export function buildWhatsAppConfigFromEnv(env = {}) {
  return {
    enabled: String(env.WHATSAPP_NOTIFICATIONS_ENABLED ?? 'true').toLowerCase() !== 'false',
    provider: String(env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase() || 'meta',
    accessToken: String(env.WHATSAPP_ACCESS_TOKEN || env.META_WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID || env.META_WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    apiVersion: String(env.WHATSAPP_API_VERSION || DEFAULT_WHATSAPP_API_VERSION).trim() || DEFAULT_WHATSAPP_API_VERSION,
    baileysAuthDir: String(env.WHATSAPP_BAILEYS_AUTH_DIR || '').trim(),
  }
}

export async function sendWhatsAppTextMessage({ to, message, config = {}, fetchImpl = fetch, baileysClient = null } = {}) {
  const recipient = normalizeWhatsAppPhone(to)
  if (!recipient) return { sent: false, skipped: true, reason: 'Destinataire WhatsApp manquant.' }
  if (!message) return { sent: false, skipped: true, reason: 'Message WhatsApp vide.' }
  if (config.enabled === false) return { sent: false, skipped: true, reason: 'Notifications WhatsApp désactivées.' }
  if (config.provider === 'baileys') {
    if (!baileysClient) return { sent: false, skipped: true, reason: 'Client Baileys non démarré.' }
    return baileysClient.sendText(recipient, message)
  }
  if (!config.accessToken || !config.phoneNumberId) {
    return { sent: false, skipped: true, reason: 'WhatsApp Cloud API non configurée.' }
  }

  try {
    const apiVersion = config.apiVersion || DEFAULT_WHATSAPP_API_VERSION
    const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        sent: false,
        skipped: false,
        reason: payload?.error?.message || `WhatsApp API HTTP ${response.status}`,
        details: payload,
      }
    }

    return { sent: true, messageId: payload?.messages?.[0]?.id || '', details: payload }
  } catch (error) {
    return { sent: false, skipped: false, reason: error?.message || 'Erreur WhatsApp API.' }
  }
}

export async function sendDeliveryOrderWhatsAppNotifications({ previousOrder = null, order, masterData = {}, config, fetchImpl = fetch, baileysClient = null, templates = DEFAULT_WHATSAPP_TEMPLATES } = {}) {
  const events = detectDeliveryOrderWhatsAppEvents(previousOrder, order)
  const recipients = resolveClientWhatsAppRecipients(order, masterData)

  if (!events.length) return []
  if (!recipients.length) {
    return events.map((eventType) => ({
      eventType,
      sent: false,
      skipped: true,
      reason: `Aucun numéro WhatsApp configuré pour le client ${order?.client || '-'}.`,
    }))
  }

  const results = []
  for (const eventType of events) {
    const message = buildWhatsAppMessageFromTemplate(eventType, order, templates)
    for (const recipient of recipients) {
      const result = await sendWhatsAppTextMessage({ to: recipient, message, config, fetchImpl, baileysClient })
      results.push({ eventType, recipient, ...result })
    }
  }
  return results
}

function templateValue(key, order = {}) {
  if (key === 'date' || key === 'departureDateTime' || key === 'arrivalDateTime') return formatDateTime(order[key])
  return display(order[key])
}

function normalizeComparableDate(value) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value)
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

function display(value) {
  const text = String(value ?? '').trim()
  return text || '-'
}
