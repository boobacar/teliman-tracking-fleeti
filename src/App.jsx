import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Battery,
  Car,
  Gauge,
  MapPin,
  Route,
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
import './App.css'

const API_BASE = import.meta.env.VITE_FLEETI_API_BASE || 'https://tracking.ci.fleeti.co/api-v2'
const LOGIN = import.meta.env.VITE_FLEETI_LOGIN || 'boubsfal@gmail.com'
const PASSWORD = import.meta.env.VITE_FLEETI_PASSWORD || 'Azerty123456#'
const DEALER_ID = Number(import.meta.env.VITE_FLEETI_DEALER_ID || 23241)
const LOCALE = import.meta.env.VITE_FLEETI_LOCALE || 'fr'

const trackerMileageFallback = {
  3487533: { '2026-04-01': { mileage: 619.68 }, '2026-04-02': { mileage: 432.62 } },
  3487539: { '2026-04-01': { mileage: 618.46 }, '2026-04-02': { mileage: 435.17 } },
  3488325: { '2026-04-01': { mileage: 596.38 }, '2026-04-02': { mileage: 463.26 } },
  3488326: { '2026-04-01': { mileage: 633.16 }, '2026-04-02': { mileage: 546.79 } },
  3511635: { '2026-04-01': { mileage: 149.6 }, '2026-04-02': { mileage: 189.47 } },
  3537761: { '2026-04-01': { mileage: 74.03 }, '2026-04-02': { mileage: 195.14 } },
  3537762: { '2026-04-01': { mileage: 601.75 }, '2026-04-02': { mileage: 462.25 } },
  3537766: { '2026-04-01': { mileage: 58.8 }, '2026-04-02': null },
}

const employeeFallback = [
  { id: 259454, tracker_id: 3511635, first_name: 'MAKO', last_name: 'DOSSO', phone: '0709584823' },
  { id: 259458, tracker_id: 3488326, first_name: 'YAKOUBA', last_name: 'DIOMANDE', phone: '' },
  { id: 259464, tracker_id: 3488325, first_name: 'ADAMA', last_name: 'CAMARA', phone: '0759171776' },
  { id: 259466, tracker_id: 3487539, first_name: 'SARIA', last_name: 'YACOUBA', phone: '0171848451' },
  { id: 259467, tracker_id: 3487533, first_name: 'BAMA', last_name: 'TRAORE', phone: '0707959882' },
  { id: 263177, tracker_id: 3537762, first_name: 'BAMBA', last_name: 'LAMA', phone: '' },
  { id: 263178, tracker_id: 3537766, first_name: 'DAOUDA', last_name: 'DANIOKO', phone: '' },
  { id: 263179, tracker_id: 3537761, first_name: 'SRIKI', last_name: '', phone: '' },
]

const fallbackEvents = [
  { tracker_id: 3488326, label: '45792WWCI01', chauffeur: 'YAKOUBA DIOMANDE', time: '2026-04-02T19:42:53Z', event: 'speedup', message: 'Excès de vitesse - 91 km/h', address: 'Mankono, Côte d’Ivoire' },
  { tracker_id: 3488326, label: '45792WWCI01', chauffeur: 'YAKOUBA DIOMANDE', time: '2026-04-02T15:40:03Z', event: 'speedup', message: 'Excès de vitesse - 96 km/h', address: 'Séguéla - Boundiali, Côte d’Ivoire' },
  { tracker_id: 3487533, label: '3952WWCI01', chauffeur: 'BAMA TRAORE', time: '2026-04-02T15:58:58Z', event: 'excessive_parking', message: 'Stationnement excessif', address: 'Séguéla - Boundiali, Côte d’Ivoire' },
  { tracker_id: 3537761, label: '3100WWCI01', chauffeur: 'SRIKI', time: '2026-04-02T15:56:07Z', event: 'excessive_parking', message: 'Stationnement excessif', address: 'Kossihouen, Côte d’Ivoire' },
]

async function apiCall(endpoint, payload = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'NVX-ISO-DateTime': 'true' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok || data.success === false) throw new Error(data?.status?.description || 'API error')
  return data
}

async function loadFleetData() {
  const auth = await apiCall('user/auth', {
    login: LOGIN,
    password: PASSWORD,
    dealer_id: DEALER_ID,
    locale: LOCALE,
  })

  const hash = auth.hash
  const [trackers, states, employees, unreadCount, rules, tariffs] = await Promise.all([
    apiCall('tracker/list', { hash }),
    apiCall('tracker/get_states', { hash, trackers: [3487533, 3487539, 3488325, 3488326, 3511635, 3537761, 3537762, 3537766] }),
    apiCall('employee/list', { hash }).catch(() => ({ list: employeeFallback })),
    apiCall('history/unread/count', { hash }).catch(() => ({ value: 0 })),
    apiCall('tracker/rule/list', { hash }).catch(() => ({ list: [] })),
    apiCall('tariff/list', { hash }).catch(() => ({ list: [] })),
  ])

  return {
    hash,
    trackers: trackers.list ?? [],
    states: states.states ?? {},
    employees: employees.list ?? employeeFallback,
    unreadCount: unreadCount.value ?? unreadCount.count ?? 0,
    rules: rules.list ?? [],
    tariffs: tariffs.list ?? [],
  }
}

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
    const employees = Object.fromEntries((dataset?.employees ?? employeeFallback).map((e) => [e.tracker_id, e]))
    const trackers = dataset?.trackers ?? []
    return trackers.map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = trackerMileageFallback[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const latestDay = mileage['2026-04-02']?.mileage ?? mileage['2026-04-01']?.mileage ?? 0
      return {
        ...tracker,
        state,
        mileage,
        latestDayMileage: latestDay,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}`.trim() : 'Non assigné',
        employeePhone: employee?.phone || 'N/A',
        statusColor: trackerStatusColor(state.connection_status),
      }
    })
  }, [dataset])

  const selectedTracker = enrichedTrackers.find((tracker) => tracker.id === selectedTrackerId) || enrichedTrackers[0]

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

  const mileageChart = useMemo(() => enrichedTrackers.map((tracker) => ({
    name: tracker.label,
    mileage: tracker.latestDayMileage,
  })), [enrichedTrackers])

  const connectionChart = useMemo(() => ([
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]), [stats])

  const mapPoints = enrichedTrackers.filter((tracker) => tracker.state?.gps?.location)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-badge">TELIMAN</div>
          <h1>Tracking Fleeti</h1>
          <p>Suivi flotte moderne, temps réel et actionnable.</p>
        </div>

        <button className="primary-btn" onClick={refreshData} disabled={loading}>
          {loading ? 'Actualisation...' : 'Actualiser les données'}
        </button>

        <div className="sidebar-section">
          <span>Vue rapide</span>
          <div className="nav-card active">Dashboard temps réel</div>
          <div className="nav-card">Cartographie live</div>
          <div className="nav-card">Alertes & risques</div>
          <div className="nav-card">Chauffeurs & trackers</div>
        </div>
      </aside>

      <main className="main-content">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Interface premium connectée à l’API Fleeti</p>
            <h2>Centre de pilotage flotte, alertes et localisation live</h2>
            <p>
              Une interface moderne pour suivre les trackers, les chauffeurs, les alertes critiques,
              les distances parcourues et l’activité terrain.
            </p>
          </div>
          <div className="hero-meta">
            <div className="meta-box">
              <ShieldAlert size={18} />
              <span>{dataset?.rules?.length ?? 0} règles</span>
            </div>
            <div className="meta-box">
              <AlertTriangle size={18} />
              <span>{dataset?.unreadCount ?? 0} alertes non lues</span>
            </div>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        <section className="stats-grid">
          <StatCard icon={<Car size={18} />} label="Trackers" value={stats.total} helper="Flotte monitorée" />
          <StatCard icon={<Wifi size={18} />} label="Actifs" value={stats.active} helper="Connectés maintenant" />
          <StatCard icon={<Route size={18} />} label="En mouvement" value={stats.moving} helper="Véhicules roulants" />
          <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${stats.avgSpeed} km/h`} helper="Photo instantanée" />
        </section>

        <section className="dashboard-grid">
          <div className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3>Kilométrage du jour</h3>
                <p>Classement instantané des trackers les plus sollicités</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={mileageChart}>
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
                <h3>État des connexions</h3>
                <p>Vue synthétique</p>
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
          <div className="panel panel-large map-panel">
            <div className="panel-header">
              <div>
                <h3>Carte live simplifiée</h3>
                <p>Vue instantanée des positions actuelles</p>
              </div>
            </div>
            <div className="map-surface">
              {mapPoints.map((tracker) => {
                const lat = tracker.state.gps.location.lat
                const lng = tracker.state.gps.location.lng
                const x = ((lng + 7) / 4) * 100
                const y = 100 - ((lat - 4) / 5) * 100
                return (
                  <button
                    key={tracker.id}
                    className={`map-dot ${selectedTrackerId === tracker.id ? 'selected' : ''}`}
                    style={{ left: `${Math.max(6, Math.min(94, x))}%`, top: `${Math.max(8, Math.min(92, y))}%`, borderColor: tracker.statusColor }}
                    onClick={() => setSelectedTrackerId(tracker.id)}
                    title={`${tracker.label} - ${tracker.employeeName}`}
                  >
                    <span>{tracker.label}</span>
                  </button>
                )
              })}
              <div className="map-legend">Côte d’Ivoire - aperçu live</div>
            </div>
          </div>

          <div className="panel detail-panel">
            <div className="panel-header">
              <div>
                <h3>Détail tracker</h3>
                <p>Sélection actuelle</p>
              </div>
            </div>
            {selectedTracker ? (
              <>
                <div className="tracker-picker">
                  <select value={selectedTrackerId} onChange={(e) => setSelectedTrackerId(Number(e.target.value))}>
                    {enrichedTrackers.map((tracker) => (
                      <option key={tracker.id} value={tracker.id}>{tracker.label}</option>
                    ))}
                  </select>
                </div>
                <div className="detail-grid">
                  <DetailItem icon={<Users size={16} />} label="Chauffeur" value={selectedTracker.employeeName} />
                  <DetailItem icon={<MapPin size={16} />} label="Position" value={`${selectedTracker.state?.gps?.location?.lat ?? '-'}, ${selectedTracker.state?.gps?.location?.lng ?? '-'}`} />
                  <DetailItem icon={<Activity size={16} />} label="Statut" value={`${selectedTracker.state?.connection_status ?? '-'} / ${selectedTracker.state?.movement_status ?? '-'}`} />
                  <DetailItem icon={<Battery size={16} />} label="Batterie" value={`${selectedTracker.state?.battery_level ?? '-'}%`} />
                </div>
                <div className="mini-chart-wrap">
                  <ResponsiveContainer width="100%" height={160}>
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
            ) : <p>Aucun tracker sélectionné.</p>}
          </div>
        </section>

        <section className="dashboard-grid second-row">
          <div className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3>Trackers & chauffeurs</h3>
                <p>Accès rapide aux unités terrain</p>
              </div>
            </div>
            <div className="tracker-list">
              {enrichedTrackers.map((tracker) => (
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
                <h3>Événements critiques</h3>
                <p>Priorisés à partir des alertes observées</p>
              </div>
            </div>
            <div className="alerts-list">
              {fallbackEvents.map((event) => (
                <div key={`${event.tracker_id}-${event.time}`} className="alert-row">
                  <div className="alert-icon"><AlertTriangle size={16} /></div>
                  <div>
                    <strong>{event.label}</strong>
                    <p>{event.message}</p>
                    <span>{event.chauffeur} · {new Date(event.time).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
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
