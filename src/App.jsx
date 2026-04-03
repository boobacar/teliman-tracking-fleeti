import { useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AlertTriangle, Battery, Gauge, MapPin, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fallbackEvents } from './data/mock'
import { loadFleetData } from './lib/fleeti'
import { useAutoRefresh } from './hooks'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { MapPage } from './pages/MapPage'
import { TrackersPage } from './pages/TrackersPage'
import { DriversPage } from './pages/DriversPage'
import { AlertsPage } from './pages/AlertsPage'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const scoreRisk = (tracker) => (tracker.eventCounts.speedup || 0) * 4 + (tracker.eventCounts.excessive_parking || 0) * 2 + ((tracker.state.battery_level || 100) < 20 ? 5 : 0)
const statusColor = (status) => status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : status === 'offline' ? '#ef4444' : '#64748b'

function App() {
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTrackerId, setSelectedTrackerId] = useState(3488326)

  const refreshData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDataset(await loadFleetData())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshData() }, [refreshData])
  useAutoRefresh(refreshData, 90000)

  const enrichedTrackers = useMemo(() => {
    const employees = Object.fromEntries((dataset?.employees ?? []).map((e) => [e.tracker_id, e]))
    return (dataset?.trackers ?? []).map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = dataset?.mileage?.[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const events = (dataset?.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const eventCounts = events.reduce((acc, event) => ({ ...acc, [event.event]: (acc[event.event] || 0) + 1 }), {})
      const base = {
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
      return { ...base, riskScore: scoreRisk(base) }
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
    totalMileage: Math.round(enrichedTrackers.reduce((a, t) => a + (t.latestDayMileage || 0), 0)),
  }

  const riskRanking = [...enrichedTrackers].sort((a, b) => b.riskScore - a.riskScore)
  const topDrivers = riskRanking.slice(0, 5).map((tracker) => ({ name: tracker.employeeName, tracker: tracker.label, mileage: tracker.latestDayMileage, risk: tracker.riskScore }))
  const connectionChart = [
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]
  const executiveCards = [
    { title: 'Kilométrage total', value: `${stats.totalMileage} km`, helper: 'activité consolidée du jour' },
    { title: 'Risque moyen', value: `${Math.round(riskRanking.reduce((a, t) => a + t.riskScore, 0) / Math.max(riskRanking.length, 1))}`, helper: 'score global flotte' },
    { title: 'Alertes critiques', value: `${importantEvents.length}`, helper: 'événements surveillés' },
    { title: 'Trackers offline', value: `${stats.offline}`, helper: 'unités à vérifier' },
  ]

  return (
    <Layout loading={loading} refreshData={refreshData} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dataset={dataset}>
      {error && <div className="error-banner">{error}</div>}
      <Routes>
        <Route path="/" element={<DashboardPage filteredTrackers={filteredTrackers} stats={stats} connectionChart={connectionChart} riskRanking={riskRanking} topDrivers={topDrivers} executiveCards={executiveCards} />} />
        <Route path="/map" element={<MapPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
        <Route path="/trackers" element={<TrackersPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
        <Route path="/drivers" element={<DriversPage filteredTrackers={filteredTrackers} />} />
        <Route path="/alerts" element={<AlertsPage importantEvents={importantEvents} />} />
      </Routes>

      <section className="dashboard-grid premium-grid bottom-grid">
        <div className="panel detail-panel"><div className="panel-header"><div><h3>Fiche unité</h3><p>Lecture rapide</p></div></div>{selectedTracker ? <><div className="detail-grid"><DetailItem icon={<Users size={16} />} label="Chauffeur" value={selectedTracker.employeeName} /><DetailItem icon={<MapPin size={16} />} label="Position" value={`${selectedTracker.state?.gps?.location?.lat ?? '-'}, ${selectedTracker.state?.gps?.location?.lng ?? '-'}`} /><DetailItem icon={<Battery size={16} />} label="Batterie" value={`${selectedTracker.state?.battery_level ?? '-'}%`} /><DetailItem icon={<Gauge size={16} />} label="Vitesse" value={`${selectedTracker.state?.gps?.speed ?? 0} km/h`} /></div><div className="mini-chart-wrap"><ResponsiveContainer width="100%" height={180}><AreaChart data={Object.entries(selectedTracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))}><defs><linearGradient id="mileageFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#243042" /><XAxis dataKey="day" stroke="#8da2c0" /><YAxis stroke="#8da2c0" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /><Area type="monotone" dataKey="mileage" stroke="#60a5fa" fill="url(#mileageFill)" /></AreaChart></ResponsiveContainer></div></> : <p>Aucune unité sélectionnée.</p>}</div>
        <div className="panel"><div className="panel-header"><div><h3>Feed prioritaire</h3><p>Derniers signaux à surveiller</p></div></div><div className="alerts-list">{importantEvents.slice(0, 6).map((event) => <div key={`${event.tracker_id}-${event.time}`} className="alert-row"><div className="alert-icon"><AlertTriangle size={16} /></div><div><strong>{event.label || event.extra?.tracker_label}</strong><p>{event.message}</p><span>{new Date(event.time).toLocaleString()}</span></div></div>)}</div></div>
      </section>
    </Layout>
  )
}

function DetailItem({ icon, label, value }) { return <div className="detail-item"><div className="detail-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div> }

export default App
