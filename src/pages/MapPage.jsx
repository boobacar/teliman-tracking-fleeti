import { useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

function getPinState(tracker) {
  const connection = tracker.state?.connection_status
  const movement = tracker.state?.movement_status

  if (connection === 'offline') return { color: '#ef4444', label: 'O', text: 'Offline' }
  if (movement === 'parked' || movement === 'parking') return { color: '#f59e0b', label: 'P', text: 'Parking' }
  if (connection === 'active' && movement === 'moving') return { color: '#22c55e', label: 'M', text: 'Moving' }
  if (connection === 'idle') return { color: '#f59e0b', label: 'I', text: 'Idle' }
  return { color: '#64748b', label: '?', text: 'Unknown' }
}

function createTrackerIcon(tracker) {
  const state = getPinState(tracker)
  return L.divIcon({
    className: 'custom-tracker-pin-wrapper',
    html: `<div class="custom-tracker-pin" style="background:${state.color}">${state.label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -12],
  })
}

export function MapPage({ filteredTrackers, setSelectedTrackerId, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')

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

  return <section className="panel panel-large map-panel"><div className="panel-header"><div><h3>Live Map</h3><p>Suivi temps réel des unités avec états visibles directement sur la carte</p></div></div><div className="filters filter-row"><button className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button><button className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button><button className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button><button className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>À risque</button></div><div className="map-kpi-row"><div className="mini-kpi"><span>Visible</span><strong>{visibleTrackers.length}</strong></div><div className="mini-kpi"><span>Moving</span><strong>{visibleTrackers.filter((tracker) => (tracker.state?.gps?.speed ?? 0) > 0).length}</strong></div><div className="mini-kpi"><span>Offline</span><strong>{visibleTrackers.filter((tracker) => tracker.state?.connection_status === 'offline').length}</strong></div></div><div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span></div><div className="leaflet-wrap large-map"><MapContainer center={center} zoom={7} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{visibleTrackers.map((tracker) => { const state = getPinState(tracker); const activeOrder = deliveryOrders.find((item) => Number(item.trackerId) === Number(tracker.id) && item.active); return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker)} eventHandlers={{ click: () => setSelectedTrackerId(tracker.id) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h<br />Risque: {tracker.riskScore}<br />{activeOrder ? <><br /><strong>BL:</strong> {activeOrder.reference}<br /><strong>Client:</strong> {activeOrder.client}<br /><strong>Destination:</strong> {activeOrder.destination}<br /><strong>Marchandise:</strong> {activeOrder.goods || '-'}<br /><strong>Quantité:</strong> {activeOrder.quantity || '-'}<br /><strong>Statut:</strong> {activeOrder.status}</> : <><br />Aucun bon actif</>}</Popup></Marker>})}</MapContainer></div></section>
}
