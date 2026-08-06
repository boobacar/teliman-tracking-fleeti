// File d'attente WhatsApp : throttle (~1 message/s), retry avec backoff,
// compteur d'envois journalier (plafond Meta en phase de démarrage).

const DEFAULT_MIN_INTERVAL_MS = 1100
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_DAILY_LIMIT = 250
const DAY_MS = 24 * 60 * 60 * 1000

export function dayKey(now = Date.now()) {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createWhatsAppQueue({
  sendFn,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  dailyLimit = DEFAULT_DAILY_LIMIT,
  now = () => Date.now(),
} = {}) {
  if (typeof sendFn !== 'function') throw new Error('createWhatsAppQueue: sendFn requis')

  const pending = []
  let current = null
  let lastSentAt = 0
  let timer = null
  const stats = {
    sentToday: 0,
    failedToday: 0,
    retried: 0,
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
    }
  }

  function status() {
    rollDayIfNeeded()
    return { queued: pending.length + (current ? 1 : 0), ...stats }
  }

  async function flush() {
    rollDayIfNeeded()
    const elapsed = now() - lastSentAt
    if (elapsed < minIntervalMs) {
      timer = setTimeout(flush, minIntervalMs - elapsed)
      return
    }
    if (stats.sentToday >= dailyLimit) {
      timer = setTimeout(flush, 60_000)
      return
    }
    if (current) {
      timer = setTimeout(flush, minIntervalMs)
      return
    }
    const job = pending.shift()
    if (!job) return
    current = job
    try {
      let attempt = 0
      let result
      for (;;) {
        attempt += 1
        result = await sendFn(job)
        // Échec réessayable : erreur API/5xx (pas un skip, pas un rejet template)
        if (!result?.sent && !result?.skipped && attempt <= maxRetries && !result?.errorKind) {
          stats.retried += 1
          await new Promise((resolve) => setTimeout(resolve, minIntervalMs * attempt))
          continue
        }
        break
      }
      lastSentAt = now()
      if (result?.sent) {
        stats.sentToday += 1
      } else {
        stats.failedToday += 1
        stats.lastError = result?.reason || 'Échec d’envoi'
        stats.lastErrorAt = new Date(now()).toISOString()
      }
      if (typeof job.onResult === 'function') {
        try { await job.onResult(result) } catch { /* journalisation best-effort */ }
      }
    } catch (error) {
      stats.failedToday += 1
      stats.lastError = error?.message || 'Erreur inattendue'
      stats.lastErrorAt = new Date(now()).toISOString()
      if (typeof job.onResult === 'function') {
        try { await job.onResult({ sent: false, skipped: false, reason: stats.lastError }) } catch { /* ignore */ }
      }
    } finally {
      current = null
      if (pending.length || stats.sentToday >= dailyLimit) {
        timer = setTimeout(flush, minIntervalMs)
      }
    }
  }

  function enqueue(job) {
    pending.push({ ...job })
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
