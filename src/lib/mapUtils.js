// Utilitaires purs de la Live Map (poste de contrôle) — testables sans navigateur.

export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180
  const radius = 6371000
  const dLat = toRad(lat2) - toRad(lat1)
  const dLng = toRad(lng2) - toRad(lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(a))
}

export function formatPositionAge(timestamp, now = Date.now()) {
  if (!timestamp) return 'inconnu'
  const time = Number(timestamp)
  if (!Number.isFinite(time) || time <= 0) return 'inconnu'
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  if (seconds < 10) return 'à l’instant'
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}

export function parsePointTime(point) {
  if (!point) return null
  const raw = point.time ?? point.timestamp ?? point.date ?? null
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (Number.isFinite(value)) {
    // Epoch secondes (10 chiffres) ou millisecondes (13 chiffres)
    const ms = value < 1e12 ? value * 1000 : value
    return Number.isFinite(ms) ? ms : null
  }
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

// Détecte les temps d'arrêt : suite de points immobiles (vitesse <= 1 km/h ou
// déplacement < 30 m) pendant au moins minDurationMs.
export function detectStops(points, minDurationMs = 5 * 60 * 1000, maxGapMs = 3 * 60 * 1000) {
  const stops = []
  if (!Array.isArray(points) || points.length < 2) return stops

  let runStart = null
  let runPoints = []

  const closeRun = (endIndex) => {
    if (runStart === null) return
    const firstTime = parsePointTime(points[runStart])
    const lastTime = parsePointTime(points[endIndex])
    let durationMs = null
    if (firstTime && lastTime) durationMs = lastTime - firstTime
    const anchor = points[Math.floor((runStart + endIndex) / 2)]
    if (durationMs === null || durationMs >= minDurationMs) {
      stops.push({
        startIndex: runStart,
        endIndex,
        durationMs,
        lat: anchor.lat,
        lng: anchor.lng,
      })
    }
    runStart = null
    runPoints = []
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const speed = Number(current.speed) || 0
    const distance = haversineDistanceMeters(previous.lat, previous.lng, current.lat, current.lng)
    const time = parsePointTime(current)
    const prevTime = parsePointTime(previous)
    const gapMs = time && prevTime ? time - prevTime : null

    const immobile = speed <= 1 || distance < 30
    const continuous = gapMs === null || gapMs <= maxGapMs

    if (immobile && continuous) {
      if (runStart === null) runStart = index - 1
    } else if (runStart !== null) {
      closeRun(index - 1)
    }
  }
  if (runStart !== null) closeRun(points.length - 1)
  return stops
}

// Regroupement en grille pour les flottes nombreuses (clustering léger sans
// dépendance). Ne s'active qu'au-delà du seuil.
export function clusterTrackers(trackers, zoom, threshold = 25) {
  const items = (trackers || []).filter((tracker) => {
    const location = tracker?.state?.gps?.location
    return Number.isFinite(location?.lat) && Number.isFinite(location?.lng)
  })
  if (items.length < threshold) return { clusters: [], singles: items }

  const cellDegrees = zoom < 8 ? 0.6 : zoom < 10 ? 0.3 : 0.12
  const grid = new Map()
  for (const tracker of items) {
    const lat = tracker.state.gps.location.lat
    const lng = tracker.state.gps.location.lng
    const key = `${Math.round(lat / cellDegrees)}:${Math.round(lng / cellDegrees)}`
    if (!grid.has(key)) {
      grid.set(key, { lat: 0, lng: 0, trackers: [] })
    }
    const cell = grid.get(key)
    cell.lat += lat
    cell.lng += lng
    cell.trackers.push(tracker)
  }

  const clusters = []
  const singles = []
  for (const cell of grid.values()) {
    if (cell.trackers.length === 1) {
      singles.push(cell.trackers[0])
    } else {
      clusters.push({
        lat: cell.lat / cell.trackers.length,
        lng: cell.lng / cell.trackers.length,
        count: cell.trackers.length,
        trackers: cell.trackers,
      })
    }
  }
  return { clusters, singles }
}

// Flèches de direction le long d'un tracé (sens de circulation).
export function buildDirectionArrows(points, maxArrows = 24) {
  if (!Array.isArray(points) || points.length < 2) return []
  const step = Math.max(1, Math.ceil(points.length / maxArrows))
  const arrows = []
  for (let index = step; index < points.length; index += step) {
    const from = points[index - 1]
    const to = points[index]
    const dLat = (to.lat - from.lat) * Math.PI / 180
    const dLng = (to.lng - from.lng) * Math.PI / 180
    const y = Math.sin(dLng) * Math.cos((to.lat * Math.PI) / 180)
    const x = Math.cos((from.lat * Math.PI) / 180) * Math.sin((to.lat * Math.PI) / 180)
      - Math.sin((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.cos(dLng)
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
    arrows.push({ lat: to.lat, lng: to.lng, bearing })
  }
  return arrows
}

export function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '—'
  const minutes = Math.round(durationMs / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

// Zone géofence active la plus proche d'une position.
// La distance est le critère PRINCIPAL ; le type 'client' ne départage que les égalités.
export function nearestZone(position, zones) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null
  const active = (zones || []).filter((zone) => zone.active && Number.isFinite(Number(zone.lat)) && Number.isFinite(Number(zone.lng)))
  if (active.length === 0) return null
  const withDistance = active.map((zone) => ({
    ...zone,
    distanceMeters: haversineDistanceMeters(position.lat, position.lng, Number(zone.lat), Number(zone.lng)),
  }))
  withDistance.sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters
    // égalité : une zone client passe devant
    return (b.type === 'client') - (a.type === 'client')
  })
  return withDistance[0]
}
