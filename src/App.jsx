import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fallbackEvents } from './data/mock'
import { loadFleetData } from './lib/fleeti'
import { useAutoRefresh } from './hooks'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const TrackersPage = lazy(() => import('./pages/TrackersPage').then((module) => ({ default: module.TrackersPage })))
const DriversPage = lazy(() => import('./pages/DriversPage').then((module) => ({ default: module.DriversPage })))
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const TrackerDetailPage = lazy(() => import('./pages/TrackerDetailPage').then((module) => ({ default: module.TrackerDetailPage })))

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
  const [reports, setReports] = useState({ summary: {}, rows: [] })

  const refreshData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const fleet = await loadFleetData()
      setDataset(fleet)
      try {
        const reportsPayload = await import('./lib/fleeti').then((m) => m.loadReports())
        setReports(reportsPayload)
      } catch {
        setReports({ summary: {}, rows: [] })
      }
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
  const isEmptySearch = !loading && !error && filteredTrackers.length === 0

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
  const offlineTrackers = enrichedTrackers.filter((tracker) => tracker.state.connection_status === 'offline')
  const anomalyTrackers = [...enrichedTrackers].filter((tracker) => tracker.events.length > 3 || tracker.riskScore > 10).sort((a, b) => b.riskScore - a.riskScore)
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
  const priorityActions = [
    { label: 'Vérifier offline', value: offlineTrackers[0]?.label || 'Aucune unité', route: offlineTrackers[0] ? `/tracker/${offlineTrackers[0].id}` : '/trackers' },
    { label: 'Suivre top risque', value: riskRanking[0]?.label || 'Aucune unité', route: riskRanking[0] ? `/tracker/${riskRanking[0].id}` : '/analytics' },
    { label: 'Traiter alerte', value: importantEvents[0]?.label || importantEvents[0]?.extra?.tracker_label || 'Aucune alerte', route: importantEvents[0] ? `/tracker/${importantEvents[0].tracker_id}` : '/alerts' },
  ]

  return (
    <Layout loading={loading} refreshData={refreshData} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dataset={dataset}>
      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="info-banner">Actualisation des données flotte en cours...</div>}
      {isEmptySearch && <div className="empty-banner">Aucun résultat trouvé. Essaie un autre tracker, chauffeur ou filtre.</div>}
      <Suspense fallback={<div className="info-banner">Chargement de la vue…</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage filteredTrackers={filteredTrackers} stats={stats} connectionChart={connectionChart} riskRanking={riskRanking} topDrivers={topDrivers} executiveCards={executiveCards} offlineTrackers={offlineTrackers} anomalyTrackers={anomalyTrackers} />} />
          <Route path="/map" element={<MapPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/trackers" element={<TrackersPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/drivers" element={<DriversPage filteredTrackers={filteredTrackers} />} />
          <Route path="/alerts" element={<AlertsPage importantEvents={importantEvents} />} />
          <Route path="/analytics" element={<AnalyticsPage filteredTrackers={filteredTrackers} importantEvents={importantEvents} />} />
          <Route path="/reports" element={<ReportsPage reports={reports} />} />
          <Route path="/tracker/:id" element={<TrackerDetailPage enrichedTrackers={enrichedTrackers} />} />
        </Routes>
      </Suspense>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel">
          <div className="panel-header"><div><h3>Priorités du jour</h3><p>Raccourcis opérateur immédiats</p></div></div>
          <div className="driver-ranking">{priorityActions.map((action) => <button key={action.label} className="driver-rank-row event-button" onClick={() => window.location.assign(action.route)}><strong>→</strong><div><span>{action.label}</span><small>{action.value}</small></div></button>)}</div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h3>Workflow rapide</h3><p>Chemins métier les plus utilisés</p></div></div>
          <div className="driver-ranking"><button className="driver-rank-row event-button" onClick={() => window.location.assign('/alerts')}><strong>1</strong><div><span>Contrôler alertes</span><small>centre critique</small></div></button><button className="driver-rank-row event-button" onClick={() => window.location.assign('/map')}><strong>2</strong><div><span>Ouvrir la carte</span><small>vision terrain</small></div></button><button className="driver-rank-row event-button" onClick={() => window.location.assign('/trackers')}><strong>3</strong><div><span>Consulter trackers</span><small>inventaire flotte</small></div></button></div>
        </div>
      </section>

      <section className="command-center-grid">
        <div className="panel command-center-panel">
          <div className="panel-header"><div><h3>Centre de pilotage</h3><p>Unité prioritaire, action rapide et résumé opérationnel</p></div></div>
          {selectedTracker ? <div className="command-center-card"><div className="command-center-top"><div><strong>{selectedTracker.label}</strong><p>{selectedTracker.employeeName}</p></div><span className="status-pill" style={{ background: `${selectedTracker.statusColor}22`, color: selectedTracker.statusColor }}>{selectedTracker.state?.connection_status || 'unknown'}</span></div><div className="command-center-metrics"><div><span>Km</span><strong>{selectedTracker.latestDayMileage}</strong></div><div><span>Risque</span><strong>{selectedTracker.riskScore}</strong></div><div><span>Vitesse</span><strong>{selectedTracker.state?.gps?.speed ?? 0}</strong></div><div><span>Events</span><strong>{selectedTracker.events.length}</strong></div></div><div className="command-center-actions"><button className="primary-btn small-btn" onClick={() => window.location.assign(`/tracker/${selectedTracker.id}`)}>Voir la fiche</button><button className="ghost-btn" onClick={() => window.location.assign('/map')}>Ouvrir la carte</button></div></div> : <p>Aucune unité sélectionnée.</p>}
        </div>
        <div className="panel signal-panel"><div className="panel-header"><div><h3>Signaux critiques</h3><p>Les 4 événements les plus importants</p></div></div><div className="signal-stack">{importantEvents.slice(0, 4).map((event) => <button key={`${event.tracker_id}-${event.time}`} className="signal-card" onClick={() => window.location.assign(`/tracker/${event.tracker_id}`)}><div className="signal-card-top"><strong>{event.label || event.extra?.tracker_label}</strong><span>{event.event}</span></div><p>{event.message}</p><small>{new Date(event.time).toLocaleString()}</small></button>)}</div></div>
        <div className="panel action-panel"><div className="panel-header"><div><h3>Résumé actionnable</h3><p>Ce qu’un fleet manager doit voir vite</p></div></div><div className="action-list"><div className="action-row"><span>Trackers offline</span><strong>{stats.offline}</strong></div><div className="action-row"><span>Top risque</span><strong>{riskRanking[0]?.label || '-'}</strong></div><div className="action-row"><span>Top chauffeur</span><strong>{topDrivers[0]?.name || '-'}</strong></div><div className="action-row"><span>Alertes critiques</span><strong>{importantEvents.length}</strong></div></div></div>
      </section>
    </Layout>
  )
}

export default App
