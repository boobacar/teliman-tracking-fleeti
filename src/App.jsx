import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Battery,
  Car,
  Gauge,
  MapPin,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Users,
  Wifi,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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

function trackerStatusColor(status) {
  if (status === 'active') return '#22c55e'
  if (status === 'idle') return '#f59e0b'
  if (status === 'offline') return '#ef4444'
  return '#64748b'
}

function App() {
  const [selectedTrackerId, setSelectedTrackerId] = useState(3488326)
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const refreshData = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await loadFleetData()
      setDataset(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshData()
  }, [])

  const enrichedTrackers = useMemo(() => {
    const employees = Object.fromEntries((dataset?.employees ?? []).map((e) => [e.tracker_id, e]))
    const trackers = dataset?.trackers ?? []
    return trackers.map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = dataset?.mileage?.[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const latestDay = mileage['2026-04-02']?.mileage ?? mileage['2026-04-01']?.mileage ?? 0
      const trackerEvents = (dataset?.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const counts = trackerEvents.reduce((acc, event) => {
        acc[event.event] = (acc[event.event] || 0) + 1
        return acc
      }, {})
      return {
        ...tracker,
        state,
        mileage,
        latestDayMileage: latestDay,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Non assigné',
        employeePhone: employee?.phone || 'N/A',
        statusColor: trackerStatusColor(state.connection_status),
        events: trackerEvents,
        eventCounts: counts,
      }
    })
  }, [dataset])

  const filteredTrackers = useMemo(() => {
    return enrichedTrackers.filter((tracker) => {
      const text = `${tracker.label} ${tracker.employeeName}`.toLowerCase()
      const matchesSearch = text.includes(search.toLowerCase())
      const matchesFilter = filter === 'all' || tracker.state.connection_status === filter
      return matchesSearch && matchesFilter
    })
  }, [enrichedTrackers, search, filter])

  const selectedTracker = filteredTrackers.find((tracker) => tracker.id === selectedTrackerId)
    || enrichedTrackers.find((tracker) => tracker.id === selectedTrackerId)
    || filteredTrackers[0]
    || enrichedTrackers[0]

  const stats = useMemo(() => {
    const trackers = enrichedTrackers
    return {
      total: trackers.length,
      active: trackers.filter((t) => t.state.connection_status === 'active').length,
      offline: trackers.filter((t) => t.state.connection_status === 'offline').length,
      moving: trackers.filter((t) => t.state.movement_status === 'moving').length,
      avgSpeed: trackers.length ? Math.round(trackers.reduce((acc, t) => acc + (t.state?.gps?.speed ?? 0), 0) / trackers.length) : 0,
    }
  }, [enrichedTrackers])

  const mileageChart = useMemo(() => filteredTrackers.map((tracker) => ({
    name: tracker.label,
    mileage: tracker.latestDayMileage,
  })), [filteredTrackers])

  const connectionChart = useMemo(() => ([
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]), [stats])

  const importantEvents = useMemo(() => {
    const source = dataset?.history?.length ? dataset.history : fallbackEvents
    return [...source]
      .filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event))
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 12)
  }, [dataset])

  const riskRanking = useMemo(() => {
    return [...enrichedTrackers]
      .map((tracker) => ({
        ...tracker,
        riskScore: (tracker.eventCounts.speedup || 0) * 4 + (tracker.eventCounts.excessive_parking || 0) * 2 + ((tracker.state.battery_level || 100) < 20 ? 5 : 0),
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 5)
  }, [enrichedTrackers])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-badge">TELIMAN V2</div>
          <h1>Tracking Fleeti</h1>
          <p>Centre de supervision moderne pour flotte, alertes et opérations terrain.</p>
        </div>

        <button className="primary-btn" onClick={refreshData} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'Actualisation...' : 'Rafraîchir'}
        </button>

        <div className="search-box">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Chercher tracker ou chauffeur"
          />
        </div>

        <div className="filters">
          {['all', 'active', 'idle', 'offline'].map((value) => (
            <button
              key={value}
              className={`chip ${filter === value ? 'selected' : ''}`}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </aside>

      <main className="main-content">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Tracking, alerting, localisation, analyse</p>
            <h2>Une interface live plus propre, plus riche et plus exploitable</h2>
            <p>
              Cette v2 ajoute une vraie structure d’exploitation : carte interactive, ranking de risque,
              filtres, recherche, vue flotte et lecture directe des événements majeurs.
            </p>
          </div>
          <div className="hero-meta">
            <div className="meta-box"><ShieldAlert size={18} /><span>{dataset?.rules?.length ?? 0} règles</span></div>
            <div className="meta-box"><AlertTriangle size={18} /><span>{dataset?.unreadCount ?? 0} alertes</span></div>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        <section className="stats-grid">
          <StatCard icon={<Car size={18} />} label="Trackers" value={stats.total} helper="Unité flotte" />
          <StatCard icon={<Wifi size={18} />} label="Actifs" value={stats.active} helper="En ligne" />
          <StatCard icon={<Route size={18} />} label="En mouvement" value={stats.moving} helper="Trafic terrain" />
          <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${stats.avgSpeed} km/h`} helper="Snapshot live" />
        </section>

        <section className="dashboard-grid v2-grid">
          <div className="panel panel-large map-panel">
            <div className="panel-header">
              <div>
                <h3>Carte interactive</h3>
                <p>Localisation live des unités</p>
              </div>
            </div>
            <div className="leaflet-wrap">
              <MapContainer center={[7.54, -5.55]} zoom={7} scrollWheelZoom className="leaflet-map">
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {filteredTrackers
                  .filter((tracker) => tracker.state?.gps?.location)
                  .map((tracker) => (
                    <Marker
                      key={tracker.id}
                      position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]}
                      eventHandlers={{ click: () => setSelectedTrackerId(tracker.id) }}
                    >
                      <Popup>
                        <strong>{tracker.label}</strong><br />
                        {tracker.employeeName}<br />
                        {tracker.state.connection_status} / {tracker.state.movement_status}<br />
                        {tracker.state.gps.speed ?? 0} km/h
                      </Popup>
                    </Marker>
                  ))}
              </MapContainer>
            </div>
          </div>

          <div className="panel detail-panel">
            <div className="panel-header">
              <div>
                <h3>Fiche tracker</h3>
                <p>Détail opérationnel</p>
              </div>
            </div>
            {selectedTracker ? (
              <>
                <div className="tracker-picker">
                  <select value={selectedTracker.id} onChange={(e) => setSelectedTrackerId(Number(e.target.value))}>
                    {filteredTrackers.map((tracker) => (
                      <option key={tracker.id} value={tracker.id}>{tracker.label}</option>
                    ))}
                  </select>
                </div>
                <div className="detail-grid">
                  <DetailItem icon={<Users size={16} />} label="Chauffeur" value={selectedTracker.employeeName} />
                  <DetailItem icon={<MapPin size={16} />} label="Position" value={`${selectedTracker.state?.gps?.location?.lat ?? '-'}, ${selectedTracker.state?.gps?.location?.lng ?? '-'}`} />
                  <DetailItem icon={<Activity size={16} />} label="État" value={`${selectedTracker.state?.connection_status ?? '-'} / ${selectedTracker.state?.movement_status ?? '-'}`} />
                  <DetailItem icon={<Battery size={16} />} label="Batterie" value={`${selectedTracker.state?.battery_level ?? '-'}%`} />
                </div>
                <div className="mini-chart-wrap">
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={Object.entries(selectedTracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))}>
                      <defs>
                        <linearGradient id="mileageFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                      <XAxis dataKey="day" stroke="#8da2c0" />
                      <YAxis stroke="#8da2c0" />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
                      <Area type="monotone" dataKey="mileage" stroke="#60a5fa" fill="url(#mileageFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : <p>Aucune unité sélectionnée.</p>}
          </div>
        </section>

        <section className="dashboard-grid second-row">
          <div className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3>Classement kilométrage</h3>
                <p>Les unités les plus sollicitées</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={filteredTrackers.map((tracker) => ({ name: tracker.label, mileage: tracker.latestDayMileage }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
                <XAxis dataKey="name" stroke="#8da2c0" />
                <YAxis stroke="#8da2c0" />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
                <Bar dataKey="mileage" fill="#3b82f6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Répartition connexions</h3>
                <p>Flotte globale</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={connectionChart} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={4}>
                  {connectionChart.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="dashboard-grid second-row">
          <div className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3>Trackers & chauffeurs</h3>
                <p>Liste filtrable et exploitable</p>
              </div>
            </div>
            <div className="tracker-list">
              {filteredTrackers.map((tracker) => (
                <button key={tracker.id} className="tracker-card" onClick={() => setSelectedTrackerId(tracker.id)}>
                  <div className="tracker-topline">
                    <strong>{tracker.label}</strong>
                    <span className="status-pill" style={{ background: `${tracker.statusColor}22`, color: tracker.statusColor }}>
                      {tracker.state?.connection_status || 'unknown'}
                    </span>
                  </div>
                  <p>{tracker.employeeName}</p>
                  <div className="tracker-meta">
                    <span>{tracker.latestDayMileage} km</span>
                    <span>{tracker.state?.gps?.speed ?? 0} km/h</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel alerts-panel">
            <div className="panel-header">
              <div>
                <h3>Top risques</h3>
                <p>Priorité terrain</p>
              </div>
            </div>
            <div className="alerts-list">
              {riskRanking.map((tracker) => (
                <div key={tracker.id} className="alert-row">
                  <div className="alert-icon"><ShieldAlert size={16} /></div>
                  <div>
                    <strong>{tracker.label}</strong>
                    <p>{tracker.employeeName}</p>
                    <span>Score risque: {tracker.riskScore} · Speedups: {tracker.eventCounts.speedup || 0}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Événements critiques récents</h3>
              <p>Speedups, stationnements excessifs, signaux importants</p>
            </div>
          </div>
          <div className="events-table">
            {importantEvents.map((event) => (
              <div key={`${event.tracker_id}-${event.time}-${event.event}`} className="event-row">
                <div><strong>{event.label || event.extra?.tracker_label}</strong></div>
                <div>{event.event}</div>
                <div>{event.chauffeur || event.extra?.employee_full_name || 'N/A'}</div>
                <div>{event.message}</div>
                <div>{event.address}</div>
                <div>{new Date(event.time).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function StatCard({ icon, label, value, helper }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </div>
  )
}

function DetailItem({ icon, label, value }) {
  return (
    <div className="detail-item">
      <div className="detail-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

export default App
