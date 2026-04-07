import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fallbackEvents } from './data/mock'
import { loadDeliveryOrders, loadDeliveryOrdersSummary, loadFleetData, loadMasterData } from './lib/fleeti'
import { useAutoRefresh } from './hooks'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const TrackersPage = lazy(() => import('./pages/TrackersPage').then((module) => ({ default: module.TrackersPage })))
const DriversPage = lazy(() => import('./pages/DriversPage').then((module) => ({ default: module.DriversPage })))
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const DeliveryOrdersPage = lazy(() => import('./pages/DeliveryOrdersPage').then((module) => ({ default: module.DeliveryOrdersPage })))
const DeliveryOrderDetailPage = lazy(() => import('./pages/DeliveryOrderDetailPage').then((module) => ({ default: module.DeliveryOrderDetailPage })))
const TrackerDetailPage = lazy(() => import('./pages/TrackerDetailPage').then((module) => ({ default: module.TrackerDetailPage })))
const DataPage = lazy(() => import('./pages/DataPage').then((module) => ({ default: module.DataPage })))

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const scoreRisk = (tracker) => (tracker.eventCounts.speedup || 0) * 4 + (tracker.eventCounts.excessive_parking || 0) * 2 + ((tracker.state.battery_level || 100) < 20 ? 5 : 0)
const statusColor = (status) => status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : status === 'offline' ? '#ef4444' : '#64748b'

function pickLatestMileage(mileageByDay = {}, preferredKeys = []) {
  for (const key of preferredKeys) {
    const value = Number(mileageByDay?.[key]?.mileage)
    if (Number.isFinite(value) && value > 0) return value
  }

  const datedEntries = Object.entries(mileageByDay)
    .map(([key, row]) => ({
      key,
      mileage: Number(row?.mileage),
      ts: Date.parse(`${key}T00:00:00Z`),
    }))
    .filter((entry) => Number.isFinite(entry.mileage))
    .sort((a, b) => b.ts - a.ts)

  const latestPositive = datedEntries.find((entry) => entry.mileage > 0)
  if (latestPositive) return latestPositive.mileage

  return datedEntries[0]?.mileage || 0
}

function App() {
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTrackerId, setSelectedTrackerId] = useState(3488326)
  const [reports, setReports] = useState({ summary: {}, rows: [] })
  const [deliveryOrders, setDeliveryOrders] = useState([])
  const [deliveryOrdersSummary, setDeliveryOrdersSummary] = useState({ total: 0, active: 0, delivered: 0, byTruck: {} })
  const [masterData, setMasterData] = useState({ clients: [], goods: [] })

  const refreshData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const fleet = await loadFleetData()
      setDataset(fleet)
      try {
        const module = await import('./lib/fleeti')
        const reportsPayload = await module.loadReports()
        setReports(reportsPayload)
      } catch {
        setReports({ summary: {}, rows: [] })
        setDeliveryOrders([])
        setDeliveryOrdersSummary({ total: 0, active: 0, delivered: 0, byTruck: {} })
        setMasterData({ clients: [], goods: [] })
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
    const preferredMileageKeys = [dataset?.dateKeys?.todayKey, dataset?.dateKeys?.yesterdayKey].filter(Boolean)

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
        latestDayMileage: pickLatestMileage(mileage, preferredMileageKeys),
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

  return (
    <Layout loading={loading} refreshData={refreshData} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} dataset={dataset}>
      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="info-banner">Actualisation des données flotte en cours...</div>}
      {isEmptySearch && <div className="empty-banner">Aucun résultat trouvé. Essaie un autre tracker, chauffeur ou filtre.</div>}
      <Suspense fallback={<div className="info-banner">Chargement de la vue…</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage filteredTrackers={filteredTrackers} stats={stats} connectionChart={connectionChart} riskRanking={riskRanking} topDrivers={topDrivers} executiveCards={executiveCards} offlineTrackers={offlineTrackers} anomalyTrackers={anomalyTrackers} />} />
          <Route path="/map" element={<MapPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} deliveryOrders={deliveryOrders} />} />
          <Route path="/trackers" element={<TrackersPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/drivers" element={<DriversPage filteredTrackers={filteredTrackers} />} />
          <Route path="/alerts" element={<AlertsPage importantEvents={importantEvents} />} />
          <Route path="/analytics" element={<AnalyticsPage filteredTrackers={filteredTrackers} importantEvents={importantEvents} />} />
          <Route path="/reports" element={<ReportsPage reports={reports} />} />
          <Route path="/delivery-orders" element={<DeliveryOrdersPage deliveryOrders={deliveryOrders} deliveryOrdersSummary={deliveryOrdersSummary} enrichedTrackers={enrichedTrackers} refreshData={refreshData} setDeliveryOrders={setDeliveryOrders} setDeliveryOrdersSummary={setDeliveryOrdersSummary} masterData={masterData} setMasterData={setMasterData} />} />
          <Route path="/delivery-order/:id" element={<DeliveryOrderDetailPage deliveryOrders={deliveryOrders} refreshData={refreshData} />} />
          <Route path="/tracker/:id" element={<TrackerDetailPage enrichedTrackers={enrichedTrackers} deliveryOrders={deliveryOrders} />} />
          <Route path="/data" element={<DataPage />} />
        </Routes>
      </Suspense>

    </Layout>
  )
}

export default App
