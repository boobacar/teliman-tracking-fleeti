// Cycle de vie des alertes — logique pure, testable.
// Une alerte passe par : new → acknowledged → processing → resolved.
// Clé d'incident : type d'événement + camion + jour → regroupement anti-bruit.

export const ALERT_STATUSES = ['new', 'acknowledged', 'processing', 'resolved']
export const ALERT_PRIORITIES = ['low', 'normal', 'medium', 'high', 'critical']
export const ESCALATION_AFTER_MS = 24 * 60 * 60 * 1000

export function defaultAlertPriority(eventType) {
  if (eventType === 'speedup') return 'high'
  if (eventType === 'fuel_level_leap') return 'medium'
  if (eventType === 'crash_alarm' || eventType === 'geofence_exit' || eventType === 'geofence_enter') return 'medium'
  return 'normal'
}

export function dayBucket(time) {
  if (!time) return 'unknown'
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toISOString().slice(0, 10)
}

// Clé stable d'un incident : même camion + même type + même jour = même alerte.
export function buildAlertKey(event = {}) {
  const trackerId = event.tracker_id ?? event.trackerId ?? event.tracker?.id ?? 'unknown'
  const type = event.event ?? event.type ?? event.alert_type ?? 'unknown'
  return `${String(trackerId)}|${String(type)}|${dayBucket(event.time ?? event.timestamp ?? event.date)}`
}

export function mergeAlertActions(history, actions = [], now = Date.now()) {
  const actionByKey = new Map()
  for (const action of actions) actionByKey.set(action.alertKey, action)

  const alerts = []
  for (const event of history || []) {
    const key = buildAlertKey(event)
    const action = actionByKey.get(key) || {}
    const status = action.status || 'new'
    const priority = action.priority || defaultAlertPriority(event.event) || 'normal'
    const eventTime = new Date(event.time ?? event.timestamp ?? event.date ?? 0).getTime()
    const escalated = status === 'new'
      && Number.isFinite(eventTime)
      && eventTime > 0
      && now - eventTime > ESCALATION_AFTER_MS
    alerts.push({
      ...event,
      key,
      status,
      priority,
      effectivePriority: escalated && priority !== 'critical' ? 'high' : priority,
      escalated,
      assignedTo: action.assignedTo || '',
      comment: action.comment || '',
      acknowledgedAt: action.acknowledgedAt || null,
      resolvedAt: action.resolvedAt || null,
      actionHistory: Array.isArray(action.history) ? action.history : [],
    })
  }
  return alerts
}

export function countUnprocessed(alerts) {
  return (alerts || []).filter((alert) => alert.status === 'new').length
}

export function transitionAlertAction(previous, patch, now = new Date().toISOString()) {
  const next = {
    alertKey: previous?.alertKey,
    status: patch.status || previous?.status || 'new',
    priority: patch.priority || previous?.priority || null,
    assignedTo: patch.assignedTo !== undefined ? patch.assignedTo : (previous?.assignedTo || ''),
    comment: patch.comment !== undefined ? patch.comment : (previous?.comment || ''),
    history: Array.isArray(previous?.history) ? [...previous.history] : [],
    acknowledgedAt: previous?.acknowledgedAt || null,
    resolvedAt: previous?.resolvedAt || null,
    updatedAt: now,
  }
  const transitions = []
  if (patch.status && patch.status !== (previous?.status || 'new')) transitions.push(patch.status)
  if (patch.priority && patch.priority !== previous?.priority) transitions.push(`priorité: ${patch.priority}`)
  if (patch.assignedTo !== undefined && patch.assignedTo !== (previous?.assignedTo || '')) transitions.push(`assigné: ${patch.assignedTo}`)
  if (patch.comment !== undefined && patch.comment !== (previous?.comment || '')) transitions.push('commentaire mis à jour')
  if (transitions.length > 0) {
    next.history.push({ at: now, changes: transitions.join(', ') })
  }
  if (patch.status && patch.status !== 'new' && !next.acknowledgedAt) next.acknowledgedAt = now
  if (patch.status === 'resolved') next.resolvedAt = now
  if (patch.status !== 'resolved' && next.resolvedAt) next.resolvedAt = null
  return next
}
