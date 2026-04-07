import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, useMap } from 'react-leaflet'
import { loadTracks, loadTracksBatch } from '../lib/fleeti'

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
  const lat1 = from.lat * Math.PI / 180
  const lon1 = from.lng * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const lon2 = to.lng * Math.PI / 180
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  const bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

function createTrackerIcon(tracker, hasMission = false, isActive = false, bearing = null) {
  const state = getPinState(tracker)
  const heading = Number.isFinite(bearing) ? bearing : Number(tracker.state?.gps?.heading ?? tracker.state?.heading ?? 0)
  const speed = Number(tracker.state?.gps?.speed ?? 0)
  const isMoving = tracker.state?.movement_status === 'moving' || speed > 0
  const movingArrow = isMoving
    ? `<div class="pin-heading-tail ${isActive ? 'active' : ''}" style="transform: rotate(${heading}deg)"></div>`
    : ''

  return L.divIcon({
    className: 'custom-tracker-pin-wrapper',
    html: `<div class="custom-tracker-pin-shell ${isActive ? 'active' : ''}">${movingArrow}<div class="custom-tracker-pin" style="background:${state.color}">${state.label}</div>${hasMission ? '<span class="mission-dot"></span>' : ''}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -12],
  })
}

function SelectedTrackerFocus({ tracker }) {
  const map = useMap()

  useEffect(() => {
    const lat = tracker?.state?.gps?.location?.lat
    const lng = tracker?.state?.gps?.location?.lng
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    map.flyTo([lat, lng], Math.max(map.getZoom(), 11), { duration: 0.6 })
  }, [map, tracker?.id, tracker?.state?.gps?.location?.lat, tracker?.state?.gps?.location?.lng])

  return null
}

export function MapPage({ filteredTrackers, setSelectedTrackerId, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [period, setPeriod] = useState('48h')
  const [baseMap, setBaseMap] = useState('hybrid')
  const [trackData, setTrackData] = useState({ points: [], segments: [], events: [] })
  const [prefetchReady, setPrefetchReady] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const trackCacheRef = useRef(new Map())
  const inflightCacheRef = useRef(new Map())
  const mapShellRef = useRef(null)

  const visibleTrackers = useMemo(() => filteredTrackers.filter((tracker) => {
    if (!tracker.state?.gps?.location) return false
    if (mapFilter === 'moving') return (tracker.state?.gps?.speed ?? 0) > 0
    if (mapFilter === 'offline') return tracker.state?.connection_status === 'offline'
    if (mapFilter === 'risk') return tracker.riskScore > 10
    return true
  }), [filteredTrackers, mapFilter])

  const activeTracker = visibleTrackers.find((tracker) => String(tracker.id) === String(selectedTrackId || visibleTrackers[0]?.id || '')) || visibleTrackers[0]

  const center = activeTracker
    ? [activeTracker.state.gps.location.lat, activeTracker.state.gps.location.lng]
    : [7.54, -5.55]

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === mapShellRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

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
    if (trackCacheRef.current.has(cacheKey)) {
      return Promise.resolve(trackCacheRef.current.get(cacheKey))
    }
    if (inflightCacheRef.current.has(cacheKey)) {
      return inflightCacheRef.current.get(cacheKey)
    }
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

  const polylinePositions = trackData.points.map((point) => [point.lat, point.lng])
  const bearingByTrackerId = new Map()
  visibleTrackers.forEach((tracker) => {
    const trackerPoints = String(activeTracker?.id || '') === String(tracker.id) ? (trackData.points || []) : []
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
  const avgSpeed = activeSummary.length ? Math.round(activeSummary.reduce((sum, segment) => sum + (Number(segment.avg_speed) || 0), 0) / activeSummary.length) : 0
  const tripCount = activeSummary.length
  const alertMarkers = (trackData.events || []).map((event) => ({
    ...event,
    lat: event.lat ?? event.location?.lat ?? null,
    lng: event.lng ?? event.location?.lng ?? null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))
  const dominantAlert = alertMarkers[0]?.event || 'Aucune'
  const criticalAlerts = alertMarkers.filter((event) => getAlertPriority(event.event) === 'Critique').length
  const timelineBuckets = Array.from({ length: 4 }, (_, index) => {
    const size = activeSummary.length / 4
    const start = Math.floor(index * size)
    const end = Math.floor((index + 1) * size)
    const bucket = activeSummary.slice(start, Math.max(end, start + 1))
    const distance = bucket.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0)
    const bucketMax = bucket.reduce((max, segment) => Math.max(max, Number(segment.max_speed) || 0), 0)
    const first = bucket[0]
    const last = bucket[bucket.length - 1]
    return {
      label: `${index + 1}/4`,
      start: first?.start_date?.slice(11, 16) || '--:--',
      end: last?.end_date?.slice(11, 16) || '--:--',
      distance,
      maxSpeed: bucketMax,
      count: bucket.length,
    }
  })

  return <section className="panel panel-large map-panel"><div className="panel-header"><div><h3>Live Map</h3></div></div><div className="map-kpi-row"><div className="mini-kpi"><span>Visible</span><strong>{visibleTrackers.length}</strong></div><div className="mini-kpi"><span>Moving</span><strong>{visibleTrackers.filter((tracker) => (tracker.state?.gps?.speed ?? 0) > 0).length}</strong></div><div className="mini-kpi"><span>Alertes tracé</span><strong>{alertMarkers.length}</strong></div><div className="mini-kpi"><span>Distance tracée</span><strong>{totalDistanceKm.toFixed(1)} km</strong></div><div className="mini-kpi"><span>Vitesse max</span><strong>{Math.round(maxSpeed)} km/h</strong></div><div className="mini-kpi"><span>Vitesse moy.</span><strong>{avgSpeed} km/h</strong></div></div>{activeTracker && <div className="map-focus-banner"><div><strong>{activeTracker.label}</strong><span>{activeTracker.employeeName || 'Conducteur non assigné'}</span></div><div><strong>{polylinePositions.length}</strong><span>points GPS du trajet</span></div><div><strong>{criticalAlerts}</strong><span>alertes critiques</span></div></div>}<div className="map-v3-summary"><div className="map-v3-card"><strong>{tripCount}</strong><span>déplacements détectés</span></div><div className="map-v3-card"><strong>{dominantAlert}</strong><span>alerte dominante</span></div><div className="map-v3-card"><strong>{activeTracker?.state?.gps?.speed ?? 0} km/h</strong><span>vitesse instantanée</span></div></div>{timelineBuckets.some((bucket) => bucket.count > 0) && <div className="map-v3-timeline">{timelineBuckets.map((bucket) => <div key={bucket.label} className="map-v3-timeline-item"><strong>{bucket.label} • {bucket.start} → {bucket.end}</strong><span>{bucket.distance.toFixed(1)} km • max {Math.round(bucket.maxSpeed)} km/h • {bucket.count} dép.</span></div>)}</div>}{!prefetchReady && <div className="empty-banner">Préchargement rapide des tracés en cours…</div>}{prefetchReady && alertMarkers.length === 0 && <div className="empty-banner">Aucune alerte géolocalisée sur la période sélectionnée.</div>}<div className="map-filter-stack"><div className="filters filter-row"><button className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button><button className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button><button className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button><button className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>À risque</button></div><div className="filters filter-row">{visibleTrackers.slice(0, 8).map((tracker) => <button key={tracker.id} className={`chip ${String(activeTracker?.id || '') === String(tracker.id) ? 'selected' : ''}`} onClick={() => setSelectedTrackId(String(tracker.id))}>{tracker.label}</button>)}</div><div className="filters filter-row">{[{ value: '1h', label: 'Dernière heure' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }, { value: 'today', label: "Aujourd'hui" }, { value: '48h', label: '48h' }].map((item) => <button key={item.value} className={`chip ${period === item.value ? 'selected' : ''}`} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div></div><div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span><span><i className="legend-dot mission-legend-dot"></i> Mission active</span><span><i className="legend-line"></i> Tracé trajet</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Critique</span><span><i className="legend-dot" style={{ background: '#38bdf8' }}></i> Surveillance</span></div><div ref={mapShellRef} className={`leaflet-wrap large-map map-shell ${isFullscreen ? 'map-shell-fullscreen' : ''}`}><div className="map-overlay-controls"><div className="map-overlay-group"><div className="map-overlay-buttons"><button className={`chip ${baseMap === 'plan' ? 'selected' : ''}`} onClick={() => setBaseMap('plan')}>Plan</button><button className={`chip ${baseMap === 'satellite' ? 'selected' : ''}`} onClick={() => setBaseMap('satellite')}>Satellite</button><button className={`chip ${baseMap === 'hybrid' ? 'selected' : ''}`} onClick={() => setBaseMap('hybrid')}>Hybride</button></div></div><button className="ghost-btn small-btn map-fullscreen-btn" onClick={toggleFullscreen}>{isFullscreen ? 'Quitter plein écran' : 'Plein écran'}</button></div><MapContainer center={center} zoom={9} scrollWheelZoom className="leaflet-map"><SelectedTrackerFocus tracker={activeTracker} />{baseMap === 'plan' && <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}{baseMap === 'satellite' && <TileLayer attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />}{baseMap === 'hybrid' && <><TileLayer attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /><TileLayer attribution='&copy; Esri' url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}" opacity={0.95} /><TileLayer attribution='&copy; Esri' url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" opacity={1} /></>}{polylinePositions.length > 1 && <Polyline positions={polylinePositions} pathOptions={{ color: '#22d3ee', weight: 5, opacity: 0.95 }} />}{alertMarkers.map((event, index) => <CircleMarker key={`${event.time}-${index}`} center={[event.lat, event.lng]} radius={getAlertPriority(event.event) === 'Critique' ? 9 : 7} pathOptions={{ color: getAlertColor(event.event), fillColor: getAlertColor(event.event), fillOpacity: 0.95, weight: getAlertPriority(event.event) === 'Critique' ? 3 : 2 }}><Popup><strong>{event.event}</strong><br />Priorité: {getAlertPriority(event.event)}<br />{event.message}<br />{event.time ? new Date(event.time).toLocaleString() : '-'}</Popup></CircleMarker>)}{visibleTrackers.map((tracker) => { const state = getPinState(tracker); const isActive = String(activeTracker?.id || '') === String(tracker.id); const activeOrder = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active); const computedBearing = bearingByTrackerId.get(String(tracker.id)); return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker, !!activeOrder, isActive, computedBearing)} opacity={isActive ? 1 : 0.72} eventHandlers={{ click: () => setSelectedTrackId(String(tracker.id)) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h<br />Direction: {Math.round(computedBearing ?? tracker.state.gps.heading ?? 0)}°<br />Risque: {tracker.riskScore}<br />{activeOrder ? <><br /><strong>BL:</strong> {activeOrder.reference}<br /><strong>Client:</strong> {activeOrder.client}<br /><strong>Destination:</strong> {activeOrder.destination}<br /><strong>Marchandise:</strong> {activeOrder.goods || '-'}<br /><strong>Quantité:</strong> {activeOrder.quantity || '-'}<br /><strong>Statut:</strong> {activeOrder.status}<br /><strong>Fiche mission:</strong> /delivery-order/{activeOrder.id}</> : <><br />Aucun bon actif</>}</Popup></Marker>})}</MapContainer></div></section>
}
