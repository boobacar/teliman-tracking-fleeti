// Rapports programmés : un type de rapport = une heure d'envoi choisie par
// l'utilisateur. Logique pure (aucune dépendance HTTP/DB) pour rester testable.
//
// Deux types aujourd'hui, alignés sur les catégories de routage existantes
// (alertRouting.js) : le rapport quotidien et le rapport hebdomadaire. Chacun a
// sa propre heure — régler le rapport quotidien à 20h ne touche pas l'hebdomadaire.

export const WEEKDAY_LABELS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

export const REPORT_TYPES = [
  {
    key: 'report_daily',
    label: 'Rapport quotidien',
    description: 'Ce que chaque camion a fait dans la journée',
    defaultHour: 20,
    defaultMinute: 0,
    defaultWeekday: null, // tous les jours
  },
  {
    key: 'report_weekly',
    label: 'Rapport hebdomadaire',
    description: 'Synthèse de la semaine, envoyée un jour fixe',
    defaultHour: 8,
    defaultMinute: 0,
    defaultWeekday: 1, // lundi
  },
  {
    // Rapport du bus (activité, vitesses, kilométrage, alertes, vidange) — demandé par
    // l'exploitation, tous les jours à 19h.
    key: 'report_bus',
    label: 'Rapport bus',
    description: 'Activité du bus, vitesses, kilométrage, alertes et rappel de vidange',
    defaultHour: 19,
    defaultMinute: 0,
    defaultWeekday: null, // tous les jours
  },
]

export const REPORT_TYPES_BY_KEY = Object.fromEntries(REPORT_TYPES.map((type) => [type.key, type]))

export function reportTypeExists(key) {
  return Boolean(REPORT_TYPES_BY_KEY[String(key || '').trim()])
}

export function defaultScheduleFor(key) {
  const type = REPORT_TYPES_BY_KEY[String(key || '').trim()]
  if (!type) return null
  return {
    reportKey: type.key,
    hour: type.defaultHour,
    minute: type.defaultMinute,
    weekday: type.defaultWeekday,
    enabled: true,
  }
}

export function defaultSchedules() {
  return REPORT_TYPES.map((type) => defaultScheduleFor(type.key))
}

// Convertit une valeur d'heure en entier dans les bornes, ou renvoie null.
function toBoundedInteger(value, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').trim(), 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

// Valide le corps d'une requête de réglage. Refuse explicitement plutôt que de
// corriger en silence : une heure fausse doit être signalée, pas devinée.
export function validateReportScheduleInput(body = {}) {
  const out = {}
  if (body.hour !== undefined) {
    const hour = toBoundedInteger(body.hour, 0, 23)
    if (hour === null) throw new Error('Heure invalide (0 à 23).')
    out.hour = hour
  }
  if (body.minute !== undefined) {
    const minute = toBoundedInteger(body.minute, 0, 59)
    if (minute === null) throw new Error('Minutes invalides (0 à 59).')
    out.minute = minute
  }
  if (body.weekday !== undefined) {
    if (body.weekday === null || body.weekday === '' || body.weekday === 'null') {
      out.weekday = null
    } else {
      const weekday = toBoundedInteger(body.weekday, 0, 6)
      if (weekday === null) throw new Error('Jour de la semaine invalide (0 = dimanche à 6 = samedi).')
      out.weekday = weekday
    }
  }
  if (body.enabled !== undefined) out.enabled = Boolean(body.enabled)
  if (!Object.keys(out).length) throw new Error('Aucun réglage fourni.')
  return out
}

// Applique un réglage partiel sur un planning existant (ou sur les valeurs par
// défaut du type de rapport).
export function normalizeSchedule(key, input = {}, current = null) {
  const base = current || defaultScheduleFor(key)
  if (!base) throw new Error('Type de rapport inconnu.')
  const validated = validateReportScheduleInput(input)
  return {
    reportKey: base.reportKey,
    hour: validated.hour ?? base.hour,
    minute: validated.minute ?? base.minute,
    weekday: validated.weekday === undefined ? base.weekday : validated.weekday,
    enabled: validated.enabled === undefined ? base.enabled : validated.enabled,
  }
}

// Le planning doit-il partir maintenant ? L'ordonnanceur appelle cette fonction
// toutes les 30 secondes : elle est vraie pendant la minute configurée.
export function isReportDue(schedule, now = new Date()) {
  if (!schedule || schedule.enabled === false) return false
  if (now.getHours() !== Number(schedule.hour)) return false
  if (now.getMinutes() !== Number(schedule.minute)) return false
  if (schedule.weekday !== null && schedule.weekday !== undefined && Number(schedule.weekday) !== now.getDay()) return false
  return true
}

// Clé d'unicité d'un envoi : un rapport ne part qu'une fois par jour, même si le
// serveur redémarre pendant la minute d'envoi.
export function reportDayKey(reportKey, now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${reportKey}:${now.getFullYear()}-${month}-${day}`
}

export function formatHourMinute(hour, minute = 0) {
  return `${String(Number(hour)).padStart(2, '0')}h${String(Number(minute)).padStart(2, '0')}`
}

export function formatScheduleLabel(schedule) {
  if (!schedule) return 'non planifié'
  const time = formatHourMinute(schedule.hour, schedule.minute)
  if (schedule.weekday === null || schedule.weekday === undefined) return `tous les jours à ${time}`
  return `chaque ${WEEKDAY_LABELS[Number(schedule.weekday)] || 'jour'} à ${time}`
}
