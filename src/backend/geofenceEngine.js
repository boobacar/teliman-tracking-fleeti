// Moteur de détection entrée / sortie de géofence — pur et testable.
// server.js fournit les données (géofences actives) et le callback onEvent
// (persistance + notifications WhatsApp).

export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180
  const dLat = toRad(Number(lat2) - Number(lat1))
  const dLng = toRad(Number(lng2) - Number(lng1))
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

export function createGeofenceTracker({ minIntervalMs = 60 * 1000, now = () => Date.now() } = {}) {
  const presence = new Map() // `${trackerId}:${geofenceId}` -> boolean
  const lastEventAt = new Map() // `${trackerId}:${geofenceId}` -> timestamp

  return function evaluateGeofenceTransitions(positions, { activeGeofences = [], onEvent = null } = {}) {
    if (!Array.isArray(positions) || positions.length === 0) return positions
    if (!Array.isArray(activeGeofences) || activeGeofences.length === 0) return positions

    const timestamp = now()
    for (const position of positions) {
      const trackerId = Number(position.trackerId)
      if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng) || !Number.isFinite(trackerId)) continue

      const insideZones = []
      for (const zone of activeGeofences) {
        const key = `${trackerId}:${zone.id}`
        const distance = haversineDistanceMeters(position.lat, position.lng, zone.lat, zone.lng)
        const inside = distance <= Number(zone.radiusMeters)
        const wasInside = presence.get(key)

        if (inside) insideZones.push({ id: zone.id, name: zone.name })

        if (wasInside === undefined) {
          // Premier contact : prise d'état sans alerte (évite le bruit au démarrage)
          presence.set(key, inside)
          continue
        }
        if (inside === wasInside) continue
        if (timestamp - (lastEventAt.get(key) || 0) < minIntervalMs) continue

        presence.set(key, inside)
        lastEventAt.set(key, timestamp)
        const event = {
          geofenceId: zone.id,
          geofenceName: zone.name,
          trackerId,
          truckLabel: position.label || `Tracker ${trackerId}`,
          eventType: inside ? 'enter' : 'exit',
          lat: position.lat,
          lng: position.lng,
          createdAt: new Date(timestamp).toISOString(),
        }
        if (typeof onEvent === 'function') {
          try { onEvent(event) } catch (error) { /* laissé au serveur de journaliser */ }
        }
      }
      if (insideZones.length) {
        position.geofenceIds = insideZones.map((zone) => zone.id)
        position.geofenceNames = insideZones.map((zone) => zone.name)
      }
    }
    return positions
  }
}
