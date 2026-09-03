// File d'attente WhatsApp : throttle (fixe ou jitter), retry avec backoff,
// plafond journalier (fixe ou warm-up progressif), circuit-breaker
// anti-tempête d'erreurs (pause automatique avant ban) et fenêtre horaire
// naturelle (pas d'envoi en rafale la nuit ; les alertes passent quand même).

const DEFAULT_MIN_INTERVAL_MS = 1100
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_DAILY_LIMIT = 250
const DEFAULT_CIRCUIT_BREAKER = { maxConsecutiveFailures: 8, cooldownMs: 10 * 60 * 1000 }
const DAY_MS = 24 * 60 * 60 * 1000

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
} = {}) {
  if (typeof sendFn !== 'function') throw new Error('createWhatsAppQueue: sendFn requis')

  const pending = []
  let current = null
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
      timer = setTimeout(flush, 60_000)
      return
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
    let job = pending.shift()
    if (!inHours) {
      // Hors fenêtre d'envoi : les jobs deferrable (BL, notifications) attendent
      // l'ouverture ; seules les alertes (deferrable: false) partent immédiatement.
      if (job && job.deferrable !== false) {
        pending.unshift(job)
        job = null
      }
      if (!job) {
        const alertIndex = pending.findIndex((entry) => entry.deferrable === false)
        if (alertIndex >= 0) job = pending.splice(alertIndex, 1)[0]
      }
      if (!job) {
        timer = setTimeout(flush, Math.min(msUntilSendHoursOpen(now(), sendHours) || 60_000, 3600_000))
        return
      }
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
    } finally {
      current = null
      if (pending.length || stats.sentToday >= limit || ((stats.pausedUntil || 0) > now())) {
        timer = setTimeout(flush, interval)
      }
    }
  }

  function enqueue(job) {
    const entry = { ...job }
    // Les alertes (flotte/géofence) sont critiques et à faible volume : elles
    // passent DEVANT les BL/notifications pour être livrées en temps réel,
    // afin que l'heure affichée dans l'alerte ≈ l'heure de réception.
    // (Hors fenêtre horaire, `flush` les fait déjà passer ; en fenêtre, ce
    // unshift évite qu'elles attendent derrière une rafale de BL.)
    if (entry.deferrable === false) pending.unshift(entry)
    else pending.push(entry)
    if (!current && !timer) {
      timer = setTimeout(flush, 0)
    }
  }

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { enqueue, status, stop }
}
