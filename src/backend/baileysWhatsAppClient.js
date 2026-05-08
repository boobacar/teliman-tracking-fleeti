import fs from 'fs/promises'
import { normalizeWhatsAppPhone } from './whatsappNotifications.js'

const DEFAULT_AUTH_DIR = 'whatsapp-auth'
const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net'

export function toBaileysJid(phone) {
  const recipient = normalizeWhatsAppPhone(phone)
  return recipient ? `${recipient}${WHATSAPP_JID_SUFFIX}` : ''
}

export function createBaileysWhatsAppClient({
  authDir = DEFAULT_AUTH_DIR,
  socketFactory,
  authStateFactory,
  qrCodeFactory,
  sessionCleaner,
  logger = console,
} = {}) {
  let socket = null
  let started = false
  let state = 'idle'
  let lastQr = ''
  let lastQrDataUrl = ''
  let lastError = ''
  let connectedAt = null
  let user = null

  async function start() {
    if (started) return getStatus()
    started = true
    state = 'starting'
    lastError = ''

    try {
      const { state: authState, saveCreds } = await resolveAuthStateFactory(authStateFactory)(authDir)
      socket = await resolveSocketFactory(socketFactory)({ auth: authState })
      socket.ev.on('creds.update', saveCreds)
      socket.ev.on('connection.update', handleConnectionUpdate)
      state = 'connecting'
      return getStatus()
    } catch (error) {
      state = 'error'
      lastError = error?.message || 'Impossible de démarrer Baileys.'
      logger.error?.(`[baileys] ${lastError}`)
      return getStatus()
    }
  }

  async function sendText(to, message) {
    const jid = toBaileysJid(to)
    if (!jid) return { sent: false, skipped: true, reason: 'Destinataire WhatsApp manquant.' }
    if (!message) return { sent: false, skipped: true, reason: 'Message WhatsApp vide.' }
    if (!socket || state !== 'connected') {
      return { sent: false, skipped: true, reason: 'Baileys non connecté. Scanner le QR code WhatsApp.' }
    }

    try {
      const recipientJid = await resolveWhatsAppAccountJid(socket, jid)
      if (!recipientJid) return { sent: false, skipped: false, reason: 'Aucun compte WhatsApp trouvé pour ce numéro.' }
      const result = await socket.sendMessage(recipientJid, { text: message })
      return { sent: true, messageId: result?.key?.id || '' }
    } catch (error) {
      lastError = error?.message || 'Erreur envoi Baileys.'
      return { sent: false, skipped: false, reason: lastError }
    }
  }

  function getStatus() {
    return {
      provider: 'baileys',
      state,
      connected: state === 'connected',
      hasQr: Boolean(lastQr),
      lastError,
      connectedAt,
      authDir,
      user,
      connectedPhone: user?.phone || '',
      connectedName: user?.name || '',
    }
  }

  function getQr() {
    return {
      provider: 'baileys',
      state,
      qr: lastQr,
      qrDataUrl: lastQrDataUrl,
      hasQr: Boolean(lastQr),
    }
  }

  async function handleConnectionUpdate(update = {}) {
    if (update.qr) {
      lastQr = update.qr
      lastQrDataUrl = await resolveQrCodeFactory(qrCodeFactory)(update.qr)
      state = 'qr'
      logger.info?.('[baileys] QR code WhatsApp généré. Ouvrir /api/whatsapp/qr pour le scanner.')
    }

    if (update.connection === 'open') {
      state = 'connected'
      lastQr = ''
      lastQrDataUrl = ''
      lastError = ''
      connectedAt = new Date().toISOString()
      user = normalizeBaileysUser(socket?.user)
      logger.info?.('[baileys] WhatsApp connecté.')
    }

    if (update.connection === 'connecting' && !lastQr) {
      state = 'connecting'
    }

    if (update.connection === 'close') {
      state = 'disconnected'
      connectedAt = null
      lastError = update.lastDisconnect?.error?.message || ''
      logger.warn?.(`[baileys] WhatsApp déconnecté${lastError ? `: ${lastError}` : ''}`)
      started = false
      socket = null
      setTimeout(() => start().catch((error) => logger.error?.(`[baileys] reconnexion impossible: ${error?.message || error}`)), 5000)
    }
  }

  async function disconnect({ clearSession = false } = {}) {
    const currentSocket = socket
    started = false
    socket = null
    state = 'disconnected'
    lastQr = ''
    lastQrDataUrl = ''
    connectedAt = null
    user = null

    try {
      if (currentSocket?.logout) await currentSocket.logout()
      else currentSocket?.end?.()
      if (clearSession) await resolveSessionCleaner(sessionCleaner)(authDir)
      return { ok: true, state }
    } catch (error) {
      lastError = error?.message || 'Erreur déconnexion Baileys.'
      return { ok: false, error: lastError, state }
    }
  }

  async function reconnect({ clearSession = false } = {}) {
    await disconnect({ clearSession })
    return start()
  }

  return { start, reconnect, disconnect, sendText, getStatus, getQr }
}

async function resolveWhatsAppAccountJid(socket, jid) {
  if (!socket?.onWhatsApp) return jid
  const accounts = await socket.onWhatsApp(jid)
  const account = Array.isArray(accounts)
    ? accounts.find((entry) => entry?.exists !== false && entry?.jid)
    : null
  return account?.jid || ''
}

function normalizeBaileysUser(rawUser = null) {
  if (!rawUser) return null
  const rawId = String(rawUser.id || rawUser.jid || '').split('@')[0].split(':')[0]
  const digits = normalizeWhatsAppPhone(rawId)
  return {
    id: rawUser.id || rawUser.jid || '',
    name: rawUser.name || rawUser.notify || rawUser.verifiedName || '',
    phone: formatInternationalPhone(digits),
    phoneRaw: digits,
  }
}

function formatInternationalPhone(digits) {
  const value = String(digits || '')
  if (!value) return ''
  if (value.startsWith('225') && value.length === 13) return `+225 ${value.slice(3, 5)} ${value.slice(5, 7)} ${value.slice(7, 9)} ${value.slice(9, 11)} ${value.slice(11)}`
  if (value.startsWith('221') && value.length === 12) return `+221 ${value.slice(3, 5)} ${value.slice(5, 8)} ${value.slice(8, 10)} ${value.slice(10)}`
  return `+${value}`
}

function resolveSessionCleaner(sessionCleaner) {
  if (sessionCleaner) return sessionCleaner
  return async (authDir) => {
    if (!authDir) return
    await fs.rm(authDir, { recursive: true, force: true })
  }
}

function resolveAuthStateFactory(authStateFactory) {
  if (authStateFactory) return authStateFactory
  return async (authDir) => {
    const { useMultiFileAuthState } = await import('@whiskeysockets/baileys')
    return useMultiFileAuthState(authDir)
  }
}

function resolveSocketFactory(socketFactory) {
  if (socketFactory) return socketFactory
  return async ({ auth }) => {
    const baileys = await import('@whiskeysockets/baileys')
    const makeWASocket = baileys.default || baileys.makeWASocket
    const { version } = baileys.fetchLatestBaileysVersion
      ? await baileys.fetchLatestBaileysVersion()
      : { version: undefined }
    return makeWASocket({
      auth,
      version,
      logger: createSilentBaileysLogger(),
      printQRInTerminal: false,
      browser: ['Teliman Logistique', 'Chrome', '1.0.0'],
    })
  }
}

function createSilentBaileysLogger() {
  const logger = {
    level: 'silent',
    child: () => logger,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  }
  return logger
}

function resolveQrCodeFactory(qrCodeFactory) {
  if (qrCodeFactory) return qrCodeFactory
  return async (qr) => {
    const qrcode = await import('qrcode')
    return qrcode.toDataURL(qr, { margin: 1, scale: 8 })
  }
}
