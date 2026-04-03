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

export function MapPage({ filteredTrackers, setSelectedTrackerId }) {
  return <section className="panel panel-large map-panel"><div className="panel-header"><div><h3>Live Map</h3><p>Suivi temps réel des unités avec états visibles directement sur la carte</p></div></div><div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span></div><div className="leaflet-wrap large-map"><MapContainer center={[7.54, -5.55]} zoom={7} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{filteredTrackers.filter((t) => t.state?.gps?.location).map((tracker) => { const state = getPinState(tracker); return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker)} eventHandlers={{ click: () => setSelectedTrackerId(tracker.id) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h</Popup></Marker>})}</MapContainer></div></section>
}
