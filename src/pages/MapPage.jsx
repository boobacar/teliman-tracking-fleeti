import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, useMap } from 'react-leaflet'
import { loadTracksBatch } from '../lib/fleeti'

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

function FleetBounds({ trackers }) {
  const map = useMap()

  useEffect(() => {
    const boundsPoints = trackers
      .map((tracker) => tracker?.state?.gps?.location)
      .filter((location) => Number.isFinite(location?.lat) && Number.isFinite(location?.lng))
      .map((location) => [location.lat, location.lng])

    if (boundsPoints.length === 0) return
    if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 8)
      return
    }
    map.fitBounds(boundsPoints, { padding: [50, 50] })
  }, [map, trackers])

  return null
}

export function MapPage({ filteredTrackers, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')
  const [selectedTrackIds, setSelectedTrackIds] = useState([])
  const [period, setPeriod] = useState('48h')
  const [baseMap, setBaseMap] = useState('hybrid')
  const [trackMap, setTrackMap] = useState({})
  const [prefetchReady, setPrefetchReady] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const trackCacheRef = useRef(new Map())
  const inflightCacheRef = useRef(new Map())
  const mapShellRef = useRef(null)

  const allVisibleTrackers = useMemo(() => filteredTrackers.filter((tracker) => {
    if (!tracker.state?.gps?.location) return false
    if (mapFilter === 'moving') return (tracker.state?.gps?.speed ?? 0) > 0
    if (mapFilter === 'offline') return tracker.state?.connection_status === 'offline'
    if (mapFilter === 'risk') return tracker.riskScore > 10
    return true
  }), [filteredTrackers, mapFilter])

  useEffect(() => {
    setSelectedTrackIds((prev) => prev.filter((id) => allVisibleTrackers.some((tracker) => String(tracker.id) === id)))
  }, [allVisibleTrackers])

  const selectedTrackers = useMemo(
    () => allVisibleTrackers.filter((tracker) => selectedTrackIds.includes(String(tracker.id))),
    [allVisibleTrackers, selectedTrackIds],
  )

  const displayedTrackers = selectedTrackIds.length > 0 ? selectedTrackers : allVisibleTrackers

  const center = displayedTrackers[0]?.state?.gps?.location
    ? [displayedTrackers[0].state.gps.location.lat, displayedTrackers[0].state.gps.location.lng]
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

  function fetchTracksForSelection(trackerIds, periodValue) {
    const key = `${trackerIds.sort().join(',')}_${periodValue}`
    if (trackCacheRef.current.has(key)) return Promise.resolve(trackCacheRef.current.get(key))
    if (inflightCacheRef.current.has(key)) return inflightCacheRef.current.get(key)
    const request = loadTracksBatch({ trackerIds, period: periodValue })
      .then((payload) => {
        const next = Object.fromEntries((payload.items || []).map((item) => [String(item.trackerId), item]))
        trackCacheRef.current.set(key, next)
        inflightCacheRef.current.delete(key)
        return next
      })
      .catch((error) => {
        inflightCacheRef.current.delete(key)
        throw error
      })
    inflightCacheRef.current.set(key, request)
    return request
  }

  useEffect(() => {
    let cancelled = false

    async function warmup() {
      if (selectedTrackIds.length === 0) {
        setTrackMap({})
        setPrefetchReady(true)
        return
      }
      try {
        const data = await fetchTracksForSelection([...selectedTrackIds], period)
        if (!cancelled) {
          setTrackMap(data)
          setPrefetchReady(true)
        }
      } catch {
        if (!cancelled) {
          setTrackMap({})
          setPrefetchReady(true)
        }
      }
    }

    setPrefetchReady(false)
    warmup()
    return () => { cancelled = true }
  }, [selectedTrackIds, period])

  function toggleTrackerSelection(trackerId) {
    const key = String(trackerId)
    setSelectedTrackIds((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key])
  }

  const selectedTrackData = selectedTrackIds.length > 0 ? selectedTrackIds.map((id) => trackMap[id]).filter(Boolean) : []
  const allSegments = selectedTrackData.flatMap((item) => item?.segments || [])
  const allEvents = selectedTrackData.flatMap((item) => item?.events || [])
  const totalDistanceKm = allSegments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0)
  const maxSpeed = allSegments.reduce((max, segment) => Math.max(max, Number(segment.max_speed) || 0), 0)
  const avgSpeed = allSegments.length ? Math.round(allSegments.reduce((sum, segment) => sum + (Number(segment.avg_speed) || 0), 0) / allSegments.length) : 0
  const tripCount = allSegments.length
  const alertMarkers = allEvents.map((event) => ({
    ...event,
    lat: event.lat ?? event.location?.lat ?? null,
    lng: event.lng ?? event.location?.lng ?? null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))
  const dominantAlert = alertMarkers[0]?.event || 'Aucune'
  const criticalAlerts = alertMarkers.filter((event) => getAlertPriority(event.event) === 'Critique').length

  const bearingByTrackerId = new Map()
  displayedTrackers.forEach((tracker) => {
    const trackerPoints = trackMap[String(tracker.id)]?.points || []
    if (trackerPoints.length >= 2) {
      const previous = trackerPoints[trackerPoints.length - 2]
      const current = trackerPoints[trackerPoints.length - 1]
      const bearing = computeBearing({ lat: previous.lat, lng: previous.lng }, { lat: current.lat, lng: current.lng })
      bearingByTrackerId.set(String(tracker.id), bearing)
    }
  })

  return (
    <section className="panel panel-large map-panel">
      <div className="panel-header"><div><h3>Live Map</h3></div></div>
      <div className="map-kpi-row">
        <div className="mini-kpi"><span>Visible</span><strong>{displayedTrackers.length}</strong></div>
        <div className="mini-kpi"><span>Sélectionnés</span><strong>{selectedTrackIds.length}</strong></div>
        <div className="mini-kpi"><span>Alertes tracé</span><strong>{alertMarkers.length}</strong></div>
        <div className="mini-kpi"><span>Distance tracée</span><strong>{totalDistanceKm.toFixed(1)} km</strong></div>
        <div className="mini-kpi"><span>Vitesse max</span><strong>{Math.round(maxSpeed)} km/h</strong></div>
        <div className="mini-kpi"><span>Vitesse moy.</span><strong>{avgSpeed} km/h</strong></div>
      </div>

      {selectedTrackIds.length > 0 && <div className="map-focus-banner"><div><strong>{selectedTrackIds.length} camion(s)</strong><span>suivi multi-sélection</span></div><div><strong>{Math.max((totalDistanceKm / 45), 0).toFixed(1)} h</strong><span>Heures de conduite</span></div><div><strong>{criticalAlerts}</strong><span>alertes critiques</span></div></div>}

      <div className="map-v3-summary"><div className="map-v3-card"><strong>{tripCount}</strong><span>déplacements détectés</span></div><div className="map-v3-card"><strong>{dominantAlert}</strong><span>alerte dominante</span></div><div className="map-v3-card"><strong>{displayedTrackers.length}</strong><span>camions affichés</span></div></div>

      {!prefetchReady && selectedTrackIds.length > 0 && <div className="empty-banner">Préchargement rapide des tracés en cours…</div>}
      {prefetchReady && selectedTrackIds.length > 0 && alertMarkers.length === 0 && <div className="empty-banner">Aucune alerte géolocalisée sur la période sélectionnée.</div>}

      <div className="map-filter-stack">
        <div className="filters filter-row"><button className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button><button className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button><button className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button><button className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>À risque</button></div>
        <div className="filters filter-row">{allVisibleTrackers.slice(0, 12).map((tracker) => <button key={tracker.id} className={`chip ${selectedTrackIds.includes(String(tracker.id)) ? 'selected' : ''}`} onClick={() => toggleTrackerSelection(tracker.id)}>{tracker.label}</button>)}</div>
        <div className="filters filter-row">{[{ value: '1h', label: 'Dernière heure' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }, { value: 'today', label: "Aujourd'hui" }, { value: '48h', label: '48h' }].map((item) => <button key={item.value} className={`chip ${period === item.value ? 'selected' : ''}`} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div>
      </div>

      <div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span><span><i className="legend-dot mission-legend-dot"></i> Mission active</span><span><i className="legend-line"></i> Tracé trajet</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Critique</span><span><i className="legend-dot" style={{ background: '#38bdf8' }}></i> Surveillance</span></div>

      <div ref={mapShellRef} className={`leaflet-wrap large-map map-shell ${isFullscreen ? 'map-shell-fullscreen' : ''}`}>
        <div className="map-overlay-controls"><div className="map-overlay-group"><div className="map-overlay-buttons"><button className={`chip ${baseMap === 'plan' ? 'selected' : ''}`} onClick={() => setBaseMap('plan')}>Plan</button><button className={`chip ${baseMap === 'satellite' ? 'selected' : ''}`} onClick={() => setBaseMap('satellite')}>Satellite</button><button className={`chip ${baseMap === 'hybrid' ? 'selected' : ''}`} onClick={() => setBaseMap('hybrid')}>Hybride</button></div></div><button className="ghost-btn small-btn map-fullscreen-btn" onClick={toggleFullscreen}>{isFullscreen ? 'Quitter plein écran' : 'Plein écran'}</button></div>
        <MapContainer center={center} zoom={7} scrollWheelZoom className="leaflet-map">
          <FleetBounds trackers={displayedTrackers} />
          {baseMap === 'plan' && <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}
          {baseMap === 'satellite' && <TileLayer attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />}
          {baseMap === 'hybrid' && <><TileLayer attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /><TileLayer attribution='&copy; OpenStreetMap contributors &copy; CARTO' url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" opacity={0.28} /></>}

          {selectedTrackIds.length > 0 && selectedTrackIds.map((trackerId) => {
            const track = trackMap[String(trackerId)]
            const positions = (track?.points || []).map((point) => [point.lat, point.lng])
            if (positions.length <= 1) return null
            return <Polyline key={`poly-${trackerId}`} positions={positions} pathOptions={{ color: '#22d3ee', weight: 5, opacity: 0.95 }} />
          })}

          {selectedTrackIds.length > 0 && alertMarkers.map((event, index) => <CircleMarker key={`${event.time}-${index}`} center={[event.lat, event.lng]} radius={getAlertPriority(event.event) === 'Critique' ? 9 : 7} pathOptions={{ color: getAlertColor(event.event), fillColor: getAlertColor(event.event), fillOpacity: 0.95, weight: getAlertPriority(event.event) === 'Critique' ? 3 : 2 }}><Popup><strong>{event.event}</strong><br />Priorité: {getAlertPriority(event.event)}<br />{event.message}<br />{event.time ? new Date(event.time).toLocaleString() : '-'}</Popup></CircleMarker>)}

          {displayedTrackers.map((tracker) => {
            const state = getPinState(tracker)
            const isActive = selectedTrackIds.includes(String(tracker.id))
            const activeOrder = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active)
            const computedBearing = bearingByTrackerId.get(String(tracker.id))
            return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker, !!activeOrder, isActive, computedBearing)} opacity={isActive || selectedTrackIds.length === 0 ? 1 : 0.72} eventHandlers={{ click: () => toggleTrackerSelection(tracker.id) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h<br />Direction: {Math.round(computedBearing ?? tracker.state.gps.heading ?? 0)}°<br />Risque: {tracker.riskScore}<br />{activeOrder ? <><br /><strong>BL:</strong> {activeOrder.reference}<br /><strong>Client:</strong> {activeOrder.client}<br /><strong>Destination:</strong> {activeOrder.destination}<br /><strong>Marchandise:</strong> {activeOrder.goods || '-'}<br /><strong>Quantité:</strong> {activeOrder.quantity || '-'}<br /><strong>Statut:</strong> {activeOrder.status}<br /><strong>Fiche mission:</strong> /delivery-order/{activeOrder.id}</> : <><br />Aucun bon actif</>}</Popup></Marker>
          })}
        </MapContainer>
      </div>
    </section>
  )
}
