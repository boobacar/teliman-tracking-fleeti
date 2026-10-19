// Détection et regroupement des excès de vitesse — partagé par tous les rapports
// (rapport bus, rapport journalier des camions, rapport hebdomadaire).
// Un excès n'est pas un point isolé mais un épisode : les relevés consécutifs forment
// une seule ligne lisible, avec la pointe et l'endroit du dépassement.

export function clockOf(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getHours()}h${String(date.getMinutes()).padStart(2, '0')}`
}

// Relevés au-dessus du seuil, avec leur position (pour nommer l'endroit).
export function detectSpeedBreaches(points = [], limitKmh = 90) {
  return (Array.isArray(points) ? points : [])
    .filter((point) => Number(point?.speed) > Number(limitKmh))
    .map((point) => ({
      speed: Math.round(Number(point.speed)),
      at: point.time || point.timestamp || '',
      time: clockOf(point.time || point.timestamp),
      lat: Number(point?.lat),
      lng: Number(point?.lng),
      place: String(point?.place || point?.address || '').trim(),
    }))
    .sort((a, b) => b.speed - a.speed)
}

// Regroupe les relevés consécutifs (même trajet, moins de `gapMinutes` d'écart) en épisodes.
// L'endroit retenu est celui de la pointe de l'épisode.
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
    propres.push({ ...breach, date: date && !Number.isNaN(date.getTime()) ? date : null })
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
    from: episode.debut ? clockOf(episode.debut) : (episode.peak?.time || ''),
    to: episode.fin ? clockOf(episode.fin) : '',
    count: episode.count,
    maxSpeed: Math.round(episode.maxSpeed),
    place: episode.place || '',
    lat: episode.peak?.lat ?? null,
    lng: episode.peak?.lng ?? null,
  }))
}

// Libellé court et homogène pour tous les rapports.
export function formatSpeedEpisode(episode = {}) {
  const plage = episode.to && episode.to !== episode.from ? `de ${episode.from} à ${episode.to}` : `${episode.from || ''}`
  const detail = Number(episode.count) > 1
    ? `${episode.count} relevés, pointe ${episode.maxSpeed} km/h`
    : `pointe ${episode.maxSpeed} km/h`
  return `${plage} : ${detail}${episode.place ? ` — ${episode.place}` : ''}`
}

// La vitesse d'une alerte Fleeti n'est pas toujours dans le champ « speed » : elle est
// écrite dans le message (« … Excès de vitesse - 91 km/h »). On la lit là plutôt que de
// perdre l'information.
export function extractSpeedFromMessage(message = '') {
  const match = String(message || '').match(/(\d{2,3})\s*km\s*\/\s*h/i)
  return match ? Number(match[1]) : null
}

// Adresse lisible : on garde les deux premiers niveaux (route, localité) sans noyer
// le rapport sous une adresse complète.
export function shortenPlace(label = '', { maxParts = 2, maxChars = 60 } = {}) {
  const propre = String(label || '').trim()
  if (!propre) return ''
  const parties = propre.split(',').map((partie) => partie.trim()).filter(Boolean).slice(0, maxParts)
  const court = parties.join(', ')
  return court.length > maxChars ? `${court.slice(0, maxChars - 1).trim()}…` : court
}
