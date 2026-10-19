// Rapport bus — demandé par Mado pour le véhicule 5273WWCI01 : tous les jours à 19h,
// avec le début et la fin d'activité, les vitesses moyenne et maximale, le kilométrage,
// les alertes (excès de vitesse, accident), le rappel de vidange et les trajets du jour.
//
// Les chiffres viennent de la télémétrie Fleeti (points horodatés avec vitesse) et des
// passages de zone : rien n'est estimé. Une donnée absente est annoncée comme telle.
import { displayPlace } from './dailyReport.js'

// Trajets habituels du bus (relevé par l'exploitation, sert de référence au rapport).
export const BUS_USUAL_ROUTE = [
  { moment: 'matin', path: ['Kani', 'Fadiadougou', 'Bongogo'] },
  { moment: 'journée', path: ['Bongogo', 'alentours de Bongogo'] },
  { moment: '10h', path: ['Bongogo', 'Fadiadougou'] },
  { moment: 'retour', path: ['Fadiadougou', 'Bongogo'] },
  { moment: 'soir', path: ['Bongogo', 'Fadiadougou', 'Kani'] },
]

export const DEFAULT_BUS_MAINTENANCE = {
  intervalKm: 5000,
  warnFromKm: 4000,
  alertFromKm: 4800,
  lastServiceOdometerKm: null,
  lastServiceDate: '',
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function clockOf(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getHours()}h${pad(date.getMinutes())}`
}

function haversineKm(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const earthKm = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

function durationLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  const total = Math.round(minutes)
  return `${Math.floor(total / 60)}h${pad(total % 60)}`
}

// Statistiques de conduite calculées sur les points GPS du jour.
export function summariseBusTelemetry(points = []) {
  const usable = points
    .filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)))
    .map((point) => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
      speed: Number.isFinite(Number(point.speed)) ? Number(point.speed) : null,
      time: point.time || point.timestamp || '',
      at: point.time || point.timestamp ? new Date(point.time || point.timestamp).getTime() : null,
    }))
    .sort((a, b) => (a.at || 0) - (b.at || 0))

  if (!usable.length) {
    return { points: 0, distanceKm: null, startTime: '', endTime: '', amplitudeMinutes: null, avgSpeed: null, maxSpeed: null, movingPoints: 0 }
  }

  // La distance suit le trajet réel point par point. Deux garde-fous : les segments où
  // le véhicule est à l'arrêt (gigue GPS) et les sauts impossibles sont ignorés.
  let distanceKm = 0
  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1]
    const current = usable[index]
    const gapKm = haversineKm(previous, current)
    const parked = (previous.speed ?? 0) <= 3 || (current.speed ?? 0) <= 3
    if (parked && gapKm < 0.3) continue
    const elapsedHours = previous.at && current.at ? (current.at - previous.at) / 3600000 : 0
    if (elapsedHours > 0 && gapKm / elapsedHours > 150) continue // saut GPS : segment ignoré
    distanceKm += gapKm
  }

  const moving = usable.filter((point) => point.speed !== null && point.speed > 3)
  const speeds = usable.map((point) => point.speed).filter((speed) => speed !== null)
  const avgSpeed = moving.length
    ? moving.reduce((sum, point) => sum + point.speed, 0) / moving.length
    : null
  const maxSpeed = speeds.length ? Math.max(...speeds) : null
  // Début = premier point en mouvement ; fin = dernier point enregistré (fin de service).
  const start = moving[0] || usable[0]
  const end = usable[usable.length - 1]
  const amplitude = start.at && end.at ? (end.at - start.at) / 60000 : null

  return {
    points: usable.length,
    movingPoints: moving.length,
    distanceKm: Math.round(distanceKm * 10) / 10,
    startTime: start.time,
    endTime: end.time,
    amplitudeMinutes: amplitude,
    avgSpeed: avgSpeed === null ? null : Math.round(avgSpeed * 10) / 10,
    maxSpeed,
    maxSpeedAt: maxSpeed === null ? '' : clockOf(usable.find((point) => point.speed === maxSpeed)?.time),
  }
}

// Trajets du jour : enchaînement des passages de zone (entrées), dans l'ordre.
export function buildBusItinerary(events = []) {
  return events
    .filter((event) => String(event?.eventType || event?.type || '') === 'enter')
    .map((event) => ({ zone: displayPlace(event.geofenceName || event.zone || ''), at: event.createdAt || event.timestamp }))
    .filter((step) => step.zone)
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0))
    .map((step) => ({ zone: step.zone, time: clockOf(step.at) }))
}

// Rappel de vidange. Deux sources possibles, dans cet ordre :
//   1. la distance cumulée depuis la dernière vidange, additionnée sur les kilométrages
//      quotidiens du suivi GPS (fonctionne même si le boîtier ne remonte pas de compteur) ;
//   2. le compteur du véhicule moins le compteur relevé à la dernière vidange.
// Aucune valeur n'est inventée : sans référence, le rapport le dit.
export function maintenanceStatus(source = {}, maintenance = DEFAULT_BUS_MAINTENANCE) {
  const settings = { ...DEFAULT_BUS_MAINTENANCE, ...maintenance }
  const rawCumulated = source?.kmSinceService
  const rawOdometer = source?.odometerKm
  const cumulated = rawCumulated === null || rawCumulated === undefined ? null : Number(rawCumulated)
  const odometerKm = rawOdometer === null || rawOdometer === undefined ? null : Number(rawOdometer)
  const hasCumulated = cumulated !== null && Number.isFinite(cumulated) && cumulated >= 0
  if (!hasCumulated && !Number.isFinite(odometerKm)) {
    return { level: 'unknown', text: 'Kilométrage indisponible (ni compteur, ni kilométrages du suivi).', sinceServiceKm: null }
  }
  const reference = Number(settings.lastServiceOdometerKm)
  if (!hasCumulated && (!Number.isFinite(reference) || reference <= 0)) {
    return {
      level: 'unknown',
      odometerKm: odometerKm === null ? null : Math.round(odometerKm),
      sinceServiceKm: null,
      text: `Référence de vidange non renseignée — enregistrer la dernière vidange (date${odometerKm !== null ? ` et compteur : ${Math.round(odometerKm).toLocaleString('fr-FR')} km` : ''}) dans la plateforme pour activer le rappel (vidange à 5 000 km, alerte dès 4 000 km).`,
    }
  }
  const since = hasCumulated ? Math.round(cumulated) : Math.round(odometerKm - reference)
  const interval = Number(settings.intervalKm) || 5000
  const alert = Number(settings.alertFromKm) || 4800
  const warn = Number(settings.warnFromKm) || 4000
  const suffix = hasCumulated ? ` (cumul des kilométrages du suivi${settings.lastServiceDate ? ` depuis le ${settings.lastServiceDate}` : ''})` : ''
  if (since >= interval) {
    return { level: 'overdue', sinceServiceKm: since, text: `Vidange dépassée : ${since.toLocaleString('fr-FR')} km depuis la dernière vidange (intervalle ${interval.toLocaleString('fr-FR')} km)${suffix}.` }
  }
  if (since >= alert) {
    return { level: 'due', sinceServiceKm: since, text: `Vidange à faire : ${since.toLocaleString('fr-FR')} km depuis la dernière vidange (seuil d’alerte ${alert.toLocaleString('fr-FR')} km, vidange à ${interval.toLocaleString('fr-FR')} km)${suffix}.` }
  }
  if (since >= warn) {
    return { level: 'warn', sinceServiceKm: since, text: `Vidange à programmer : ${since.toLocaleString('fr-FR')} km depuis la dernière vidange (seuil ${warn.toLocaleString('fr-FR')} km, vidange à ${interval.toLocaleString('fr-FR')} km)${suffix}.` }
  }
  return { level: 'ok', sinceServiceKm: since, text: `Vidange : ${since.toLocaleString('fr-FR')} km depuis la dernière vidange — rien à prévoir avant ${(warn - since).toLocaleString('fr-FR')} km${suffix}.` }
}

// Seuil de surveillance des excès de vitesse (km/h) — la plateforme signale elle-même
// les dépassements constatés dans la télémétrie, sans dépendre des règles du fournisseur.
export const BUS_SPEED_WATCH_KMH = 90

export function detectSpeedBreaches(points = [], limitKmh = BUS_SPEED_WATCH_KMH) {
  return points
    .filter((point) => Number(point?.speed) > limitKmh)
    .map((point) => ({
      speed: Math.round(Number(point.speed)),
      at: point.time || point.timestamp || '',
      time: clockOf(point.time || point.timestamp),
      lat: Number(point?.lat),
      lng: Number(point?.lng),
    }))
    .sort((a, b) => b.speed - a.speed)
}

// Un excès de vitesse n'est pas un point isolé mais un épisode : on regroupe les relevés
// consécutifs (même trajet, moins de 5 minutes d'écart) pour n'afficher qu'une ligne.
export function groupSpeedBreaches(breaches = [], { gapMinutes = 10 } = {}) {
  const bornes = Number(gapMinutes) > 0 ? Number(gapMinutes) : 10
  const propres = []
  const vus = new Set()
  for (const breach of Array.isArray(breaches) ? breaches : []) {
    const at = breach?.at || breach?.time || ''
    const cle = `${at}|${breach?.speed}|${breach?.lat}|${breach?.lng}`
    if (vus.has(cle)) continue // le flux peut répéter le même point
    vus.add(cle)
    const date = at ? new Date(at) : null
    if (date && !Number.isNaN(date.getTime())) propres.push({ ...breach, date })
    else propres.push({ ...breach, date: null })
  }
  propres.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0))

  const episodes = []
  for (const breach of propres) {
    const dernier = episodes[episodes.length - 1]
    const ecart = dernier?.fin && breach.date ? (breach.date.getTime() - dernier.fin.getTime()) / 60000 : Infinity
    if (dernier && ecart <= bornes) {
      dernier.count += 1
      dernier.fin = breach.date || dernier.fin
      if (Number(breach.speed) > Number(dernier.maxSpeed)) {
        dernier.maxSpeed = Number(breach.speed)
        dernier.peak = breach
        if (breach.place) dernier.place = breach.place
      }
      continue
    }
    episodes.push({
      debut: breach.date,
      fin: breach.date,
      count: 1,
      maxSpeed: Number(breach.speed) || 0,
      peak: breach,
      place: breach.place || '',
    })
  }
  return episodes.map((episode) => ({
    from: episode.debut ? clockOf(episode.debut.toISOString()) : (episode.peak?.time || ''),
    to: episode.fin ? clockOf(episode.fin.toISOString()) : '',
    count: episode.count,
    maxSpeed: Math.round(episode.maxSpeed),
    place: episode.place || '',
    lat: episode.peak?.lat ?? null,
    lng: episode.peak?.lng ?? null,
  }))
}

export function buildBusReport({
  plate = '5273WWCI01',
  day,
  dateLabel,
  hourLabel = '19h',
  points = [],
  events = [],
  alerts = [],
  odometerKm = null,
  mileageKm = null,
  kmSinceService = null,
  maintenance = DEFAULT_BUS_MAINTENANCE,
  usualRoute = BUS_USUAL_ROUTE,
  speedLimitKmh = BUS_SPEED_WATCH_KMH,
  speedBreaches = null,
}) {
  const telemetry = summariseBusTelemetry(points)
  const itinerary = buildBusItinerary(events)
  // Dépassements : ceux fournis (déjà situés) priment sur la détection brute.
  const breaches = Array.isArray(speedBreaches) && speedBreaches.length
    ? speedBreaches
    : detectSpeedBreaches(points, speedLimitKmh)
  const episodes = groupSpeedBreaches(breaches)

  const speedAlerts = alerts.filter((alert) => String(alert?.event || alert?.type || '') === 'speedup')
  const crashAlerts = alerts.filter((alert) => String(alert?.event || alert?.type || '') === 'crash_alarm')
  const maintenanceInfo = maintenanceStatus({ odometerKm, kmSinceService }, maintenance)

  const lines = [`TELIMAN LOGISTIQUE - Rapport bus ${plate} du ${dateLabel}${hourLabel ? ` (${hourLabel})` : ''}`, '']

  lines.push('ACTIVITÉ')
  if (telemetry.points) {
    lines.push(`- Début : ${clockOf(telemetry.startTime) || '—'} · Fin : ${clockOf(telemetry.endTime) || '—'}${telemetry.amplitudeMinutes ? ` (${durationLabel(telemetry.amplitudeMinutes)} d'amplitude)` : ''}`)
  } else {
    lines.push('- Aucun point GPS reçu sur la journée.')
  }
  const officialMileage = Number.isFinite(Number(mileageKm)) ? Number(mileageKm) : null
  if (officialMileage !== null) {
    // Valeur du suivi GPS (référence de l'exploitation) ; le calcul sur les points sert de contrôle.
    const ecart = telemetry.distanceKm === null ? null : Math.abs(officialMileage - telemetry.distanceKm)
    lines.push(`- Kilométrage : ${officialMileage.toLocaleString('fr-FR')} km${ecart !== null && ecart > 5 ? ` (contrôle GPS : ${telemetry.distanceKm.toLocaleString('fr-FR')} km)` : ''}`)
  } else {
    lines.push(`- Kilométrage : ${telemetry.distanceKm === null ? 'indisponible' : `${telemetry.distanceKm.toLocaleString('fr-FR')} km (calculé sur les points GPS)`}`)
  }
  const speedParts = []
  speedParts.push(`vitesse moyenne ${telemetry.avgSpeed === null ? 'indisponible' : `${telemetry.avgSpeed.toLocaleString('fr-FR')} km/h`}`)
  speedParts.push(`vitesse maximale ${telemetry.maxSpeed === null ? 'indisponible' : `${telemetry.maxSpeed.toLocaleString('fr-FR')} km/h`}`)
  lines.push(`- ${speedParts.join(' · ')}`)

  lines.push('', 'TRAJETS ENREGISTRÉS')
  if (itinerary.length) {
    lines.push(...itinerary.map((step) => `- ${step.time} : ${step.zone}`))
    const zones = new Set(itinerary.map((step) => step.zone.toLowerCase()))
    const missing = ['kani', 'fadiadougou', 'bongogo'].filter((stop) => ![...zones].some((zone) => zone.includes(stop.replace('fadia', 'fady')) || zone.includes(stop)))
    if (missing.length) lines.push(`- Passage non enregistré : ${missing.map((name) => displayPlace(name)).join(', ')}`)
  } else {
    lines.push('- Aucun passage de zone enregistré (les zones doivent être déclarées dans la plateforme).')
  }
  lines.push(`- Trajet habituel : ${usualRoute.map((leg) => leg.path.join(' → ')).join(' · ')}`)

  lines.push('', 'ALERTES')
  const breachCount = Math.max(speedAlerts.length, breaches.length)
  if (breaches.length) {
    // Constat direct sur la télémétrie : le seuil est vérifié par la plateforme.
    const nbEpisodes = episodes.length
    const libelleEpisodes = `${nbEpisodes} épisode${nbEpisodes > 1 ? 's' : ''}`
    lines.push(`- Excès de vitesse : ${libelleEpisodes} (${breaches.length} relevé${breaches.length > 1 ? 's' : ''}), pointe ${telemetry.maxSpeed ?? '—'} km/h`)
    for (const episode of episodes.slice(0, 3)) {
      // L'endroit n'est indiqué que pour un dépassement au-delà du seuil.
      const lieu = episode.maxSpeed > Number(speedLimitKmh) && episode.place ? ` — ${episode.place}` : ''
      const detail = episode.count > 1 ? `${episode.count} relevés, pointe ${episode.maxSpeed} km/h` : `pointe ${episode.maxSpeed} km/h`
      const plage = episode.from && episode.to && episode.to !== episode.from ? `de ${episode.from} à ${episode.to}` : `${episode.from}`
      lines.push(`   ${plage} : ${detail}${lieu}`)
    }
  } else if (speedAlerts.length) {
    // Signalements du suivi GPS (règle de vitesse du fournisseur), sous le seuil interne.
    lines.push(`- Excès de vitesse : ${speedAlerts.length} signalé(s) par le suivi (pointe ${telemetry.maxSpeed ?? '—'} km/h)`)
    for (const alert of speedAlerts.slice(0, 3)) {
      const at = clockOf(alert.createdAt || alert.time || alert.timestamp)
      const speed = alert.speed ?? alert.speed_kmh ?? null
      lines.push(`   à ${at || 'heure inconnue'}${speed ? ` (${speed} km/h)` : ''}`)
    }
  } else {
    lines.push(`- Excès de vitesse : aucun au-dessus de ${speedLimitKmh} km/h`)
  }
  lines.push(`- Accident : ${crashAlerts.length ? `${crashAlerts.length} signalé(s) — vérifier l’état du véhicule` : 'aucun signalement'}`)

  lines.push('', 'ENTRETIEN')
  lines.push(`- ${maintenanceInfo.text}`)

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    text,
    stats: {
      points: telemetry.points,
      distanceKm: Number.isFinite(Number(mileageKm)) ? Number(mileageKm) : telemetry.distanceKm,
      gpsDistanceKm: telemetry.distanceKm,
      avgSpeed: telemetry.avgSpeed,
      maxSpeed: telemetry.maxSpeed,
      startTime: telemetry.startTime,
      endTime: telemetry.endTime,
      speedAlerts: breachCount,
      speedBreaches: breaches,
      speedEpisodes: episodes,
      crashAlerts: crashAlerts.length,
      maintenance: maintenanceInfo.level,
      itinerary,
      length: text.length,
    },
    sections: {
      plate,
      day,
      date: dateLabel,
      activity: {
        ...telemetry,
        gpsDistanceKm: telemetry.distanceKm,
        distanceKm: Number.isFinite(Number(mileageKm)) ? Number(mileageKm) : telemetry.distanceKm,
        mileageSource: Number.isFinite(Number(mileageKm)) ? 'fleeti' : 'gps',
      },
      itinerary,
      usualRoute,
      speedAlerts,
      speedBreaches: breaches,
      speedEpisodes: episodes,
      speedLimitKmh,
      crashAlerts,
      maintenance: maintenanceInfo,
    },
  }
}
