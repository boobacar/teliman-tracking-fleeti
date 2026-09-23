import fs from 'fs/promises'
import { normalizeWhatsAppPhone } from './whatsappNotifications.js'
import { restoreAuthDir, snapshotAuthDir } from './whatsappAuthStore.js'

const DEFAULT_AUTH_DIR = 'whatsapp-auth'
const WHATSAPP_JID_SUFFIX = '@s.whatsapp.net'
// Légende maximale d'un média WhatsApp. Au-delà, on envoie le texte seul :
// WhatsApp tronquerait la légende (pire qu'une alerte sans logo).
const MAX_CAPTION_LENGTH = 1024
// Largeur de l'aperçu joint aux images (valeur utilisée par Baileys) : sans lui,
// WhatsApp affiche une vignette zoomée/recadrée au lieu de l'image entière.
const THUMBNAIL_WIDTH = 32

// Mémoire des messages SORTANTS : quand un destinataire n'arrive pas à déchiffrer
// un message, WhatsApp demande au client émetteur de le RENVOYER (« retry
// receipt »). Baileys appelle alors `getMessage(key)` — dont l'implémentation par
// défaut renvoie TOUJOURS undefined (lib/Defaults/index.js). Sans contenu à
// renvoyer, le renvoi n'a jamais lieu et le destinataire reste bloqué à vie sur
// « En attente de ce message… » (symptôme constaté le 14/09/2026 : alertes
// géofence indéchiffrables sur le téléphone d'un destinataire, sans erreur côté
// serveur). On garde donc les derniers messages envoyés, avec TTL + plafond.
const OUTBOUND_CACHE_TTL_MS = 30 * 60_000
const OUTBOUND_CACHE_MAX = 500

export function createOutboundMessageCache({
  max = OUTBOUND_CACHE_MAX,
  ttlMs = OUTBOUND_CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map()
  const limit = Math.max(1, Number(max) || OUTBOUND_CACHE_MAX)

  function prune() {
    for (const [id, entry] of entries) {
      if (now() - entry.at > ttlMs) entries.delete(id)
    }
    while (entries.size > limit) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    // Un id inconnu ou un contenu vide ne pollue pas la mémoire.
    remember(id, message) {
      if (!id || !message) return
      // Réinsertion : l'ordre d'itération doit rester l'ordre d'ancienneté.
      entries.delete(id)
      entries.set(id, { message, at: now() })
      prune()
    },
    get(id) {
      const entry = entries.get(id)
      if (!entry) return undefined
      if (now() - entry.at > ttlMs) {
        entries.delete(id)
        return undefined
      }
      return entry.message
    },
    // Sérialisation : la mémoire des sortants doit survivre à un redémarrage,
    // sinon les demandes de renvoi (« En attente de ce message ») arrivent après
    // le restart et ne trouvent plus rien (69 cas constatés le 23/09).
    snapshot() {
      prune()
      return [...entries.entries()].map(([id, entry]) => ({ id, at: entry.at, message: entry.message }))
    },
    load(loaded = []) {
      for (const item of Array.isArray(loaded) ? loaded : []) {
        if (!item?.id || !item?.message) continue
        if (now() - Number(item.at || 0) > ttlMs) continue
        entries.set(String(item.id), { message: item.message, at: Number(item.at) || now() })
      }
      prune()
      return entries.size
    },
    size: () => entries.size,
  }
}

// Baileys EFFACE une prekey dès sa première utilisation
// (`removePreKey: (id) => keys.set({ 'pre-key': { [id]: null } })`, cf.
// node_modules/@whiskeysockets/baileys/lib/Signal/libsignal.js). Or WhatsApp
// renvoie souvent le MÊME message (réseau mobile instable, changement d'appareil) :
// la 2e tentative arrive avec une prekey déjà supprimée → `PreKeyError: Invalid
// PreKey ID` (176 occurrences en prod le 13/09/2026, uniquement pour les contacts
// qui ÉCRIVENT au numéro d'alerte) et aucune session ne se noue dans les deux
// sens. C'est le correctif n°3 de la PR Baileys #2372 (« delayed pre-key
// deletion », 5 min de grâce), absent de la 6.7.23 : on l'applique au niveau du
// store de clés — le seul endroit dont l'application est propriétaire.
export function withDelayedPreKeyDeletion(keys, {
  graceMs = 5 * 60_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!keys || typeof keys.set !== 'function') return keys
  const pending = new Map()

  function cancelPending(id) {
    const timer = pending.get(id)
    if (timer === undefined) return
    clearTimer(timer)
    pending.delete(id)
  }

  function scheduleDeletion(id) {
    cancelPending(id)
    const timer = setTimer(() => {
      pending.delete(id)
      // Suppression réelle, différée. Un échec ne doit jamais casser le socket.
      Promise.resolve(keys.set({ 'pre-key': { [id]: null } })).catch(() => {})
    }, graceMs)
    // Ne pas maintenir le process en vie à cause d'un timer de nettoyage.
    timer?.unref?.()
    pending.set(id, timer)
  }

  return {
    get: (...args) => keys.get(...args),
    clear: async (...args) => {
      // Un clear (logout, purge de session) annule les suppressions en attente :
      // sinon un timer ressusciterait une écriture après le nettoyage.
      for (const id of [...pending.keys()]) cancelPending(id)
      return keys.clear?.(...args)
    },
    async set(data) {
      if (!data || typeof data !== 'object') return undefined
      const preKeyChanges = data['pre-key']
      if (!preKeyChanges || typeof preKeyChanges !== 'object') return keys.set(data)

      const passThrough = { ...data }
      delete passThrough['pre-key']
      const upserts = {}
      const removals = []
      for (const [id, value] of Object.entries(preKeyChanges)) {
        if (value === null || value === undefined) removals.push(id)
        else upserts[id] = value
      }
      // Une prekey (ré)écrite annule une suppression en attente pour le même id.
      for (const id of Object.keys(upserts)) cancelPending(id)

      let result
      if (Object.keys(upserts).length) result = await keys.set({ ...passThrough, 'pre-key': upserts })
      else if (Object.keys(passThrough).length) result = await keys.set(passThrough)
      for (const id of removals) scheduleDeletion(id)
      return result
    },
    pendingPreKeyDeletions: () => pending.size,
  }
}

// Le verrou d'instance (`<authDir>.lock`) empêche deux process d'utiliser les mêmes
// creds WhatsApp. Quand il fonctionne, il protège la session ; quand il se trompe,
// il la tue : le 23/09/2026 le verrou contenait le PID 1758 (process d'AVANT le
// redémarrage de 05:29) — ce PID appartenait entre-temps à un autre programme, donc
// le test `process.kill(pid, 0)` répondait « vivant » et la passerelle refusait de se
// connecter… définitivement (aucune relance programmée), alertes muettes pendant des
// heures. On décide donc explicitement si un verrou est utilisable ou périmé.
export function evaluateInstanceLock({
  lock = null,
  ownPid = 0,
  nowMs = Date.now(),
  bootTimeMs = 0,
  pidAlive = () => false,
  pidCmdLine = () => '',
  ownCommandLine = '',
} = {}) {
  const pid = Number(lock?.pid)
  if (!Number.isInteger(pid) || pid <= 0) return { usable: true, reason: 'verrou absent ou invalide' }
  if (pid === ownPid) return { usable: true, reason: 'notre propre verrou' }

  // Verrou écrit avant le démarrage courant : le process qui l'a posé n'existe plus
  // (les PID ne survivent pas à un redémarrage) → périmé, quel que soit le PID.
  const writtenAt = Date.parse(lock?.at || '')
  if (Number.isFinite(writtenAt) && bootTimeMs > 0 && writtenAt < bootTimeMs) {
    return { usable: true, reason: 'verrou antérieur au démarrage courant (PID recyclé)' }
  }
  if (!pidAlive(pid)) return { usable: true, reason: 'process détenteur disparu' }

  // Le PID vit, mais est-ce bien NOUS ? Sinon (PID recyclé par un autre programme),
  // refuser la connexion serait une fausse panne.
  const holderCmd = String(pidCmdLine(pid) || '')
  const ownScript = String(ownCommandLine || '').split(' ').find((part) => part.endsWith('.js')) || ''
  if (ownScript && holderCmd && !holderCmd.includes(ownScript)) {
    return { usable: true, reason: `PID ${pid} recyclé par un autre programme` }
  }
  return { usable: false, reason: `session déjà utilisée par le process ${pid}` }
}

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

  // Mémoire des messages sortants + compteurs de renvois protocolaires : c'est ce
  // qui permet de répondre à WhatsApp quand un destinataire n'arrive pas à
  // déchiffrer (sinon « En attente de ce message… » reste affiché à vie).
  const outboundMessages = createOutboundMessageCache()
  let retryRequestsServed = 0
  let retryRequestsMissed = 0

  // Persistance de cette mémoire (fichier à côté des creds) : un redémarrage ne doit
  // pas rendre les renvois impossibles (« renvoi demandé … message hors mémoire »).
  const outboundPersistPath = `${authDir}-outbound.json`
  let outboundPersistTimer = null

  function persistOutboundSoon() {
    if (outboundPersistTimer) return
    outboundPersistTimer = setTimeout(() => {
      outboundPersistTimer = null
      const payload = JSON.stringify({ savedAt: new Date().toISOString(), entries: outboundMessages.snapshot() })
      fs.writeFile(`${outboundPersistPath}.tmp`, payload, 'utf8')
        .then(() => fs.rename(`${outboundPersistPath}.tmp`, outboundPersistPath))
        .catch(() => { /* la persistance ne doit jamais bloquer un envoi */ })
    }, 1000)
    outboundPersistTimer?.unref?.()
  }

  // Chargement initial : best-effort, jamais bloquant.
  fs.readFile(outboundPersistPath, 'utf8')
    .then((raw) => outboundMessages.load(JSON.parse(raw)?.entries || []))
    .catch(() => { /* pas de fichier : rien à reprendre */ })

  // Appelée par Baileys pour chaque « retry receipt » : on renvoie le message
  // d'origine (Baileys force au passage une session neuve vers le destinataire,
  // cf. sendMessagesAgain → assertSessions). Un compteur qui monte = des
  // destinataires qui ne déchiffraient pas nos messages : à surveiller.
  async function handleRetryRequest(key = {}) {
    const remoteJid = key?.remoteJid || 'inconnu'
    const message = outboundMessages.get(key?.id)
    if (message) {
      retryRequestsServed += 1
      logger.warn?.(`[baileys] renvoi demandé par ${remoteJid} (message non déchiffré) — renvoi avec session neuve.`)
      return message
    }
    retryRequestsMissed += 1
    logger.warn?.(`[baileys] renvoi demandé par ${remoteJid} pour un message hors mémoire (trop ancien) — renvoi impossible.`)
    return undefined
  }

  // Verrou d'instance : une SEULE connexion WhatsApp par jeu de creds. Deux
  // process avec la même session (Pi + VPS, ou un ancien process resté vivant)
  // provoquent des conflits côté WhatsApp (« connectionReplaced », « conflict:
  // device_removed ») pouvant aller jusqu'à la déliaison de l'appareil — donc un
  // scan QR. Si un autre process vivant détient le verrou, on ne se connecte pas.
  // Heure de démarrage de la machine : un verrou écrit AVANT ce moment ne peut plus
  // correspondre à un process vivant (les PID ne survivent pas à un redémarrage).
  async function resolveBootTimeMs() {
    try {
      const uptime = await fs.readFile('/proc/uptime', 'utf8')
      const seconds = Number(String(uptime).trim().split(/\s+/)[0])
      if (Number.isFinite(seconds)) return Date.now() - seconds * 1000
    } catch { /* /proc indisponible (non Linux) : on ne peut pas dater le démarrage */ }
    return 0
  }

  async function readProcessCmdLine(pid) {
    try {
      return await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
    } catch {
      return ''
    }
  }

  async function acquireInstanceLock() {
    const lockPath = `${authDir}.lock`
    let lock = null
    try {
      lock = JSON.parse(await fs.readFile(lockPath, 'utf8'))
    } catch {
      // Pas de verrou lisible : on le pose.
    }

    if (lock) {
      const pid = Number(lock?.pid)
      let alive = false
      try {
        process.kill(pid, 0)
        alive = true
      } catch (error) {
        // EPERM = le process existe mais appartient à un autre utilisateur : le verrou est bien détenu, on ne se connecte pas.
        alive = error?.code === 'EPERM'
      }
      const holderCmdLine = alive ? await readProcessCmdLine(pid) : ''
      const verdict = evaluateInstanceLock({
        lock,
        ownPid: process.pid,
        bootTimeMs: await resolveBootTimeMs(),
        pidAlive: () => alive,
        pidCmdLine: () => holderCmdLine,
        ownCommandLine: process.argv.join(' '),
      })
      if (!verdict.usable) {
        state = 'error'
        lastError = `Session WhatsApp déjà utilisée par le process ${pid} — connexion refusée (protection anti-conflit).`
        logger.error?.(`[baileys] ${lastError}`)
        return false
      }
      logger.warn?.(`[baileys] verrou d'instance ignoré (périmé) : ${verdict.reason}`)
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
        // NE JAMAIS condamner la passerelle : un verrou périmé (PID recyclé) ou un
        // opérateur qui purge le fichier finit par rétablir la situation. Sans cette
        // relance, l'état restait 'error' à vie → alertes muettes (incident 23/09).
        setTimeout(() => start().catch((error) => logger.error?.(`[baileys] relance impossible: ${error?.message || error}`)), 5 * 60_000)
        return getStatus()
      }
      await restoreCredentialsIfMissing()
      const { state: authState, saveCreds } = await resolveAuthStateFactory(authStateFactory)(authDir)
      socket = await resolveSocketFactory(socketFactory)({ auth: authState, getMessage: handleRetryRequest })
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
      // Mémoire des sortants : c'est ce contenu que WhatsApp nous redemandera de
      // renvoyer si le destinataire n'a pas su le déchiffrer.
      outboundMessages.remember(result?.key?.id, result?.message)
      persistOutboundSoon()
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
      // Renvois protocolaires : servis = destinataires qui ne déchiffraient pas,
      // impossibles = messages trop anciens pour être renvoyés (hors mémoire).
      retryRequestsServed,
      retryRequestsMissed,
      outboundMessagesCached: outboundMessages.size(),
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
        // RÉARMER la relance : sans `started = false`, le `start()` programmé
        // ci-dessous sortait immédiatement (`if (started) return getStatus()`) et la
        // passerelle restait bloquée en 'disconnected' — plus aucune tentative, donc
        // JAMAIS les 3 × 401 qui déclenchent le nouveau QR. Constaté en prod le
        // 14/09/2026 : 8 minutes d'alerte muette après deux 401, sans QR à scanner.
        started = false
        socket = null
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

  async function disconnect({ clearSession = false, unlink = true } = {}) {
    const currentSocket = socket
    started = false
    socket = null
    state = 'disconnected'
    lastQr = ''
    lastQrDataUrl = ''
    connectedAt = null
    user = null

    // `unlink: false` = arrêt LOCAL du process (redémarrage, déploiement). Dans ce
    // cas on ferme la socket SANS appeler logout() : `logout()` DÉLIE l'appareil
    // côté WhatsApp (« 401 / Intentional Logout ») et impose un scan QR à chaque
    // redémarrage — chaque ré-appairage rendant caduques les sessions de TOUS les
    // contacts (« En attente de ce message… »). Constaté le 14/09/2026 : un simple
    // pm2 restart a délié la passerelle. Seule l'action explicite « déconnecter »
    // de l'interface doit délier.
    let remoteUnlinkOk = true
    if (!unlink) {
      try {
        currentSocket?.end?.(undefined)
      } catch (error) {
        remoteUnlinkOk = false
        logger.warn?.(`[baileys] Fermeture locale de la socket incomplète : ${error?.message || error}`)
      }
      return { ok: true, state, remoteUnlinkOk }
    }

    // Détacher le device côté WhatsApp en best-effort. Si la socket est déjà morte
    // (coupure réseau, restart, crash) ou que le logout échoue, on NE doit PAS
    // abandonner le nettoyage local — sinon des creds périmés survivent et la
    // reconnexion suivante repart sur une session morte (401), ce qui casse le
    // cycle « je veux connecter/déconnecter autant de fois que je veux ».
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
    // Aperçu + dimensions calculés ICI : Baileys 6.7.23 échoue à le faire seul
    // (« failed to obtain extra info » — extraction sharp sur son fichier
    // temporaire), et une image sans jpegThumbnail/width/height s'affiche
    // recadrée et zoomée dans WhatsApp au lieu de la carte de marque attendue.
    const preview = await buildImagePreview(data, logger)
    if (preview.jpegThumbnail) {
      logger?.info?.(`[baileys] aperçu image calculé (${preview.width || '?'}x${preview.height || '?'}, ${preview.jpegThumbnail.length} o) — l'image s'affichera entière.`)
    }
    return { image: data, caption, mimetype: resolveImageMimeType(filePath), ...preview }
  } catch (error) {
    logger?.warn?.(`[baileys] logo introuvable (${filePath}) : ${error?.message || error} — envoi en texte seul.`)
    return null
  }
}

// Aperçu JPEG (largeur 32 px, qualité 50 — les valeurs de Baileys) + dimensions
// d'origine. Best-effort : si le calcul échoue, on renvoie {} et l'envoi continue
// (une alerte ne doit JAMAIS être perdue à cause de l'image).
export async function buildImagePreview(buffer, logger = console) {
  try {
    const sharpModule = await import('sharp')
    const sharp = sharpModule.default || sharpModule
    const image = sharp(buffer)
    const meta = await image.metadata()
    const jpegThumbnail = await image.resize(THUMBNAIL_WIDTH).jpeg({ quality: 50 }).toBuffer()
    if (!jpegThumbnail?.length) return {}
    const preview = { jpegThumbnail }
    if (meta?.width && meta?.height) {
      preview.width = meta.width
      preview.height = meta.height
    }
    return preview
  } catch (error) {
    logger?.warn?.(`[baileys] aperçu de l'image non calculable (${error?.message || error}) — envoi sans aperçu.`)
    return {}
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
  return async ({ auth, getMessage }) => {
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
    const baseKeys = baileys.makeCacheableSignalKeyStore
      ? baileys.makeCacheableSignalKeyStore(auth.keys, createSilentBaileysLogger())
      : auth.keys
    // Prekeys : suppression différée (5 min) — sinon le moindre renvoi WhatsApp
    // arrive avec une prekey déjà effacée → « Invalid PreKey ID » et sessions
    // jamais nouées avec les contacts qui écrivent au numéro (cf. le commentaire
    // de withDelayedPreKeyDeletion). Enveloppe EXTERNE : le cache interne ne doit
    // jamais voir la suppression.
    const keys = withDelayedPreKeyDeletion(baseKeys)
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
      // Renvoi des messages non déchiffrés par le destinataire (« Waiting for this
      // message » à vie sans ça) : Baileys appelle cette fonction sur « retry
      // receipt ». Défaut Baileys = toujours undefined → aucun renvoi possible.
      getMessage: typeof getMessage === 'function' ? getMessage : async () => undefined,
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
