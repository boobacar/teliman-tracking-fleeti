import { useParams } from 'react-router-dom'
import { AlertTriangle, Battery, Gauge, MapPin, Users, Wifi, Route } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

function statusLabel(status) {
  if (status === 'active') return { label: 'Active', color: '#22c55e' }
  if (status === 'idle') return { label: 'Idle', color: '#f59e0b' }
  if (status === 'offline') return { label: 'Offline', color: '#ef4444' }
  return { label: 'Inconnu', color: '#64748b' }
}

export function TrackerDetailPage({ enrichedTrackers }) {
  const { id } = useParams()
  const tracker = enrichedTrackers?.find((t) => String(t.id) === String(id))

  if (!tracker) return (
    <section className="panel">
      <div className="panel-header"><div><h3>Fiche unité</h3><p>Sélectionnez une unité dans la liste trackers</p></div></div>
      <p style={{ color: '#94a3b8', padding: '12px 0' }}>Aucune unité trouvée pour l'identifiant demandé.</p>
    </section>
  )

  const { label: statusLbl, color: statusClr } = statusLabel(tracker.state?.connection_status)
  const mileageData = Object.entries(tracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))
  const eventsByType = Object.entries(tracker.eventCounts).map(([event, count]) => ({ event: event.replace(/_/g, ' '), count }))
  const gps = tracker.state?.gps?.location

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel">
        <div className="panel-header">
          <div><h3>{tracker.label}</h3><p>Vue complète de l'unité</p></div>
          <span className="status-pill" style={{ background: `${statusClr}22`, color: statusClr, alignSelf: 'flex-start' }}>{statusLbl}</span>
        </div>
        <div className="tracker-detail-kpis">
          <div className="tracker-kpi"><div className="stat-icon"><Users size={16} /></div><div><span>Chauffeur</span><strong>{tracker.employeeName}</strong></div></div>
          <div className="tracker-kpi"><div className="stat-icon"><Gauge size={16} /></div><div><span>Vitesse</span><strong>{tracker.state?.gps?.speed ?? 0} km/h</strong></div></div>
          <div className="tracker-kpi"><div className="stat-icon"><Battery size={16} /></div><div><span>Batterie</span><strong>{tracker.state?.battery_level ?? '-'}%</strong></div></div>
          <div className="tracker-kpi"><div className="stat-icon"><Route size={16} /></div><div><span>Odomètre</span><strong>{tracker.latestDayMileage} km</strong></div></div>
          <div className="tracker-kpi"><div className="stat-icon"><Wifi size={16} /></div><div><span>Mouvement</span><strong>{tracker.state?.movement_status ?? '-'}</strong></div></div>
          <div className="tracker-kpi"><div className="stat-icon"><MapPin size={16} /></div><div><span>Dernière MàJ</span><strong>{tracker.state?.last_update ? new Date(tracker.state.last_update).toLocaleString() : '-'}</strong></div></div>
        </div>
      </section>

      <div className="dashboard-grid premium-grid phase2-grid">
        <div className="panel">
          <div className="panel-header"><div><h3>Kilométrage</h3><p>Activité par journée</p></div></div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={mileageData}>
              <defs><linearGradient id="detailFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
              <XAxis dataKey="day" stroke="#8da2c0" /><YAxis stroke="#8da2c0" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              <Area type="monotone" dataKey="mileage" stroke="#60a5fa" fill="url(#detailFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-header"><div><h3>Répartition des alertes</h3><p>Par type d'événement</p></div></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={eventsByType}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
              <XAxis dataKey="event" stroke="#8da2c0" tick={{ fontSize: 11 }} /><YAxis stroke="#8da2c0" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {gps && (
        <section className="panel">
          <div className="panel-header"><div><h3>Position actuelle</h3><p>{`${gps.lat}, ${gps.lng}`}</p></div></div>
          <div className="leaflet-wrap" style={{ height: 320 }}>
            <MapContainer center={[gps.lat, gps.lng]} zoom={13} scrollWheelZoom className="leaflet-map">
              <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[gps.lat, gps.lng]}>
                <Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />{tracker.state.connection_status} / {tracker.state.movement_status}<br />{tracker.state.gps.speed ?? 0} km/h</Popup>
              </Marker>
            </MapContainer>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><div><h3>Timeline d'événements</h3><p>Historique récent de l'unité</p></div></div>
        <div className="timeline-list">
          {tracker.events.slice(0, 20).map((event) => (
            <div key={`${event.time}-${event.event}`} className="timeline-row">
              <div className="timeline-icon"><AlertTriangle size={14} /></div>
              <div><strong>{event.message}</strong><p>{event.address}</p><span>{new Date(event.time).toLocaleString()}</span></div>
            </div>
          ))}
          {tracker.events.length === 0 && <p style={{ color: '#94a3b8' }}>Aucun événement récent.</p>}
        </div>
      </section>
    </div>
  )
}
