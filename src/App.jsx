import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Battery, Car, ChevronRight, Gauge, LayoutDashboard, Map, MapPin, RefreshCw, Search, ShieldAlert, Siren, Users, Wifi } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fallbackEvents } from './data/mock'
import { loadFleetData } from './lib/fleeti'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const views = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'map', label: 'Live Map', icon: Map },
  { id: 'trackers', label: 'Trackers', icon: Car },
  { id: 'drivers', label: 'Chauffeurs', icon: Users },
  { id: 'alerts', label: 'Alertes', icon: Siren },
]

const statusColor = (status) => status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : status === 'offline' ? '#ef4444' : '#64748b'

function App() {
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [activeView, setActiveView] = useState('dashboard')
  const [selectedTrackerId, setSelectedTrackerId] = useState(3488326)

  const refreshData = async () => {
    setLoading(true)
    setError('')
    try {
      setDataset(await loadFleetData())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refreshData() }, [])

  const enrichedTrackers = useMemo(() => {
    const employees = Object.fromEntries((dataset?.employees ?? []).map((e) => [e.tracker_id, e]))
    return (dataset?.trackers ?? []).map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = dataset?.mileage?.[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const events = (dataset?.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const eventCounts = events.reduce((acc, event) => ({ ...acc, [event.event]: (acc[event.event] || 0) + 1 }), {})
      return {
        ...tracker,
        state,
        mileage,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Non assigné',
        employeePhone: employee?.phone || 'N/A',
        latestDayMileage: mileage['2026-04-02']?.mileage ?? mileage['2026-04-01']?.mileage ?? 0,
        events,
        eventCounts,
        statusColor: statusColor(state.connection_status),
      }
    })
  }, [dataset])

  const filteredTrackers = useMemo(() => enrichedTrackers.filter((tracker) => {
    const text = `${tracker.label} ${tracker.employeeName}`.toLowerCase()
    return text.includes(search.toLowerCase()) && (filter === 'all' || tracker.state.connection_status === filter)
  }), [enrichedTrackers, search, filter])

  const selectedTracker = filteredTrackers.find((t) => t.id === selectedTrackerId) || enrichedTrackers.find((t) => t.id === selectedTrackerId) || filteredTrackers[0] || enrichedTrackers[0]
  const importantEvents = useMemo(() => ((dataset?.history?.length ? dataset.history : fallbackEvents)
    .filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event))
    .sort((a, b) => new Date(b.time) - new Date(a.time))), [dataset])

  const stats = {
    total: enrichedTrackers.length,
    active: enrichedTrackers.filter((t) => t.state.connection_status === 'active').length,
    offline: enrichedTrackers.filter((t) => t.state.connection_status === 'offline').length,
    moving: enrichedTrackers.filter((t) => t.state.movement_status === 'moving').length,
    avgSpeed: enrichedTrackers.length ? Math.round(enrichedTrackers.reduce((a, t) => a + (t.state?.gps?.speed ?? 0), 0) / enrichedTrackers.length) : 0,
  }

  const riskRanking = [...enrichedTrackers].map((tracker) => ({
    ...tracker,
    riskScore: (tracker.eventCounts.speedup || 0) * 4 + (tracker.eventCounts.excessive_parking || 0) * 2 + ((tracker.state.battery_level || 100) < 20 ? 5 : 0),
  })).sort((a, b) => b.riskScore - a.riskScore)

  const topDrivers = riskRanking.slice(0, 5).map((tracker) => ({ name: tracker.employeeName, tracker: tracker.label, mileage: tracker.latestDayMileage, risk: tracker.riskScore }))
  const connectionChart = [
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]

  return (
    <div className="app-shell premium-shell">
      <aside className="sidebar premium-sidebar">
        <div>
          <div className="brand-badge">TELIMAN PREMIUM</div>
          <h1>Operations Center</h1>
          <p>Interface premium de suivi, alertes et décision terrain.</p>
        </div>
        <button className="primary-btn" onClick={refreshData} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'Actualisation...' : 'Rafraîchir'}</button>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher tracker ou chauffeur" /></div>
        <nav className="view-nav">{views.map((view) => { const Icon = view.icon; return <button key={view.id} className={`view-link ${activeView === view.id ? 'active' : ''}`} onClick={() => setActiveView(view.id)}><Icon size={18} /><span>{view.label}</span><ChevronRight size={16} /></button> })}</nav>
        <div className="filters">{['all', 'active', 'idle', 'offline'].map((value) => <button key={value} className={`chip ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>{value}</button>)}</div>
      </aside>

      <main className="main-content premium-main">
        <section className="hero-panel premium-hero">
          <div><p className="eyebrow">Fleet intelligence platform</p><h2>Une vraie interface de pilotage premium, pensée métier</h2><p>Vue dirigeant, cartographie live, risque opérationnel, top alertes, top chauffeurs et lecture instantanée de la flotte.</p></div>
          <div className="hero-meta"><div className="meta-box"><ShieldAlert size={18} /><span>{dataset?.rules?.length ?? 0} règles</span></div><div className="meta-box"><AlertTriangle size={18} /><span>{dataset?.unreadCount ?? 0} alertes</span></div></div>
        </section>
        {error && <div className="error-banner">{error}</div>}
        <section className="stats-grid premium-stats">
          <StatCard icon={<Car size={18} />} label="Trackers" value={stats.total} helper="Base flotte" />
          <StatCard icon={<Wifi size={18} />} label="Actifs" value={stats.active} helper="Connectés live" />
          <StatCard icon={<Activity size={18} />} label="En mouvement" value={stats.moving} helper="Terrain roulant" />
          <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${stats.avgSpeed} km/h`} helper="Instantané" />
        </section>

        {activeView === 'dashboard' && <><section className="dashboard-grid premium-grid"><div className="panel panel-large"><div className="panel-header"><div><h3>Kilométrage du jour</h3><p>Classement des unités les plus actives</p></div></div><ResponsiveContainer width="100%" height={280}><BarChart data={filteredTrackers.map((t) => ({ name: t.label, mileage: t.latestDayMileage }))}><CartesianGrid strokeDasharray="3 3" stroke="#243042" /><XAxis dataKey="name" stroke="#8da2c0" /><YAxis stroke="#8da2c0" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /><Bar dataKey="mileage" fill="#3b82f6" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="panel"><div className="panel-header"><div><h3>Répartition flotte</h3><p>Connectivité</p></div></div><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={connectionChart} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={4}>{connectionChart.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /></PieChart></ResponsiveContainer></div></section><section className="dashboard-grid premium-grid"><div className="panel panel-large"><div className="panel-header"><div><h3>Top risques</h3><p>Trackers à surveiller en priorité</p></div></div><div className="alerts-list">{riskRanking.slice(0, 5).map((tracker) => <div key={tracker.id} className="alert-row"><div className="alert-icon"><ShieldAlert size={16} /></div><div><strong>{tracker.label}</strong><p>{tracker.employeeName}</p><span>Risque {tracker.riskScore} · Speedups {tracker.eventCounts.speedup || 0}</span></div></div>)}</div></div><div className="panel"><div className="panel-header"><div><h3>Top chauffeurs</h3><p>Lecture exploitant</p></div></div><div className="driver-ranking">{topDrivers.map((driver, index) => <div key={`${driver.name}-${index}`} className="driver-rank-row"><strong>#{index + 1}</strong><div><span>{driver.name}</span><small>{driver.tracker}</small></div><div><span>{driver.mileage} km</span><small>Risque {driver.risk}</small></div></div>)}</div></div></section></>}

        {activeView === 'map' && <section className="panel panel-large map-panel"><div className="panel-header"><div><h3>Live Map</h3><p>Suivi temps réel des unités</p></div></div><div className="leaflet-wrap large-map"><MapContainer center={[7.54, -5.55]} zoom={7} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{filteredTrackers.filter((t) => t.state?.gps?.location).map((tracker) => <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} eventHandlers={{ click: () => setSelectedTrackerId(tracker.id) }}><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />{tracker.state.connection_status} / {tracker.state.movement_status}<br />{tracker.state.gps.speed ?? 0} km/h</Popup></Marker>)}</MapContainer></div></section>}

        {activeView === 'trackers' && <section className="panel panel-large"><div className="panel-header"><div><h3>Trackers</h3><p>Inventaire exploitable</p></div></div><div className="tracker-table">{filteredTrackers.map((tracker) => <button key={tracker.id} className="tracker-table-row" onClick={() => setSelectedTrackerId(tracker.id)}><div><strong>{tracker.label}</strong><small>{tracker.model}</small></div><div>{tracker.employeeName}</div><div>{tracker.state.connection_status}</div><div>{tracker.state.gps?.speed ?? 0} km/h</div><div>{tracker.latestDayMileage} km</div></button>)}</div></section>}

        {activeView === 'drivers' && <section className="panel panel-large"><div className="panel-header"><div><h3>Chauffeurs</h3><p>Vue people + unité</p></div></div><div className="tracker-table">{filteredTrackers.map((tracker) => <div key={tracker.id} className="tracker-table-row static-row"><div><strong>{tracker.employeeName}</strong><small>{tracker.employeePhone}</small></div><div>{tracker.label}</div><div>{tracker.latestDayMileage} km</div><div>{tracker.eventCounts.speedup || 0} speedups</div><div>{tracker.eventCounts.excessive_parking || 0} parking alerts</div></div>)}</div></section>}

        {activeView === 'alerts' && <section className="panel panel-large"><div className="panel-header"><div><h3>Centre d’alertes</h3><p>Événements critiques et lecture rapide</p></div></div><div className="events-table">{importantEvents.slice(0, 30).map((event) => <div key={`${event.tracker_id}-${event.time}-${event.event}`} className="event-row"><div><strong>{event.label || event.extra?.tracker_label}</strong></div><div>{event.event}</div><div>{event.chauffeur || event.extra?.employee_full_name || 'N/A'}</div><div>{event.message}</div><div>{event.address}</div><div>{new Date(event.time).toLocaleString()}</div></div>)}</div></section>}

        <section className="dashboard-grid premium-grid bottom-grid"><div className="panel detail-panel"><div className="panel-header"><div><h3>Fiche unité</h3><p>Lecture rapide</p></div></div>{selectedTracker ? <><div className="detail-grid"><DetailItem icon={<Users size={16} />} label="Chauffeur" value={selectedTracker.employeeName} /><DetailItem icon={<MapPin size={16} />} label="Position" value={`${selectedTracker.state?.gps?.location?.lat ?? '-'}, ${selectedTracker.state?.gps?.location?.lng ?? '-'}`} /><DetailItem icon={<Battery size={16} />} label="Batterie" value={`${selectedTracker.state?.battery_level ?? '-'}%`} /><DetailItem icon={<Gauge size={16} />} label="Vitesse" value={`${selectedTracker.state?.gps?.speed ?? 0} km/h`} /></div><div className="mini-chart-wrap"><ResponsiveContainer width="100%" height={180}><AreaChart data={Object.entries(selectedTracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))}><defs><linearGradient id="mileageFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#243042" /><XAxis dataKey="day" stroke="#8da2c0" /><YAxis stroke="#8da2c0" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /><Area type="monotone" dataKey="mileage" stroke="#60a5fa" fill="url(#mileageFill)" /></AreaChart></ResponsiveContainer></div></> : <p>Aucune unité sélectionnée.</p>}</div><div className="panel"><div className="panel-header"><div><h3>Événements clés</h3><p>Feed prioritaire</p></div></div><div className="alerts-list">{importantEvents.slice(0, 6).map((event) => <div key={`${event.tracker_id}-${event.time}`} className="alert-row"><div className="alert-icon"><AlertTriangle size={16} /></div><div><strong>{event.label || event.extra?.tracker_label}</strong><p>{event.message}</p><span>{new Date(event.time).toLocaleString()}</span></div></div>)}</div></div></section>
      </main>
    </div>
  )
}

function StatCard({ icon, label, value, helper }) { return <div className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }
function DetailItem({ icon, label, value }) { return <div className="detail-item"><div className="detail-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div> }

export default App
