import fs from 'fs/promises'
import { normalizeWhatsAppPhone } from './whatsappNotifications.js'
import { restoreAuthDir, snapshotAuthDir } from './whatsappAuthStore.js'

const DEFAULT_AUTH_DIR = 'whatsapp-auth'
const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net'
// Légende maximale d'un média WhatsApp. Au-delà, on envoie le texte seul :
// WhatsApp tronquerait la légende (pire qu'une alerte sans logo).
const MAX_CAPTION_LENGTH = 1024

export function resolveReconnectDelay({
  attempts,
  maxAttempts,
  baseMs = 5_000,
  maxMs = 5 * 60_000,
}) {
  if (attempts <= maxAttempts) {
    return Math.min(baseMs * Math.pow(2, Math.max(0, attempts - 1)), maxMs)
  }
  // NE JAMAIS donner « up » : au-delà du burst exponentiel, on garde un retry lent
  // permanent (maxMs, ex. 5 min) pour que le client récupère seul après une
  // coupure transitoire. Renvoie toujours un délai fini (>0) pour tout attempt.
  return maxMs
}

export function toBaileysJid(phone) {
  const recipient = normalizeWhatsAppPhone(phone)
  return recipient ? `${recipient}${WHATSAPP_JID_SUFFIX}` : ''
}

// Faut-il écarter les creds WhatsApp pour servir un QR neuf ?
// Doctrine (11/09/2026, après audit Baileys + incidents) : un 401 ISOLÉ ne doit
// JAMAIS détruire la session. Le protocole renvoie des 401 transitoires
// (« Connection Failure », « conflict: device_removed » — bugs documentés des
// versions 7.0.0-rc, issues #2140 / #2248 / #2110) : purger immédiatement
// transformait une coupure passagère en scan QR obligatoire. On re-tente donc
// d'abord avec les MÊMES creds, et seulement après `max401BeforeQr` échecs
// CONSÉCUTIFS (aucune connexion réussie entre-temps) la session est considérée
// morte : les creds sont ARCHIVÉS (snapshot) puis mis de côté pour qu'un QR neuf
// soit servi à l'opérateur.
// - `retry_with_creds` : 401 encore dans la tolérance → on garde les creds.
// - `purge_invalid` : session jugée morte après N échecs consécutifs.
// - `keep` : coupure réseau (« Connection Failure », « WebSocket Error »,
//   « Connection Terminated ») → creds intacts, on retente sans limite.
export function resolveCredsPurgeAction({
  statusCode = null,
  message = '',
  consecutive401 = 0,
  max401BeforeQr = 3,
} = {}) {
  if (statusCode === 401 || /unauthorized/i.test(String(message))) {
    return consecutive401 >= Math.max(1, Number(max401BeforeQr) || 1) ? 'purge_invalid' : 'retry_with_creds'
  }
  return 'keep'
}

export function createBaileysWhatsAppClient({
  authDir = DEFAULT_AUTH_DIR,
  authBackupDir = '',
  authBackupKeep = 10,
  staleCredsPurgeMs = 6 * 60 * 60 * 1000,
  now = () => Date.now(),
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
  // Protection des creds : snapshots horodatés + restauration au démarrage.
  let credsRestoredFrom = ''
  let lastSnapshotName = ''
  let lastSnapshotAt = ''
  // 401 CONSÉCUTIFS sans aucune connexion réussie entre-temps. Ce compteur est la
  // seule chose qui autorise à écarter des creds (voir resolveCredsPurgeAction) :
  // un 401 isolé — fréquent lors des reconnexions — ne doit jamais coûter un scan QR.
  let consecutive401 = 0
  const MAX_401_BEFORE_QR = 3
  // Une purge volontaire dans CE process ne doit pas être annulée par une
  // restauration : sinon boucle purge → restore → 401 → purge.
  let purgedInProcess = false

  // Verrou d'instance : une SEULE connexion WhatsApp par jeu de creds. Deux
  // process avec la même session (Pi + VPS, ou un ancien process resté vivant)
  // provoquent des conflits côté WhatsApp (« connectionReplaced », « conflict:
  // device_removed ») pouvant aller jusqu'à la déliaison de l'appareil — donc un
  // scan QR. Si un autre process vivant détient le verrou, on ne se connecte pas.
  async function acquireInstanceLock() {
    const lockPath = `${authDir}.lock`
    try {
      const raw = await fs.readFile(lockPath, 'utf8')
      const lock = JSON.parse(raw)
      const pid = Number(lock?.pid)
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        let alive = false
        try {
          process.kill(pid, 0)
          alive = true
        } catch (error) {
          // EPERM = le process existe mais appartient à un autre utilisateur :
          // le verrou est bien détenu, on ne se connecte pas.
          alive = error?.code === 'EPERM'
        }
        if (alive) {
          state = 'error'
          lastError = `Session WhatsApp déjà utilisée par le process ${pid} — connexion refusée (protection anti-conflit).`
          logger.error?.(`[baileys] ${lastError}`)
          return false
        }
      }
    } catch {
      // Pas de verrou lisible : on le pose.
    }
    try {
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8')
    } catch (error) {
      logger.warn?.(`[baileys] verrou d'instance non écrit: ${error?.message || error}`)
    }
    return true
  }

  async function start() {
    if (started) return getStatus()
    started = true
    state = 'starting'
    lastError = ''

    try {
      if (!(await acquireInstanceLock())) {
        started = false
        return getStatus()
      }
      await restoreCredentialsIfMissing()
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
      // Réarmer le client : sans ça `started` reste `true` et plus aucun start()
      // ne peut être relancé (verrou permanent après un échec de démarrage).
      started = false
      socket = null
      reconnectAttempts += 1
      const delay = resolveReconnectDelay({ attempts: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS, baseMs: RECONNECT_BASE_DELAY_MS, maxMs: 5 * 60_000 })
      setTimeout(() => start().catch((err) => logger.error?.(`[baileys] relance impossible: ${err?.message || err}`)), delay)
      return getStatus()
    }
  }

  // `imagePath` (optionnel) : image jointe (logo Teliman) avec le message en
  // légende. Sans image — ou si l'image est illisible — l'envoi reste en texte
  // seul : une alerte ne doit JAMAIS être perdue à cause du logo.
  async function sendText(to, message, { imagePath = '' } = {}) {
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
      const imagePayload = await resolveOutgoingImagePayload({ imagePath, caption: message, logger })
      let mediaKind = 'text'
      let result = null
      if (imagePayload) {
        try {
          result = await socket.sendMessage(recipientJid, imagePayload)
          mediaKind = 'logo'
        } catch (error) {
          // Le 463 (Reachout Timelock) est un rejet du contact, pas de l'image :
          // inutile de retenter en texte, on laisse le catch global le classer.
          if (extractErrorStatusCode(error) === 463) throw error
          logger.warn?.(`[baileys] envoi avec logo impossible (${error?.message || error}) — repli en texte seul.`)
        }
      }
      if (!result) result = await socket.sendMessage(recipientJid, { text: message })
      if (typingSimulation && typeof socket.sendPresenceUpdate === 'function') {
        try { await socket.sendPresenceUpdate('paused', recipientJid) } catch { /* best-effort */ }
      }
      return { sent: true, messageId: result?.key?.id || '', media: mediaKind }
    } catch (error) {
      lastError = error?.message || 'Erreur envoi Baileys.'
      const statusCode = extractErrorStatusCode(error)
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

  // Restaure les creds depuis le dernier snapshot quand le dossier auth n'en a
  // plus (purge, suppression accidentelle, carte SD restaurée) → pas de scan QR.
  // Ne touche JAMAIS à des creds présents et ne défait pas une purge volontaire
  // du même process (sinon boucle purge → restauration → 401 → purge).
  async function restoreCredentialsIfMissing() {
    if (!authBackupDir || purgedInProcess) return
    try {
      const result = await restoreAuthDir({ authDir, backupRoot: authBackupDir })
      if (result.restored) {
        credsRestoredFrom = result.name
        logger.info?.(`[baileys] creds WhatsApp restaurés depuis le snapshot ${result.name} — aucun scan QR nécessaire.`)
      }
    } catch (error) {
      logger.warn?.(`[baileys] restauration des creds WhatsApp impossible: ${error?.message || error}`)
    }
  }

  async function saveAuthSnapshot(reason) {
    if (!authBackupDir) return null
    try {
      const snapshot = await snapshotAuthDir({ authDir, backupRoot: authBackupDir, keep: authBackupKeep })
      if (!snapshot) return null
      lastSnapshotName = snapshot.name
      lastSnapshotAt = new Date().toISOString()
      logger.info?.(`[baileys] snapshot des creds WhatsApp enregistré (${reason}) : ${snapshot.name}`)
      return snapshot
    } catch (error) {
      logger.warn?.(`[baileys] snapshot des creds WhatsApp impossible: ${error?.message || error}`)
      return null
    }
  }

  // Archive systématiquement les creds AVANT toute purge : une erreur de
  // diagnostic (faux 401 sur incident réseau) reste ainsi rattrapable.
  async function purgeCredentials(reason) {
    await saveAuthSnapshot(`avant purge — ${reason}`)
    purgedInProcess = true
    try {
      await resolveSessionCleaner(sessionCleaner)(authDir)
      return { ok: true }
    } catch (error) {
      logger.warn?.(`[baileys] nettoyage de session échoué : ${error?.message || error}`)
      return { ok: false, reason: error?.message || 'nettoyage de session échoué' }
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
      // Protection des creds (snapshots + restauration sans scan QR)
      credsProtection: Boolean(authBackupDir),
      credsBackupDir: authBackupDir || '',
      credsBackupKeep: authBackupKeep,
      lastCredsSnapshot: lastSnapshotName,
      lastCredsSnapshotAt: lastSnapshotAt,
      credsRestoredFrom,
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
      // Connexion réussie : la session est redevenue saine → le compteur de 401
      // repart de zéro (sinon un incident passé finirait par déclencher un QR).
      consecutive401 = 0
      logger.info?.('[baileys] WhatsApp connecté.')
      // Creds à jour et validés par WhatsApp → snapshot de référence : c'est ce
      // snapshot qui permettra de reconnecter sans scan QR en cas de perte locale.
      await saveAuthSnapshot('connexion réussie')
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
      if (isLoggedOut) {
        state = 'loggedOut'
        lastError = 'Session WhatsApp révoquée ou expirée (403). Re-scannez le QR code pour reconnecter.'
        lastQr = ''
        lastQrDataUrl = ''
        started = false
        socket = null
        reconnectAttempts = 0
        logger.warn?.(`[baileys] Session WhatsApp révoquée (403) — reconnexion automatique arrêtée. Re-scan QR requis.`)
        return
      }
      // Session rejetée (401). On ne purge PAS au premier refus : les 401
      // transitoires (bugs 7.0.0-rc, « device_removed » fantôme) sont courants et
      // une purge immédiate transformait une coupure en scan QR obligatoire. On
      // re-tente avec les MÊMES creds, et seulement après MAX_401_BEFORE_QR échecs
      // consécutifs on écarte la session (archivée au préalable) pour servir un QR.
      consecutive401 += 1
      const credsAction = resolveCredsPurgeAction({
        statusCode,
        message: disconnectError?.message || '',
        consecutive401,
        max401BeforeQr: MAX_401_BEFORE_QR,
      })
      if (credsAction === 'retry_with_creds') {
        lastQr = ''
        lastQrDataUrl = ''
        lastError = `Session WhatsApp refusée (401) — tentative ${consecutive401}/${MAX_401_BEFORE_QR} avec les creds existants.`
        state = 'disconnected'
        logger.warn?.(`[baileys] 401 WhatsApp (${disconnectedReasonLabel(disconnectError)}) — tentative ${consecutive401}/${MAX_401_BEFORE_QR}, creds CONSERVÉS.`)
        const delay = resolveReconnectDelay({ attempts: consecutive401, maxAttempts: MAX_401_BEFORE_QR, baseMs: 10_000, maxMs: 5 * 60_000 })
        setTimeout(() => start().catch((error) => logger.error?.(`[baileys] reconnexion impossible: ${error?.message || error}`)), delay)
        return
      }
      if (credsAction === 'purge_invalid') {
        lastQr = ''
        lastQrDataUrl = ''
        lastError = `Session WhatsApp invalide (401 ×${MAX_401_BEFORE_QR}) — les creds sont archivés, scannez le nouveau QR.`
        consecutive401 = 0
        reconnectAttempts = 0
        started = false
        socket = null
        logger.warn?.(`[baileys] Session invalide après ${MAX_401_BEFORE_QR} refus consécutifs — creds archivés, nouveau QR généré.`)
        await purgeCredentials(`session invalide (401 ×${MAX_401_BEFORE_QR})`)
        setTimeout(() => start().catch((error) => logger.error?.(`[baileys] reconnexion impossible: ${error?.message || error}`)), 1500)
        return
      }
      // Refs QR épuisées : les QRs Baileys vivent ~20-60 s puis la socket se ferme
      // (« QR refs attempts ended »). Relance rapide pour servir un QR toujours
      // frais, sans consommer le quota de tentatives (aucun échec réel).
      if (/QR refs attempts ended/i.test(String(disconnectError?.message || ''))) {
        lastQr = ''
        lastQrDataUrl = ''
        started = false
        socket = null
        setTimeout(() => start().catch((error) => logger.error?.(`[baileys] reconnexion impossible: ${error?.message || error}`)), 3000)
        return
      }
      reconnectAttempts += 1
      started = false
      socket = null
      // Les creds ne sont JAMAIS détruits sur une déconnexion réseau (« Connection
      // Failure », « WebSocket Error », « Connection Terminated ») ni après un délai
      // sans connexion : c'était la cause n°1 des scans QR inutiles. Une session
      // réellement morte finit de toute façon par des 401 consécutifs, traités
      // ci-dessus — avec tolérance.
      // NE JAMAIS abandonner définitivement. WhatsApp ferme la socket des sessions
      // longues après ~1-2 jours (recyclage, coupure réseau, téléphone brièvement
      // hors-ligne) et la reconnexion peut échouer plusieurs fois de suite. Si on
      // s'arrête là, l'état reste 'error' pour toujours → le « WebSocket Error () »
      // récurrent, plus aucune alerte sans redémarrage manuel. On bascule donc sur
      // un retry lent PERMANENT (toutes les 5 min) pour que le client récupère seul.
      const exceeded = reconnectAttempts > MAX_RECONNECT_ATTEMPTS
      const delay = resolveReconnectDelay({ attempts: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS, baseMs: RECONNECT_BASE_DELAY_MS, maxMs: 5 * 60_000 })
      if (exceeded) {
        lastQr = ''
        lastQrDataUrl = ''
        logger.warn?.(`[baileys] WhatsApp: ${MAX_RECONNECT_ATTEMPTS} tentatives rapides échouées${lastError ? ` (${lastError})` : ''} — retry lent permanent (${Math.round(delay / 60_000)} min).`)
        state = 'error'
      } else {
        logger.warn?.(`[baileys] WhatsApp déconnecté${lastError ? `: ${lastError}` : ''} — tentative ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dans ${Math.round(delay / 1000)}s`)
        state = 'disconnected'
      }
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

    // Détacher le device côté WhatsApp en best-effort. Si la socket est déjà morte
    // (coupure réseau, restart, crash) ou que le logout échoue, on NE doit PAS
    // abandonner le nettoyage local — sinon des creds périmés survivent et la
    // reconnexion suivante repart sur une session morte (401), ce qui casse le
    // cycle « je veux connecter/déconnecter autant de fois que je veux ».
    let remoteUnlinkOk = true
    try {
      if (currentSocket?.logout) await currentSocket.logout()
      else currentSocket?.end?.()
    } catch (error) {
      remoteUnlinkOk = false
      logger.warn?.(`[baileys] Détachement distant échoué (on force quand même le nettoyage local) : ${error?.message || error}`)
    }
    // TOUJOURS purger la session locale si demandé, même si le logout distant a
    // échoué. C'est ce qui garantit un état « déconnecté » propre et re-appairable.
    // Les creds sont archivés au passage (annulation possible par snapshot).
    if (clearSession) {
      const purgeResult = await purgeCredentials('déconnexion demandée')
      if (!purgeResult.ok) remoteUnlinkOk = false
    }
    if (!remoteUnlinkOk) {
      lastError = 'Session WhatsApp déconnectée, mais le détachement distant a échoué (session locale purgée).'
    }
    return { ok: true, state, remoteUnlinkOk }
  }

  async function reconnect({ clearSession = false } = {}) {
    await disconnect({ clearSession })
    return start()
  }

  return { start, reconnect, disconnect, sendText, getStatus, getQr }
}

// Charge le logo à joindre (image + légende = texte de l'alerte). Renvoie null
// si aucun chemin, si le fichier est illisible ou si la légende dépasserait la
// limite WhatsApp — l'appelant envoie alors le texte seul.
async function resolveOutgoingImagePayload({ imagePath, caption, logger } = {}) {
  const filePath = String(imagePath || '').trim()
  if (!filePath) return null
  if (String(caption || '').length > MAX_CAPTION_LENGTH) {
    logger?.warn?.(`[baileys] message trop long pour une légende image (${String(caption || '').length} > ${MAX_CAPTION_LENGTH}) — envoi en texte seul.`)
    return null
  }
  try {
    const data = await fs.readFile(filePath)
    if (!data?.length) return null
    return { image: data, caption, mimetype: resolveImageMimeType(filePath) }
  } catch (error) {
    logger?.warn?.(`[baileys] logo introuvable (${filePath}) : ${error?.message || error} — envoi en texte seul.`)
    return null
  }
}

function resolveImageMimeType(filePath) {
  const extension = String(filePath || '').toLowerCase().split('.').pop()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function extractErrorStatusCode(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode ?? error?.data?.error
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

// Libellé lisible d'une erreur de déconnexion Baileys : la cause « conflict:
// device_removed » n'apparaît que dans le nœud XML, pas dans `.message` — sans
// ça, impossible de distinguer un vrai déliage d'un 401 transitoire.
function disconnectedReasonLabel(error) {
  const parts = []
  const code = error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode
  if (code) parts.push(String(code))
  const conflict = error?.data?.content?.find?.((node) => node?.tag === 'conflict')
  if (conflict?.attrs?.type) parts.push(String(conflict.attrs.type))
  const streamError = error?.data?.content?.find?.((node) => node?.tag === 'stream:error')
  if (streamError?.attrs?.code) parts.push(String(streamError.attrs.code))
  if (error?.message) parts.push(String(error.message))
  return parts.filter(Boolean).join(' / ') || 'cause inconnue'
}

function resolveSocketFactory(socketFactory) {
  if (socketFactory) return socketFactory
  return async ({ auth }) => {
    const baileys = await import('@whiskeysockets/baileys')
    const makeWASocket = baileys.default || baileys.makeWASocket
    // Version WhatsApp Web : fetchLatestBaileysVersion() renvoie une valeur FIGÉE
    // dans le dépôt Baileys, souvent périmée → WhatsApp ferme le handshake
    // (405/428 « Connection Terminated ») AVANT même le QR. fetchLatestWaWebVersion()
    // interroge web.whatsapp.com/sw.js et reflète ce que le serveur attend
    // réellement (issue #2679 : la version périmée bloque jusqu'à l'appairage).
    let version
    try {
      if (baileys.fetchLatestWaWebVersion) {
        version = (await baileys.fetchLatestWaWebVersion()).version
      } else if (baileys.fetchLatestBaileysVersion) {
        version = (await baileys.fetchLatestBaileysVersion()).version
      }
    } catch (error) {
      console.warn('[baileys] version WA Web indisponible, version embarquée utilisée:', error?.message || error)
      version = undefined
    }
    // Empreinte navigateur : WhatsApp REJETTE désormais le descripteur « Desktop »
    // (WebSubPlatform WIN32/DARWIN) → 428 « Connection Terminated » avant le QR.
    // Un couple Chrome/Ubuntu est accepté (issue #2671, confirmé en production).
    const browser = baileys.Browsers?.ubuntu
      ? baileys.Browsers.ubuntu('Chrome')
      : ['Ubuntu', 'Chrome', '22.04.4']
    // Cache mémoire des clés Signal : moins d'I/O disque (carte SD), sessions
    // moins fragiles après une reconnexion.
    const keys = baileys.makeCacheableSignalKeyStore
      ? baileys.makeCacheableSignalKeyStore(auth.keys, createSilentBaileysLogger())
      : auth.keys
    return makeWASocket({
      auth: { creds: auth.creds, keys },
      version,
      browser,
      logger: createSilentBaileysLogger(),
      printQRInTerminal: false,
      // Stabilité de session : ping régulier + timeouts larges, et on ne se déclare
      // PAS « en ligne » (le téléphone garde ses notifications).
      keepAliveIntervalMs: 30_000,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      retryRequestDelayMs: 250,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: true,
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
