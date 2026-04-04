import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, LayersControl, MapContainer, Marker, Popup, Polyline, TileLayer } from 'react-leaflet'
import { loadTracks } from '../lib/fleeti'

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

function createTrackerIcon(tracker, hasMission = false) {
  const state = getPinState(tracker)
  const heading = tracker.state?.gps?.heading ?? 0
  const movingArrow = tracker.state?.movement_status === 'moving'
    ? `<div class="pin-heading" style="transform: translateX(-50%) rotate(${heading}deg)">▲</div>`
    : ''

  return L.divIcon({
    className: 'custom-tracker-pin-wrapper',
    html: `<div class="custom-tracker-pin-shell">${movingArrow}<div class="custom-tracker-pin" style="background:${state.color}">${state.label}</div>${hasMission ? '<span class="mission-dot"></span>' : ''}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -12],
  })
}

export function MapPage({ filteredTrackers, setSelectedTrackerId, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')
  const [selectedTrackId, setSelectedTrackId] = useState('')
  const [period, setPeriod] = useState('1h')
  const [trackData, setTrackData] = useState({ points: [], segments: [], events: [] })
  const trackCacheRef = useRef(new Map())

  const visibleTrackers = useMemo(() => filteredTrackers.filter((tracker) => {
    if (!tracker.state?.gps?.location) return false
    if (mapFilter === 'moving') return (tracker.state?.gps?.speed ?? 0) > 0
    if (mapFilter === 'offline') return tracker.state?.connection_status === 'offline'
    if (mapFilter === 'risk') return tracker.riskScore > 10
    return true
  }), [filteredTrackers, mapFilter])

  const center = visibleTrackers[0]
    ? [visibleTrackers[0].state.gps.location.lat, visibleTrackers[0].state.gps.location.lng]
    : [7.54, -5.55]

  useEffect(() => {
    const trackerId = selectedTrackId || visibleTrackers[0]?.id
    if (!trackerId) {
      setTrackData({ points: [], segments: [], events: [] })
      return
    }

    const now = new Date()
    const fromDate = new Date(now)
    if (period === '1h') fromDate.setHours(now.getHours() - 1)
    if (period === '6h') fromDate.setHours(now.getHours() - 6)
    if (period === '24h') fromDate.setHours(now.getHours() - 24)
    if (period === 'today') fromDate.setHours(0, 0, 0, 0)
    if (period === '48h') fromDate.setHours(now.getHours() - 48)

    const from = fromDate.toISOString().slice(0, 19).replace('T', ' ')
    const to = now.toISOString().slice(0, 19).replace('T', ' ')
    const cacheKey = `${trackerId}_${period}`

    if (trackCacheRef.current.has(cacheKey)) {
      setTrackData(trackCacheRef.current.get(cacheKey))
      return
    }

    loadTracks({ trackerId, from, to }).then((data) => {
      trackCacheRef.current.set(cacheKey, data)
      setTrackData(data)
    }).catch(() => setTrackData({ points: [], segments: [], events: [] }))
  }, [selectedTrackId, period, visibleTrackers])

  useEffect(() => {
    const now = new Date()
    visibleTrackers.slice(0, 6).forEach((tracker) => {
      const trackerId = tracker.id
      ;['1h', '6h', '24h'].forEach((p) => {
        const cacheKey = `${trackerId}_${p}`
        if (trackCacheRef.current.has(cacheKey)) return
        const fromDate = new Date(now)
        if (p === '1h') fromDate.setHours(now.getHours() - 1)
        if (p === '6h') fromDate.setHours(now.getHours() - 6)
        if (p === '24h') fromDate.setHours(now.getHours() - 24)
        loadTracks({
          trackerId,
          from: fromDate.toISOString().slice(0, 19).replace('T', ' '),
          to: now.toISOString().slice(0, 19).replace('T', ' '),
        }).then((data) => {
          trackCacheRef.current.set(cacheKey, data)
        }).catch(() => {})
      })
    })
  }, [visibleTrackers])

  const polylinePositions = trackData.points.map((point) => [point.lat, point.lng])
  const alertMarkers = (trackData.events || []).map((event) => ({
    ...event,
    lat: event.lat ?? event.location?.lat ?? null,
    lng: event.lng ?? event.location?.lng ?? null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))

  return <section className="panel panel-large map-panel"><div className="panel-header"><div><h3>Live Map</h3></div></div><div className="filters filter-row"><button className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button><button className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button><button className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button><button className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>À risque</button></div><div className="filters filter-row">{visibleTrackers.slice(0, 8).map((tracker) => <button key={tracker.id} className={`chip ${String(selectedTrackId || visibleTrackers[0]?.id || '') === String(tracker.id) ? 'selected' : ''}`} onClick={() => setSelectedTrackId(String(tracker.id))}>{tracker.label}</button>)}</div><div className="filters filter-row">{[{ value: '1h', label: 'Dernière heure' }, { value: '6h', label: '6h' }, { value: '24h', label: '24h' }, { value: 'today', label: "Aujourd'hui" }, { value: '48h', label: '48h' }].map((item) => <button key={item.value} className={`chip ${period === item.value ? 'selected' : ''}`} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div><div className="map-kpi-row"><div className="mini-kpi"><span>Visible</span><strong>{visibleTrackers.length}</strong></div><div className="mini-kpi"><span>Moving</span><strong>{visibleTrackers.filter((tracker) => (tracker.state?.gps?.speed ?? 0) > 0).length}</strong></div><div className="mini-kpi"><span>Alertes tracé</span><strong>{alertMarkers.length}</strong></div></div>{alertMarkers.length === 0 && <div className="empty-banner">Aucune alerte géolocalisée sur la période sélectionnée.</div>}<div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span><span><i className="legend-dot mission-legend-dot"></i> Mission active</span><span><i className="legend-line"></i> Tracé trajet</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Speedup</span><span><i className="legend-dot" style={{ background: '#38bdf8' }}></i> Fuel</span></div><div className="leaflet-wrap large-map"><MapContainer center={center} zoom={7} scrollWheelZoom className="leaflet-map"><LayersControl position="topright"><LayersControl.BaseLayer checked name="Plan"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /></LayersControl.BaseLayer><LayersControl.BaseLayer name="Satellite"><TileLayer attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /></LayersControl.BaseLayer></LayersControl>{polylinePositions.length > 1 && <Polyline positions={polylinePositions} pathOptions={{ color: '#38bdf8', weight: 4, opacity: 0.8 }} />}{alertMarkers.map((event, index) => <CircleMarker key={`${event.time}-${index}`} center={[event.lat, event.lng]} radius={6} pathOptions={{ color: getAlertColor(event.event), fillColor: getAlertColor(event.event), fillOpacity: 0.9 }}><Popup><strong>{event.event}</strong><br />{event.message}<br />{event.time ? new Date(event.time).toLocaleString() : '-'}</Popup></CircleMarker>)}{visibleTrackers.map((tracker) => { const state = getPinState(tracker); const activeOrder = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active); return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker, !!activeOrder)} eventHandlers={{ click: () => setSelectedTrackerId(String(tracker.id)) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h<br />Direction: {tracker.state.gps.heading ?? 0}°<br />Risque: {tracker.riskScore}<br />{activeOrder ? <><br /><strong>BL:</strong> {activeOrder.reference}<br /><strong>Client:</strong> {activeOrder.client}<br /><strong>Destination:</strong> {activeOrder.destination}<br /><strong>Marchandise:</strong> {activeOrder.goods || '-'}<br /><strong>Quantité:</strong> {activeOrder.quantity || '-'}<br /><strong>Statut:</strong> {activeOrder.status}<br /><strong>Fiche mission:</strong> /delivery-order/{activeOrder.id}</> : <><br />Aucun bon actif</>}</Popup></Marker>})}</MapContainer></div></section>
}
