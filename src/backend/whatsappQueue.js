// File d'attente WhatsApp : throttle (fixe ou jitter), retry avec backoff,
// plafond journalier (fixe ou warm-up progressif), circuit-breaker
// anti-tempête d'erreurs (pause automatique avant ban) et fenêtre horaire
// naturelle (pas d'envoi en rafale la nuit ; les alertes passent quand même).
// La file est persistée sur disque (option) pour survivre à un redémarrage.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_MIN_INTERVAL_MS = 1100
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_DAILY_LIMIT = 250
const DEFAULT_CIRCUIT_BREAKER = { maxConsecutiveFailures: 8, cooldownMs: 10 * 60 * 1000 }
const DAY_MS = 24 * 60 * 60 * 1000
// Une alerte rejouée après un redémarrage n'a de sens que si elle est récente.
const DEFAULT_PERSIST_MAX_AGE_MS = 6 * 60 * 60 * 1000
const DEFAULT_PERSIST_LIMIT = 200

function defaultFsApi() {
  return {
    readFileSync: (path) => readFileSync(path, 'utf8'),
    writeFileSync: (path, data) => {
      mkdirSync(dirname(path), { recursive: true })
      // Écriture atomique : un crash pendant la sauvegarde ne doit pas laisser un
      // fichier tronqué (les alertes en attente deviendraient illisibles).
      const tmp = `${path}.tmp`
      writeFileSync(tmp, data, 'utf8')
      renameSync(tmp, path)
    },
  }
}

export function dayKey(now = Date.now()) {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Plafond journalier progressif : démarre bas (numéro neuf) et monte chaque jour.
// daysActive = nombre de jours écoulés depuis la première utilisation de la file.
export function makeWarmupDailyLimit({ start = 30, rampPerDay = 20, max = 150, dayOffset = 0 } = {}) {
  return (daysActive) => Math.min(max, Math.max(start, start + Math.max(0, daysActive - dayOffset) * rampPerDay))
}

function resolveInterval(intervalMs) {
  if (intervalMs && typeof intervalMs === 'object') {
    const min = Number(intervalMs.min) || DEFAULT_MIN_INTERVAL_MS
    const max = Number(intervalMs.max) || min
    return min + Math.random() * Math.max(0, max - min)
  }
  return Number(intervalMs) || DEFAULT_MIN_INTERVAL_MS
}

function resolveDailyLimit(dailyLimit, daysActive) {
  if (typeof dailyLimit === 'function') return Math.max(1, Math.round(dailyLimit(daysActive)))
  return Math.max(1, Number(dailyLimit) || DEFAULT_DAILY_LIMIT)
}

// Fenêtre horaire d'envoi (heure serveur locale = UTC sur le Pi, soit Africa/Abidjan).
// start <= end : fenêtre normale (ex. 7-21). start > end : fenêtre nocturne enveloppée (ex. 21-7).
export function isWithinSendHours(hour, sendHours) {
  if (!sendHours) return true
  const start = Number(sendHours.start)
  const end = Number(sendHours.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true
  return start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end)
}

// Millisecondes avant la prochaine ouverture de la fenêtre (0 si déjà ouverte).
export function msUntilSendHoursOpen(nowMs, sendHours) {
  if (!sendHours) return 0
  const date = new Date(nowMs)
  const hour = date.getHours()
  if (isWithinSendHours(hour, sendHours)) return 0
  const nowMinutes = hour * 60 + date.getMinutes()
  const startMinutes = Number(sendHours.start) * 60
  let waitMinutes = startMinutes - nowMinutes
  if (waitMinutes <= 0) waitMinutes += 24 * 60
  return waitMinutes * 60_000
}

export function createWhatsAppQueue({
  sendFn,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  dailyLimit = DEFAULT_DAILY_LIMIT,
  circuitBreaker = DEFAULT_CIRCUIT_BREAKER,
  sendHours = null,
  now = () => Date.now(),
  onResult = null,
  // Reprise après redémarrage : la file vivait en mémoire, donc chaque restart
  // JETAIT les alertes en attente (85 perdues le 14/09, 249 fantômes le 23/09).
  // `persistPath` + `serializeJob`/`rehydrateJob` permettent de les rejouer.
  persistPath = '',
  persistMaxAgeMs = DEFAULT_PERSIST_MAX_AGE_MS,
  persistLimit = DEFAULT_PERSIST_LIMIT,
  persistDebounceMs = 500,
  serializeJob = null,
  rehydrateJob = null,
  fsApi = null,
  onPersistError = null,
} = {}) {
  if (typeof sendFn !== 'function') throw new Error('createWhatsAppQueue: sendFn requis')
  const persistenceOn = Boolean(persistPath && typeof serializeJob === 'function' && typeof rehydrateJob === 'function')
  const fs = fsApi || defaultFsApi()
  const persistEntries = new Map()
  let persistTimer = null
  let persistSeq = 0

  const pending = []
  let current = null

  // ── Persistance de reprise ──────────────────────────────────────────────────
  // Chaque job en attente est écrit dans `persistPath` (JSON, écriture atomique) et
  // retiré dès qu'il a été tenté. Au démarrage, les jobs plus jeunes que
  // `persistMaxAgeMs` sont rejoués : une alerte de zone partie pendant un
  // redémarrage n'est plus perdue.
  let resumedCount = 0

  function hasPersist() {
    return persistenceOn
  }

  function readPersisted() {
    if (!hasPersist()) return []
    try {
      const raw = fs.readFileSync(persistPath)
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed?.entries) ? parsed.entries : []
    } catch {
      return [] // fichier absent ou illisible : rien à reprendre
    }
  }

  function writePersisted() {
    if (!hasPersist()) return
    try {
      const entries = [...persistEntries.values()].slice(-persistLimit)
      fs.writeFileSync(persistPath, JSON.stringify({ savedAt: new Date(now()).toISOString(), entries }))
    } catch (error) {
      // Une persistance impossible ne doit jamais casser l'envoi d'alertes.
      if (typeof onPersistError === 'function') onPersistError(error)
    }
  }

  function saveSoon() {
    if (!hasPersist()) return
    if (persistTimer) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      writePersisted()
    }, Math.max(0, Number(persistDebounceMs) || 0))
    persistTimer?.unref?.()
  }

  function rememberJob(job) {
    if (!hasPersist()) return
    persistSeq += 1
    const persistId = `${now()}-${persistSeq}`
    job.__persistId = persistId
    try {
      persistEntries.set(persistId, { id: persistId, at: new Date(now()).toISOString(), job: serializeJob(job) })
    } catch (error) {
      if (typeof onPersistError === 'function') onPersistError(error)
      return
    }
    saveSoon()
  }

  function forgetJob(job) {
    if (!hasPersist() || !job?.__persistId) return
    persistEntries.delete(job.__persistId)
    saveSoon()
  }

  function resumePending() {
    if (!hasPersist()) return 0
    const maxAge = Math.max(0, Number(persistMaxAgeMs) || 0)
    const fresh = readPersisted().filter((entry) => {
      const at = Date.parse(entry?.at || '')
      if (!Number.isFinite(at)) return false
      return maxAge === 0 || now() - at <= maxAge
    })
    let resumed = 0
    for (const entry of fresh) {
      try {
        const job = rehydrateJob(entry.job)
        if (!job) continue
        job.__persistId = entry.id
        job.__resumedAt = entry.at
        pending.push(job)
        persistEntries.set(entry.id, entry)
        resumed += 1
      } catch { /* une entrée illisible ne doit pas bloquer la reprise */ }
    }
    resumedCount = resumed
    if (resumed) saveSoon()
    return resumed
  }
  let lastSentAt = 0
  let timer = null
  let firstUseDayKey = ''
  const stats = {
    sentToday: 0,
    failedToday: 0,
    retried: 0,
    consecutiveFailures: 0,
    paused: false,
    pausedUntil: null,
    lastError: '',
    lastErrorAt: null,
    day: dayKey(now()),
  }

  function rollDayIfNeeded() {
    const today = dayKey(now())
    if (today !== stats.day) {
      stats.day = today
      stats.sentToday = 0
      stats.failedToday = 0
      stats.retried = 0
      stats.consecutiveFailures = 0
    }
  }

  function daysActive() {
    if (!firstUseDayKey) return 0
    const start = new Date(`${firstUseDayKey}T00:00:00Z`).getTime()
    return Math.max(0, Math.floor((now() - start) / DAY_MS))
  }

  function breaker() {
    const maxFails = Math.max(1, Number(circuitBreaker?.maxConsecutiveFailures) || 1)
    const cooldown = Math.max(1, Number(circuitBreaker?.cooldownMs) || 10 * 60 * 1000)
    return { maxFails, cooldown }
  }

  function triggerPause() {
    const { cooldown } = breaker()
    stats.paused = true
    stats.pausedUntil = now() + cooldown
    stats.lastError = `Trop d'échecs consécutifs (${stats.consecutiveFailures}) — file en pause ${Math.round(cooldown / 60000)} min`
    stats.lastErrorAt = new Date(now()).toISOString()
  }

  function status() {
    rollDayIfNeeded()
    const sendHoursOpen = isWithinSendHours(new Date(now()).getHours(), sendHours)
    return {
      queued: pending.length + (current ? 1 : 0),
      ...stats,
      sendHours: sendHours ? { start: sendHours.start, end: sendHours.end } : null,
      outsideSendHours: Boolean(sendHours) && !sendHoursOpen,
      // Reprise après redémarrage : combien d'alertes ont survécu au restart.
      persistenceEnabled: persistenceOn,
      resumedOnBoot: resumedCount,
      persistedPending: persistEntries.size,
    }
  }

  async function flush() {
    // Le timer qui a déclenché ce flush a tiré : libérer la référence pour
    // que les prochains enqueue puissent reprogrammer un flush.
    timer = null
    rollDayIfNeeded()
    if (!firstUseDayKey) firstUseDayKey = stats.day
    const interval = resolveInterval(minIntervalMs)
    const limit = resolveDailyLimit(dailyLimit, daysActive())

    const elapsed = now() - lastSentAt
    if (elapsed < interval) {
      timer = setTimeout(flush, interval - elapsed)
      return
    }
    if (stats.sentToday >= limit) {
      // Même au plafond journalier, les alertes critiques (deferrable:false)
      // passent : on ne bloque pas une alerte géofence/flotte derrière un quota
      // anti-ban. Le reste (BL/notifs) attend l'ouverture suivante (00:00).
      if (pending.findIndex((entry) => entry.deferrable === false) < 0) {
        timer = setTimeout(flush, 60_000)
        return
      }
    }
    if (stats.paused && (stats.pausedUntil || 0) > now()) {
      timer = setTimeout(flush, Math.max(1, Math.min(60_000, (stats.pausedUntil || now()) - now())))
      return
    }
    if (stats.paused) {
      stats.paused = false
      stats.pausedUntil = null
      stats.consecutiveFailures = 0
    }
    if (current) {
      timer = setTimeout(flush, interval)
      return
    }
    const inHours = isWithinSendHours(new Date(now()).getHours(), sendHours)
    // Critiques (flotte/géofence, deferrable:false) : à faible volume, elles
    // passent TOUJOURS — hors fenêtre horaire ET au plafond journalier.
    const criticalIndex = pending.findIndex((entry) => entry.deferrable === false)
    let job = null
    if (!inHours || stats.sentToday >= limit) {
      // Fenêtre fermée OU quota quotidien atteint : seules les alertes partent.
      if (criticalIndex >= 0) {
        job = pending.splice(criticalIndex, 1)[0]
      } else {
        const delay = inHours ? 60_000 : Math.min(msUntilSendHoursOpen(now(), sendHours) || 60_000, 3600_000)
        timer = setTimeout(flush, delay)
        return
      }
    } else {
      // Fenêtre ouverte et sous quota : FIFO. Les alertes, priorisées à
      // l'enqueue, sont en tête et partent en premier.
      job = pending.shift()
    }
    if (!job) return
    current = job
    try {
      let attempt = 0
      let result
      for (;;) {
        attempt += 1
        result = await sendFn(job)
        // Échec réessayable : erreur API/5xx (pas un skip, pas un rejet template, pas un 463)
        if (!result?.sent && !result?.skipped && attempt <= maxRetries && !result?.errorKind) {
          stats.retried += 1
          await new Promise((resolve) => setTimeout(resolve, interval * attempt))
          continue
        }
        break
      }
      lastSentAt = now()
      if (result?.sent) {
        stats.sentToday += 1
        stats.consecutiveFailures = 0
      } else {
        stats.failedToday += 1
        stats.consecutiveFailures += 1
        stats.lastError = result?.reason || 'Échec d’envoi'
        stats.lastErrorAt = new Date(now()).toISOString()
        const { maxFails } = breaker()
        if (stats.consecutiveFailures >= maxFails) triggerPause()
      }
      if (typeof job.onResult === 'function') {
        try { await job.onResult(result) } catch { /* journalisation best-effort */ }
      }
      if (typeof onResult === 'function') {
        // onResult de la file (ex. whatsAppQueueOnResult) : enregistrement réel
        // de l'envoi (sent/failed) + log « envoyé à ». C'est ce qui manquait —
        // sans lui, l'historique ne montrait que « queued/failed » et jamais
        // la confirmation d'envoi.
        try { await onResult(result, job) } catch { /* journalisation best-effort */ }
      }
    } catch (error) {
      stats.failedToday += 1
      stats.consecutiveFailures += 1
      stats.lastError = error?.message || 'Erreur inattendue'
      stats.lastErrorAt = new Date(now()).toISOString()
      const { maxFails } = breaker()
      if (stats.consecutiveFailures >= maxFails) triggerPause()
      if (typeof job.onResult === 'function') {
        try { await job.onResult({ sent: false, skipped: false, reason: stats.lastError }) } catch { /* ignore */ }
      }
      if (typeof onResult === 'function') {
        try { await onResult({ sent: false, skipped: false, reason: stats.lastError }, job) } catch { /* ignore */ }
      }
    } finally {
      current = null
      // Job tenté (envoyé, échoué ou rejeté) : il ne doit plus être rejoué.
      forgetJob(job)
      if (pending.length || stats.sentToday >= limit || ((stats.pausedUntil || 0) > now())) {
        timer = setTimeout(flush, interval)
      }
    }
  }

  function enqueue(job) {
    const entry = { ...job }
    rememberJob(entry)
    const isAlert = entry.deferrable === false
    if (isAlert) pending.unshift(entry)
    else pending.push(entry)
    // Une alerte critique doit RÉVEILLER la file immédiatement : elle passe
    // toujours (même en pause quota/fenêtre), sans quoi elle attendrait le
    // timer en cours (60 s au plafond, jusqu'à 1 h hors fenêtre).
    if (!current) {
      if (isAlert) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, 0)
      } else if (!timer) {
        timer = setTimeout(flush, 0)
      }
    }
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  // Reprise au démarrage : les alertes en attente au moment du redémarrage sont
  // rejouées (fenêtre/quota appliqués normalement par flush).
  const resumedOnBoot = resumePending()
  if (resumedOnBoot) timer = setTimeout(flush, 0)

  return { enqueue, status, stop, resumedOnBoot }
}
