import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, Battery, Gauge, MapPin, Users, Wifi, Route } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import { EmptyBanner } from '../components/FeedbackBanners'

function statusLabel(status) {
  if (status === 'active') return { label: 'Active', color: '#22c55e' }
  if (status === 'idle') return { label: 'Idle', color: '#f59e0b' }
  if (status === 'offline') return { label: 'Offline', color: '#ef4444' }
  return { label: 'Inconnu', color: '#64748b' }
}

export function TrackerDetailPage({ enrichedTrackers, deliveryOrders = [] }) {
  const { id } = useParams()
  const tracker = enrichedTrackers?.find((t) => String(t.id) === String(id))

  if (!tracker) return (
    <section className="panel">
      <div className="panel-header"><div><h3>Fiche unité</h3><p>Sélectionnez une unité dans la liste trackers</p></div></div>
      <EmptyBanner message="Aucune unité trouvée pour l'identifiant demandé." />
    </section>
  )

  const { label: statusLbl, color: statusClr } = statusLabel(tracker.state?.connection_status)
  const mileageData = Object.entries(tracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))
  const eventsByType = Object.entries(tracker.eventCounts).map(([event, count]) => ({ event: event.replace(/_/g, ' '), count }))
  const gps = tracker.state?.gps?.location
  const trackerOrders = deliveryOrders.filter((item) => Number(item.trackerId) === Number(tracker.id))
  const activeOrder = trackerOrders.find((item) => item.active)

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel">
        <div className="panel-header">
          <div><h3>{tracker.label}</h3><p>Vue complète de l'unité</p></div>
          <span className="status-pill" style={{ background: `${statusClr}22`, color: statusClr, alignSelf: 'flex-start' }}>{statusLbl}</span>
        </div>
        <div className="tracker-overview-grid">
          <div className="overview-card"><div className="stat-icon"><Users size={16} /></div><span>Chauffeur</span><strong>{tracker.employeeName}</strong></div>
          <div className="overview-card"><div className="stat-icon"><Gauge size={16} /></div><span>Vitesse</span><strong>{tracker.state?.gps?.speed ?? 0} km/h</strong></div>
          <div className="overview-card"><div className="stat-icon"><Battery size={16} /></div><span>Batterie</span><strong>{tracker.state?.battery_level ?? '-'}%</strong></div>
          <div className="overview-card"><div className="stat-icon"><Route size={16} /></div><span>Kilométrage</span><strong>{tracker.latestDayMileage} km</strong></div>
          <div className="overview-card"><div className="stat-icon"><Wifi size={16} /></div><span>Mouvement</span><strong>{tracker.state?.movement_status ?? '-'}</strong></div>
          <div className="overview-card"><div className="stat-icon"><MapPin size={16} /></div><span>Dernière MàJ</span><strong>{tracker.state?.last_update ? new Date(tracker.state.last_update).toLocaleString() : '-'}</strong></div>
          <div className="overview-card"><span>Connexion</span><strong>{tracker.state?.connection_status ?? '-'}</strong></div>
          <div className="overview-card"><span>Événements</span><strong>{tracker.events.length}</strong></div>
        </div>
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel">
          <div className="panel-header"><div><h3>Alertes dominantes</h3><p>Lecture rapide des signaux</p></div></div>
          <div className="driver-ranking">
            {Object.entries(tracker.eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, value]) => <div key={label} className="driver-rank-row static-row"><strong>{value}</strong><div><span>{label}</span><small>type d'événement</small></div></div>)}
            {Object.keys(tracker.eventCounts).length === 0 && <EmptyBanner message="Aucune alerte dominante." />}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h3>Coordonnées live</h3><p>Position et adresse actuelle</p></div></div>
          <div className="driver-ranking">
            <div className="driver-rank-row static-row"><strong>Lat</strong><div><span>{tracker.state?.gps?.location?.lat ?? '-'}</span><small>latitude</small></div></div>
            <div className="driver-rank-row static-row"><strong>Lng</strong><div><span>{tracker.state?.gps?.location?.lng ?? '-'}</span><small>longitude</small></div></div>
            <div className="driver-rank-row static-row"><strong>Adr</strong><div><span>{tracker.state?.gps?.address || 'Adresse indisponible'}</span><small>dernier point connu</small></div></div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel">
          <div className="panel-header"><div><h3>Mission active</h3><p>Bon de livraison en cours</p></div></div>
          {activeOrder ? <div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{activeOrder.reference}</strong><div><span>{activeOrder.client}</span><small>{activeOrder.destination}</small></div></div><div className="driver-rank-row static-row"><strong>March.</strong><div><span>{activeOrder.goods || '-'}</span><small>{activeOrder.quantity || '-'}</small></div></div><div className="driver-rank-row static-row"><strong>Statut</strong><div><span>{activeOrder.status}</span><small>{activeOrder.date ? new Date(activeOrder.date).toLocaleString() : '-'}</small></div></div></div> : <EmptyBanner message="Aucune mission active sur ce camion." />}
        </div>
        <div className="panel">
          <div className="panel-header"><div><h3>Historique missions</h3><p>Derniers bons liés à l'unité</p></div></div>
          <div className="driver-ranking">{trackerOrders.slice(0, 4).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference}</strong><div><span>{item.client}</span><small>{item.destination}</small></div><div><span>{item.active ? 'Actif' : item.status}</span><small>{item.date ? new Date(item.date).toLocaleDateString() : '-'}</small></div></div>)}{trackerOrders.length === 0 && <EmptyBanner message="Aucun bon de livraison lié à ce camion." />}</div>
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
        <div className="panel-header"><div><h3>Timeline d'événements</h3><p>Historique récent de l'unité</p></div><Link className="ghost-btn" to="/alerts">Voir toutes les alertes</Link></div>
        <div className="timeline-list">
          {tracker.events.slice(0, 20).map((event) => (
            <div key={`${event.time}-${event.event}`} className="timeline-row">
              <div className="timeline-icon"><AlertTriangle size={14} /></div>
              <div><strong>{event.message}</strong><p>{event.address}</p><span>{new Date(event.time).toLocaleString()}</span></div>
            </div>
          ))}
          {tracker.events.length === 0 && <EmptyBanner message="Aucun événement récent." />}
        </div>
      </section>
    </div>
  )
}
