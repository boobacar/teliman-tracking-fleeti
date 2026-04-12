import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  GoogleMap,
  LoadScript,
  Marker,
  Polyline,
} from '@react-google-maps/api'
import { loadTracks, loadTracksBatch } from '../lib/fleeti'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

function getPinState(tracker) {
  const connection = tracker.state?.connection_status
  const movement = tracker.state?.movement_status

  if (connection === 'offline') return { color: '#ef4444', label: 'O', text: 'Offline' }
  if (movement === 'parked' || movement === 'parking') return { color: '#f59e0b', label: 'P', text: 'Parking' }
  if (connection === 'active' && movement === 'moving') return { color: '#22c55e', label: 'M', text: 'Moving' }
  if (connection === 'idle') return { color: '#f59e0b', label: 'I', text: 'Idle' }
  return { color: '#64748b', label: '?', text: 'Unknown' }
}

function getAlertColor(eventType) {
  if (eventType === 'speedup') return '#ef4444'
  if (eventType === 'excessive_parking') return '#f59e0b'
  if (eventType === 'fuel_level_leap') return '#38bdf8'
  return '#94a3b8'
}

function getAlertPriority(eventType) {
  if (eventType === 'speedup') return 'Critique'
  if (eventType === 'fuel_level_leap') return 'Surveillance'
  if (eventType === 'excessive_parking') return 'Exploitation'
  return 'Info'
}

function computeBearing(from, to) {
  if (!from || !to) return null
  const lat1 = (from.lat * Math.PI) / 180
  const lon1 = (from.lng * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const lon2 = (to.lng * Math.PI) / 180
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return (bearing + 360) % 360
}

function markerIcon(color, isActive = false) {
  return {
    path: window.google?.maps?.SymbolPath?.CIRCLE,
    fillColor: color,
    fillOpacity: isActive ? 1 : 0.78,
    strokeColor: '#0f172a',
    strokeWeight: isActive ? 2.5 : 1.5,
    scale: isActive ? 9 : 7,
  }
}

export function MapPage({ filteredTrackers, setSelectedTrackerId, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [period, setPeriod] = useState('48h')
  const [baseMap, setBaseMap] = useState('hybrid')
  const [trackData, setTrackData] = useState({ points: [], segments: [], events: [] })
  const [prefetchReady, setPrefetchReady] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const trackCacheRef = useRef(new Map())
  const inflightCacheRef = useRef(new Map())
  const mapShellRef = useRef(null)
  const googleMapRef = useRef(null)

  const visibleTrackers = useMemo(
    () =>
      filteredTrackers.filter((tracker) => {
        if (!tracker.state?.gps?.location) return false
        if (mapFilter === 'moving') return (tracker.state?.gps?.speed ?? 0) > 0
        if (mapFilter === 'offline') return tracker.state?.connection_status === 'offline'
        if (mapFilter === 'risk') return tracker.riskScore > 10
        return true
      }),
    [filteredTrackers, mapFilter],
  )

  const activeTracker =
    visibleTrackers.find((tracker) => String(tracker.id) === String(selectedTrackId || visibleTrackers[0]?.id || '')) ||
    visibleTrackers[0]

  const center = activeTracker
    ? { lat: activeTracker.state.gps.location.lat, lng: activeTracker.state.gps.location.lng }
    : { lat: 7.54, lng: -5.55 }

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === mapShellRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!googleMapRef.current || !activeTracker?.state?.gps?.location) return
    googleMapRef.current.panTo({
      lat: activeTracker.state.gps.location.lat,
      lng: activeTracker.state.gps.location.lng,
    })
  }, [activeTracker?.id, activeTracker?.state?.gps?.location?.lat, activeTracker?.state?.gps?.location?.lng])

  async function toggleFullscreen() {
    if (!mapShellRef.current) return
    if (document.fullscreenElement === mapShellRef.current) {
      await document.exitFullscreen().catch(() => {})
      return
    }
    await mapShellRef.current.requestFullscreen?.().catch(() => {})
  }

  function getWindow(periodValue) {
    const now = new Date()
    const fromDate = new Date(now)
    if (periodValue === '1h') fromDate.setHours(now.getHours() - 1)
    if (periodValue === '6h') fromDate.setHours(now.getHours() - 6)
    if (periodValue === '24h') fromDate.setHours(now.getHours() - 24)
    if (periodValue === 'today') fromDate.setHours(0, 0, 0, 0)
    if (periodValue === '48h') fromDate.setHours(now.getHours() - 48)
    return {
      from: fromDate.toISOString().slice(0, 19).replace('T', ' '),
      to: now.toISOString().slice(0, 19).replace('T', ' '),
    }
  }

  function fetchTrack(trackerId, periodValue) {
    const cacheKey = `${trackerId}_${periodValue}`
    if (trackCacheRef.current.has(cacheKey)) return Promise.resolve(trackCacheRef.current.get(cacheKey))
    if (inflightCacheRef.current.has(cacheKey)) return inflightCacheRef.current.get(cacheKey)

    const { from, to } = getWindow(periodValue)
    const request = loadTracks({ trackerId, from, to })
      .then((data) => {
        trackCacheRef.current.set(cacheKey, data)
        inflightCacheRef.current.delete(cacheKey)
        return data
      })
      .catch((error) => {
        inflightCacheRef.current.delete(cacheKey)
        throw error
      })

    inflightCacheRef.current.set(cacheKey, request)
    return request
  }

  useEffect(() => {
    const trackerId = activeTracker?.id
    if (!trackerId) {
      setTrackData({ points: [], segments: [], events: [] })
      return
    }

    const cacheKey = `${trackerId}_${period}`
    if (trackCacheRef.current.has(cacheKey)) {
      setTrackData(trackCacheRef.current.get(cacheKey))
      return
    }

    fetchTrack(trackerId, period)
      .then(setTrackData)
      .catch(() => setTrackData({ points: [], segments: [], events: [] }))
  }, [activeTracker?.id, period])

  useEffect(() => {
    let cancelled = false

    async function warmup() {
      const primaryTrackers = visibleTrackers.slice(0, 6)
      if (!primaryTrackers.length) {
        setPrefetchReady(true)
        return
      }

      const activeTrackerId = activeTracker?.id || primaryTrackers[0]?.id
      try {
        await fetchTrack(activeTrackerId, period)
        if (!cancelled) {
          setPrefetchReady(true)
          setTrackData(trackCacheRef.current.get(`${activeTrackerId}_${period}`) || { points: [], segments: [], events: [] })
        }
      } catch {
        if (!cancelled) setPrefetchReady(true)
      }

      const secondaryTrackers = primaryTrackers.filter((tracker) => tracker.id !== activeTrackerId)
      if (secondaryTrackers.length) {
        loadTracksBatch({ trackerIds: secondaryTrackers.map((tracker) => tracker.id), period })
          .then((payload) => {
            ;(payload.items || []).forEach((item) => {
              trackCacheRef.current.set(`${item.trackerId}_${period}`, item)
            })
          })
          .catch(() => {
            secondaryTrackers.forEach((tracker) => {
              fetchTrack(tracker.id, period).catch(() => {})
            })
          })
      }
    }

    setPrefetchReady(false)
    warmup()
    return () => {
      cancelled = true
    }
  }, [visibleTrackers, activeTracker?.id, period])

  const polylinePath = trackData.points.map((point) => ({ lat: point.lat, lng: point.lng }))

  const bearingByTrackerId = new Map()
  visibleTrackers.forEach((tracker) => {
    const trackerPoints = String(activeTracker?.id || '') === String(tracker.id) ? trackData.points || [] : []
    if (trackerPoints.length >= 2) {
      const previous = trackerPoints[trackerPoints.length - 2]
      const current = trackerPoints[trackerPoints.length - 1]
      const bearing = computeBearing({ lat: previous.lat, lng: previous.lng }, { lat: current.lat, lng: current.lng })
      bearingByTrackerId.set(String(tracker.id), bearing)
      return
    }
    const gps = tracker.state?.gps
    const history = gps?.last_positions || gps?.positions || []
    if (history.length >= 2) {
      const previous = history[history.length - 2]
      const current = history[history.length - 1]
      const bearing = computeBearing({ lat: previous.lat, lng: previous.lng }, { lat: current.lat, lng: current.lng })
      bearingByTrackerId.set(String(tracker.id), bearing)
    }
  })

  const activeSummary = trackData.segments || []
  const totalDistanceKm = activeSummary.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0)
  const maxSpeed = activeSummary.reduce((max, segment) => Math.max(max, Number(segment.max_speed) || 0), 0)
  const avgSpeed = activeSummary.length
    ? Math.round(activeSummary.reduce((sum, segment) => sum + (Number(segment.avg_speed) || 0), 0) / activeSummary.length)
    : 0
  const tripCount = activeSummary.length

  const alertMarkers = (trackData.events || [])
    .map((event) => ({
      ...event,
      lat: event.lat ?? event.location?.lat ?? null,
      lng: event.lng ?? event.location?.lng ?? null,
    }))
    .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))

  const dominantAlert = alertMarkers[0]?.event || 'Aucune'
  const criticalAlerts = alertMarkers.filter((event) => getAlertPriority(event.event) === 'Critique').length

  const mapTypeId = baseMap === 'plan' ? 'roadmap' : baseMap === 'satellite' ? 'satellite' : 'hybrid'

  return (
    <section className="panel panel-large map-panel">
      <div className="panel-header"><div><h3>Live Map</h3></div></div>

      <div className="map-kpi-row">
        <div className="mini-kpi"><span>Visible</span><strong>{visibleTrackers.length}</strong></div>
        <div className="mini-kpi"><span>Moving</span><strong>{visibleTrackers.filter((tracker) => (tracker.state?.gps?.speed ?? 0) > 0).length}</strong></div>
        <div className="mini-kpi"><span>Alertes tracé</span><strong>{alertMarkers.length}</strong></div>
        <div className="mini-kpi"><span>Distance tracée</span><strong>{totalDistanceKm.toFixed(1)} km</strong></div>
        <div className="mini-kpi"><span>Vitesse max</span><strong>{Math.round(maxSpeed)} km/h</strong></div>
        <div className="mini-kpi"><span>Vitesse moy.</span><strong>{avgSpeed} km/h</strong></div>
      </div>

      {activeTracker && (
        <div className="map-focus-banner">
          <div><strong>{activeTracker.label}</strong><span>{activeTracker.employeeName || 'Conducteur non assigné'}</span></div>
          <div><strong>{Math.max(totalDistanceKm / 45, 0).toFixed(1)} h</strong><span>Heures de conduite</span></div>
          <div><strong>{criticalAlerts}</strong><span>alertes critiques</span></div>
        </div>
      )}

      <div className="map-v3-summary">
        <div className="map-v3-card"><strong>{tripCount}</strong><span>déplacements détectés</span></div>
        <div className="map-v3-card"><strong>{dominantAlert}</strong><span>alerte dominante</span></div>
        <div className="map-v3-card"><strong>{activeTracker?.state?.gps?.speed ?? 0} km/h</strong><span>vitesse instantanée</span></div>
      </div>

      {!prefetchReady && <div className="empty-banner">Préchargement rapide des tracés en cours…</div>}
      {prefetchReady && alertMarkers.length === 0 && <div className="empty-banner">Aucune alerte géolocalisée sur la période sélectionnée.</div>}
      {!GOOGLE_MAPS_API_KEY && <div className="empty-banner">Clé Google Maps manquante : définis VITE_GOOGLE_MAPS_API_KEY</div>}

      <div className="map-filter-stack">
        <div className="filters filter-row">
          <button className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button>
          <button className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button>
          <button className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button>
          <button className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>À risque</button>
        </div>
        <div className="filters filter-row">
          {visibleTrackers.slice(0, 8).map((tracker) => (
            <button key={tracker.id} className={`chip ${String(activeTracker?.id || '') === String(tracker.id) ? 'selected' : ''}`} onClick={() => setSelectedTrackId(String(tracker.id))}>{tracker.label}</button>
          ))}
        </div>
        <div className="filters filter-row">
          {[{ value: '1h', label: 'Dernière heure' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }, { value: 'today', label: "Aujourd'hui" }, { value: '48h', label: '48h' }].map((item) => (
            <button key={item.value} className={`chip ${period === item.value ? 'selected' : ''}`} onClick={() => setPeriod(item.value)}>{item.label}</button>
          ))}
        </div>
      </div>

      <div className="map-legend-row">
        <span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span>
        <span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span>
        <span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span>
        <span><i className="legend-line"></i> Tracé trajet</span>
        <span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Critique</span>
        <span><i className="legend-dot" style={{ background: '#38bdf8' }}></i> Surveillance</span>
      </div>

      <div ref={mapShellRef} className={`leaflet-wrap large-map map-shell ${isFullscreen ? 'map-shell-fullscreen' : ''}`}>
        <div className="map-overlay-controls">
          <div className="map-overlay-group">
            <div className="map-overlay-buttons">
              <button className={`chip ${baseMap === 'plan' ? 'selected' : ''}`} onClick={() => setBaseMap('plan')}>Plan</button>
              <button className={`chip ${baseMap === 'satellite' ? 'selected' : ''}`} onClick={() => setBaseMap('satellite')}>Satellite</button>
              <button className={`chip ${baseMap === 'hybrid' ? 'selected' : ''}`} onClick={() => setBaseMap('hybrid')}>Hybride</button>
            </div>
          </div>
          <button className="ghost-btn small-btn map-fullscreen-btn" onClick={toggleFullscreen}>{isFullscreen ? 'Quitter plein écran' : 'Plein écran'}</button>
        </div>

        {GOOGLE_MAPS_API_KEY && (
          <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY}>
            <GoogleMap
              center={center}
              zoom={9}
              mapContainerClassName="leaflet-map"
              mapTypeId={mapTypeId}
              onLoad={(map) => {
                googleMapRef.current = map
                setMapReady(true)
              }}
              options={{
                fullscreenControl: false,
                streetViewControl: false,
                mapTypeControl: false,
                gestureHandling: 'greedy',
              }}
            >
              {mapReady && polylinePath.length > 1 && (
                <Polyline path={polylinePath} options={{ strokeColor: '#22d3ee', strokeWeight: 5, strokeOpacity: 0.95 }} />
              )}

              {mapReady &&
                alertMarkers.map((event, index) => (
                  <Circle
                    key={`${event.time}-${index}`}
                    center={{ lat: event.lat, lng: event.lng }}
                    radius={getAlertPriority(event.event) === 'Critique' ? 120 : 90}
                    options={{
                      fillColor: getAlertColor(event.event),
                      fillOpacity: 0.85,
                      strokeColor: getAlertColor(event.event),
                      strokeOpacity: 0.95,
                      strokeWeight: getAlertPriority(event.event) === 'Critique' ? 2 : 1,
                    }}
                  />
                ))}

              {mapReady &&
                visibleTrackers.map((tracker) => {
                  const state = getPinState(tracker)
                  const isActive = String(activeTracker?.id || '') === String(tracker.id)
                  const activeOrder = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active)
                  const computedBearing = bearingByTrackerId.get(String(tracker.id))

                  return (
                    <Marker
                      key={tracker.id}
                      position={{ lat: tracker.state.gps.location.lat, lng: tracker.state.gps.location.lng }}
                      icon={markerIcon(state.color, isActive)}
                      title={`${tracker.label} • ${state.text} • ${tracker.state?.gps?.speed ?? 0} km/h${activeOrder ? ` • BL ${activeOrder.reference}` : ''}${computedBearing != null ? ` • ${Math.round(computedBearing)}°` : ''}`}
                      onClick={() => {
                        setSelectedTrackId(String(tracker.id))
                        setSelectedTrackerId?.(String(tracker.id))
                      }}
                    />
                  )
                })}
            </GoogleMap>
          </LoadScript>
        )}
      </div>
    </section>
  )
}
