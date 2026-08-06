// Client WhatsApp Cloud API (Meta Graph) — logique pure et testable.
// Gère : envoi template (messages proactifs hors fenêtre 24 h), envoi texte libre
// (fenêtre de conversation), parsing du webhook, classification des erreurs.

export const WHATSAPP_TEMPLATE_ERROR_CODES = new Set([131026, 131047, 131052])
export const WHATSAPP_RATE_LIMIT_CODES = new Set([130429, 4, 80007])
export const WHATSAPP_TEMPLATE_NOT_FOUND = 131026

export function normalizeWhatsAppPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('225')) return digits
  if (digits.length === 10 && digits.startsWith('0')) return `225${digits}`
  return digits
}

export function extractGraphErrorCode(payload = {}) {
  const error = payload?.error
  if (typeof error?.code === 'number') return error.code
  if (typeof error?.error?.code === 'number') return error.error.code
  const message = String(error?.message || error?.error?.message || payload?.errorMessage || '')
  const match = message.match(/\(#(\d+)\)/)
  return match ? Number(match[1]) : null
}

export function classifyWhatsAppError(payload = {}) {
  const code = extractGraphErrorCode(payload)
  if (code === null) return { kind: 'unknown', code: null }
  if (WHATSAPP_TEMPLATE_NOT_FOUND === code) return { kind: 'template_not_found', code }
  if (WHATSAPP_TEMPLATE_ERROR_CODES.has(code)) return { kind: 'requires_template', code }
  if (WHATSAPP_RATE_LIMIT_CODES.has(code)) return { kind: 'rate_limited', code }
  return { kind: 'api', code }
}

// Payload Graph pour un message template (proactif, hors fenêtre 24 h)
export function buildTemplateMessagePayload({ to, templateName, languageCode = 'fr', components = [] }) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeWhatsAppPhone(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  }
  if (Array.isArray(components) && components.length) payload.template.components = components
  return payload
}

// Composant body : variables positionnelles du template ({1}, {2}, …)
export function buildTemplateBodyComponents(params = []) {
  const values = Array.isArray(params) ? params : [params]
  return [{
    type: 'body',
    parameters: values.map((value) => ({ type: 'text', text: String(value ?? '') })),
  }]
}

// Payload Graph pour un message texte libre (fenêtre de conversation 24 h)
export function buildTextMessagePayload({ to, body }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeWhatsAppPhone(to),
    type: 'text',
    text: { preview_url: false, body: String(body || '') },
  }
}

export async function sendWhatsAppTemplateMessage({
  to,
  templateName,
  languageCode,
  components,
  config = {},
  fetchImpl = fetch,
}) {
  const phoneNumberId = config.phoneNumberId
  const accessToken = config.accessToken
  if (!phoneNumberId || !accessToken) {
    return { sent: false, skipped: true, reason: 'WhatsApp Cloud API non configurée.' }
  }
  const payload = buildTemplateMessagePayload({ to, templateName, languageCode, components })
  const apiVersion = config.apiVersion || 'v20.0'
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const parsed = await response.json().catch(() => ({}))
    if (!response.ok) {
      const classified = classifyWhatsAppError(parsed)
      return {
        sent: false,
        skipped: false,
        reason: parsed?.error?.message || `WhatsApp API HTTP ${response.status}`,
        code: classified.code,
        errorKind: classified.kind,
        details: parsed,
        templateName,
      }
    }
    return { sent: true, messageId: parsed?.messages?.[0]?.id || '', templateName, details: parsed }
  } catch (error) {
    return { sent: false, skipped: false, reason: error?.message || 'Erreur WhatsApp API.', templateName }
  }
}

export async function sendWhatsAppFreeFormText({ to, body, config = {}, fetchImpl = fetch }) {
  const phoneNumberId = config.phoneNumberId
  const accessToken = config.accessToken
  if (!phoneNumberId || !accessToken) {
    return { sent: false, skipped: true, reason: 'WhatsApp Cloud API non configurée.' }
  }
  const payload = buildTextMessagePayload({ to, body })
  const apiVersion = config.apiVersion || 'v20.0'
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const parsed = await response.json().catch(() => ({}))
    if (!response.ok) {
      const classified = classifyWhatsAppError(parsed)
      return {
        sent: false,
        skipped: false,
        reason: parsed?.error?.message || `WhatsApp API HTTP ${response.status}`,
        code: classified.code,
        errorKind: classified.kind,
        details: parsed,
      }
    }
    return { sent: true, messageId: parsed?.messages?.[0]?.id || '', details: parsed }
  } catch (error) {
    return { sent: false, skipped: false, reason: error?.message || 'Erreur WhatsApp API.' }
  }
}

// Parsing du webhook Meta : messages reçus + statuts d'envoi
export function parseWhatsAppWebhook(payload = {}) {
  const entry = payload?.entry?.[0]
  const changes = entry?.changes?.[0]
  const value = changes?.value || {}
  const messages = []
  const statuses = []
  for (const raw of value?.messages || []) {
    messages.push({
      from: normalizeWhatsAppPhone(raw?.from),
      messageId: raw?.id || '',
      timestamp: raw?.timestamp ? new Date(Number(raw.timestamp) * 1000).toISOString() : '',
      type: raw?.type || '',
      text: raw?.text?.body || '',
      buttonReply: raw?.interactive?.button_reply?.id || '',
      listReply: raw?.interactive?.list_reply?.id || '',
    })
  }
  for (const raw of value?.statuses || []) {
    statuses.push({
      messageId: raw?.id || '',
      status: raw?.status || '',
      timestamp: raw?.timestamp ? new Date(Number(raw.timestamp) * 1000).toISOString() : '',
      errorCode: raw?.errors?.[0]?.code || null,
      errorTitle: raw?.errors?.[0]?.title || '',
    })
  }
  return { phoneNumberId: String(value?.metadata?.phone_number_id || ''), messages, statuses }
}

export function isWebhookChallengeValid(query = {}, expectedToken = '') {
  if (!expectedToken) return false
  const mode = String(query['hub.mode'] || '')
  const token = String(query['hub.verify_token'] || '')
  const challenge = String(query['hub.challenge'] || '')
  if (mode !== 'subscribe' || !token || !challenge) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expectedToken)
  if (a.length !== b.length) return false
  return a.equals(b)
}
