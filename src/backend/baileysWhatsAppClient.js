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
  typingSimulation = true,
  typingDelayMs = { min: 400, max: 1200 },
  reachoutCooldownHours = 24,
} = {}) {
  let socket = null
  let started = false
  let state = 'idle'
  let lastQr = ''
  let lastQrDataUrl = ''
  let lastError = ''
  let connectedAt = null
  let user = null
  let reconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 10
  const RECONNECT_BASE_DELAY_MS = 5_000
  // Cooldown 463 par destinataire : après une erreur Reachout Timelock, on ne
  // re-tente PAS ce contact pendant N heures (marteler un contact sans historique
  // est le chemin le plus rapide vers un ban).
  const reachoutCooldowns = new Map()

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

    pruneReachoutCooldowns()

    // Cooldown 463 : contact récemment en erreur Reachout Timelock → ne pas re-tenter
    // (même résultat que l'erreur réelle, la file ne le retente jamais).
    const cooldownExpiry = reachoutCooldowns.get(jid)
    if (cooldownExpiry && cooldownExpiry > Date.now()) {
      const hoursLeft = Math.ceil((cooldownExpiry - Date.now()) / 3600_000)
      return {
        sent: false,
        skipped: false,
        errorKind: 'reachout_timelock',
        statusCode: 463,
        reason: `Contact en cooldown 463 (réessai dans ~${hoursLeft}h) — envoi interrompu pour protéger le numéro.`,
      }
    }

    try {
      const recipientJid = await resolveWhatsAppAccountJid(socket, jid)
      if (!recipientJid) return { sent: false, skipped: false, reason: 'Aucun compte WhatsApp trouvé pour ce numéro.' }
      // Simulation de frappe : presence "composing" + délai humain avant l'envoi.
      // Best-effort — si le socket ne la supporte pas, on envoie quand même.
      if (typingSimulation && typeof socket.sendPresenceUpdate === 'function') {
        try {
          await socket.sendPresenceUpdate('composing', recipientJid)
          await sleep(resolveTypingDelay(typingDelayMs))
        } catch { /* presence best-effort */ }
      }
      const result = await socket.sendMessage(recipientJid, { text: message })
      if (typingSimulation && typeof socket.sendPresenceUpdate === 'function') {
        try { await socket.sendPresenceUpdate('paused', recipientJid) } catch { /* best-effort */ }
      }
      return { sent: true, messageId: result?.key?.id || '' }
    } catch (error) {
      lastError = error?.message || 'Erreur envoi Baileys.'
      const statusCode = error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode ?? error?.data?.error
      const isReachoutTimelock = statusCode === 463 || /(^|[^0-9])463([^0-9]|$)|reachout|timelock/i.test(lastError)
      // Erreur 463 (Reachout Timelock) : contact sans historique récent. Ne JAMAIS réessayer
      // (le retry aggrave le risque) → marqué errorKind pour que la file ne le retente pas.
      if (isReachoutTimelock) {
        reachoutCooldowns.set(jid, Date.now() + Math.max(1, Number(reachoutCooldownHours) || 24) * 3600_000)
        logger.warn?.(`[baileys] Erreur 463 (Reachout Timelock) pour ${jid} — envoi interrompu, contact en cooldown ~${reachoutCooldownHours}h.`)
        return {
          sent: false,
          skipped: false,
          errorKind: 'reachout_timelock',
          statusCode: 463,
          reason: 'Contact sans historique récent (erreur 463 Reachout Timelock). Envoi interrompu pour protéger le numéro.',
        }
      }
      return { sent: false, skipped: false, reason: lastError }
    }
  }

  function pruneReachoutCooldowns() {
    const now = Date.now()
    for (const [entryJid, expiry] of reachoutCooldowns) {
      if (expiry <= now) reachoutCooldowns.delete(entryJid)
    }
  }

  function getStatus() {
    pruneReachoutCooldowns()
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
      reachoutCooldownCount: reachoutCooldowns.size,
      typingSimulation: Boolean(typingSimulation),
      reachoutCooldownHours: Math.max(1, Number(reachoutCooldownHours) || 24),
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
      reconnectAttempts = 0
      logger.info?.('[baileys] WhatsApp connecté.')
    }

    if (update.connection === 'connecting' && !lastQr) {
      state = 'connecting'
    }

    if (update.connection === 'close') {
      state = 'disconnected'
      connectedAt = null
      lastError = update.lastDisconnect?.error?.message || ''
      const disconnectError = update.lastDisconnect?.error
      const statusCode = disconnectError?.output?.statusCode ?? disconnectError?.statusCode ?? disconnectError?.data?.statusCode
      const isLoggedOut = statusCode === 403 || /logged.?out|session.*terminated/i.test(String(disconnectError?.message || ''))
      // Session révoquée (403) : se reconnecter en boucle est inutile et suspect → arrêt, re-scan QR requis.
      if (isLoggedOut) {
        state = 'loggedOut'
        lastError = 'Session WhatsApp révoquée ou expirée (403). Re-scannez le QR code pour reconnecter.'
        started = false
        socket = null
        reconnectAttempts = 0
        logger.warn?.(`[baileys] Session WhatsApp révoquée (403) — reconnexion automatique arrêtée. Re-scan QR requis.`)
        return
      }
      reconnectAttempts += 1
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        logger.error?.(`[baileys] WhatsApp: ${MAX_RECONNECT_ATTEMPTS} tentatives échouées. Abandon de la reconnexion automatique. Redémarrez le serveur ou scannez le QR manuellement.`)
        state = 'error'
        started = false
        socket = null
        return
      }
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1), 5 * 60_000)
      logger.warn?.(`[baileys] WhatsApp déconnecté${lastError ? `: ${lastError}` : ''} — tentative ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dans ${Math.round(delay / 1000)}s`)
      started = false
      socket = null
      setTimeout(() => start().catch((error) => logger.error?.(`[baileys] reconnexion impossible: ${error?.message || error}`)), delay)
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
    // IMPORTANT : surcharger `version` avec fetchLatestBaileysVersion() est OBLIGATOIRE.
    // La version embarquée du package 7.0.0-rc13 ([2,3000,1035194821]) est obsolète :
    // WhatsApp rejette le handshake → « Connection Failure » sans QR, même en appairage.
    // La version récupérée ([2,3000,1043857760]) est acceptée. (Vérifié empiriquement.)
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
    level: 'warn',
    child: () => logger,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (...args) => console.warn('[baileys]', ...args),
    error: (...args) => console.error('[baileys]', ...args),
    fatal: (...args) => console.error('[baileys]', ...args),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

// Délai "humain" de frappe : jitter entre min et max (défaut 400-1200 ms).
function resolveTypingDelay(delay) {
  const min = Number(delay?.min) || 400
  const max = Number(delay?.max) || min
  return min + Math.random() * Math.max(0, max - min)
}
