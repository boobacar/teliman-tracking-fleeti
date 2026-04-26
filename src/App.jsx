import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fallbackEvents } from './data/mock'
import { getCurrentUser, loadDeliveryOrders, loadDeliveryOrdersSummary, loadFleetData, loadMasterData, logout } from './lib/fleeti'
import { useAutoRefresh } from './hooks'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const FleetPage = lazy(() => import('./pages/FleetPage').then((module) => ({ default: module.FleetPage })))
const CamerasPage = lazy(() => import('./pages/CamerasPage').then((module) => ({ default: module.CamerasPage })))
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const DriversReportPage = lazy(() => import('./pages/DriversReportPage').then((module) => ({ default: module.DriversReportPage })))
const TripsReportPage = lazy(() => import('./pages/TripsReportPage').then((module) => ({ default: module.TripsReportPage })))
const DeliveryOrdersPage = lazy(() => import('./pages/DeliveryOrdersPage').then((module) => ({ default: module.DeliveryOrdersPage })))
const DeliveryOrderDetailPage = lazy(() => import('./pages/DeliveryOrderDetailPage').then((module) => ({ default: module.DeliveryOrderDetailPage })))
const FuelVouchersPage = lazy(() => import('./pages/FuelVouchersPage').then((module) => ({ default: module.FuelVouchersPage })))
const FuelVoucherDetailPage = lazy(() => import('./pages/FuelVoucherDetailPage').then((module) => ({ default: module.FuelVoucherDetailPage })))
const TrackerDetailPage = lazy(() => import('./pages/TrackerDetailPage').then((module) => ({ default: module.TrackerDetailPage })))
const DataPage = lazy(() => import('./pages/DataPage').then((module) => ({ default: module.DataPage })))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

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
  const [refreshToastVisible, setRefreshToastVisible] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedTrackerId, setSelectedTrackerId] = useState(3488326)
  const [reports, setReports] = useState({ summary: {}, rows: [] })
  const [deliveryOrders, setDeliveryOrders] = useState([])
  const [deliveryOrdersSummary, setDeliveryOrdersSummary] = useState({ total: 0, active: 0, delivered: 0, byTruck: {} })
  const [masterData, setMasterData] = useState({ clients: [], goods: [], destinations: [], suppliers: [], manualTrackers: [] })
  const [authLoading, setAuthLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState(null)

  const refreshData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const fleet = await loadFleetData()
      setDataset(fleet)
      try {
        const module = await import('./lib/fleeti')
        const [reportsPayload, ordersPayload, ordersSummaryPayload, masterDataPayload] = await Promise.all([
          module.loadReports().catch(() => ({ summary: {}, rows: [] })),
          module.loadDeliveryOrders().catch(() => ({ items: [] })),
          module.loadDeliveryOrdersSummary().catch(() => ({ total: 0, active: 0, delivered: 0, byTruck: {} })),
          module.loadMasterData().catch(() => ({ clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] })),
        ])
        setReports(reportsPayload)
        setDeliveryOrders(ordersPayload?.items || [])
        setDeliveryOrdersSummary(ordersSummaryPayload || { total: 0, active: 0, delivered: 0, byTruck: {} })
        setMasterData(masterDataPayload || { clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] })
      } catch {
        setReports({ summary: {}, rows: [] })
        setDeliveryOrders([])
        setDeliveryOrdersSummary({ total: 0, active: 0, delivered: 0, byTruck: {} })
        setMasterData({ clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] })
      }
    } catch (err) {
      const message = err?.message || 'Chargement impossible. Veuillez vérifier votre session.'
      setError(message === 'Failed to fetch' ? 'Impossible de joindre le serveur. Vérifiez la configuration réseau ou CORS.' : message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const user = await getCurrentUser()
        if (!cancelled) setCurrentUser(user)
      } catch {
        if (!cancelled) setCurrentUser(null)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (currentUser) refreshData()
  }, [currentUser, refreshData])

  useEffect(() => {
    let hideTimer
    if (loading) {
      setRefreshToastVisible(true)
    } else if (refreshToastVisible) {
      hideTimer = setTimeout(() => setRefreshToastVisible(false), 700)
    }
    return () => {
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [loading, refreshToastVisible])

  useAutoRefresh(currentUser ? refreshData : null, 90000)

  const enrichedTrackers = useMemo(() => {
    const normalizeKey = (value) => String(value || '').trim().toUpperCase()

    const employees = {}
    for (const employee of (dataset?.employees ?? [])) {
      const trackerIds = [
        employee?.tracker_id,
        employee?.trackerId,
        ...(Array.isArray(employee?.tracker_ids) ? employee.tracker_ids : []),
        ...(Array.isArray(employee?.trackerIds) ? employee.trackerIds : []),
      ]
        .map((value) => Number(value))
        .filter(Number.isFinite)
      for (const trackerId of trackerIds) {
        employees[trackerId] = employee
      }
    }

    const fallbackDriverByTrackerId = {}
    const fallbackDriverByLabel = {}

    for (const row of (deliveryOrders ?? [])) {
      const driver = String(row?.driver || '').trim()
      if (!driver) continue
      const trackerId = Number(row?.trackerId)
      if (Number.isFinite(trackerId) && !fallbackDriverByTrackerId[trackerId]) fallbackDriverByTrackerId[trackerId] = driver
      const labelKey = normalizeKey(row?.truckLabel)
      if (labelKey && !fallbackDriverByLabel[labelKey]) fallbackDriverByLabel[labelKey] = driver
    }

    for (const row of (masterData?.manualTrackers ?? [])) {
      const driver = String(row?.driver || '').trim()
      if (!driver) continue
      const trackerId = Number(row?.id)
      if (Number.isFinite(trackerId) && !fallbackDriverByTrackerId[trackerId]) fallbackDriverByTrackerId[trackerId] = driver
      const labelKey = normalizeKey(row?.label)
      if (labelKey && !fallbackDriverByLabel[labelKey]) fallbackDriverByLabel[labelKey] = driver
    }

    const preferredMileageKeys = [dataset?.dateKeys?.todayKey, dataset?.dateKeys?.yesterdayKey].filter(Boolean)

    return (dataset?.trackers ?? []).map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = dataset?.mileage?.[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const events = (dataset?.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const eventCounts = events.reduce((acc, event) => ({ ...acc, [event.event]: (acc[event.event] || 0) + 1 }), {})
      const firstName = String(employee?.first_name || employee?.firstname || employee?.firstName || employee?.name || '').trim()
      const lastName = String(employee?.last_name || employee?.lastname || employee?.lastName || '').trim()
      const employeeNameFromApi = [firstName, lastName].filter(Boolean).join(' ').trim()
      const employeeName = employeeNameFromApi
        || fallbackDriverByTrackerId[Number(tracker.id)]
        || fallbackDriverByLabel[normalizeKey(tracker.label)]
        || 'Non assigné'
      const base = {
        ...tracker,
        state,
        mileage,
        employeeName,
        employeePhone: employee?.phone || employee?.mobile || employee?.tel || 'N/A',
        latestDayMileage: pickLatestMileage(mileage, preferredMileageKeys),
        events,
        eventCounts,
        statusColor: statusColor(state.connection_status),
      }
      return base
    })
  }, [dataset, deliveryOrders, masterData])

  const operationalTrackers = useMemo(() => {
    const manualTrackers = Array.isArray(masterData?.manualTrackers)
      ? masterData.manualTrackers
      : []

    const normalizedManual = manualTrackers
      .map((item, index) => {
        const id = Number(item?.id)
        const label = String(item?.label || '').trim()
        const driver = String(item?.driver || '').trim()
        if (!label || !driver) return null
        return {
          id: Number.isInteger(id) && id > 0 ? id : (9000000 + index + 1),
          label,
          employeeName: driver,
          employeePhone: 'N/A',
          state: {},
          mileage: {},
          latestDayMileage: 0,
          events: [],
          eventCounts: {},
          statusColor: statusColor('unknown'),
          source: 'manual',
        }
      })
      .filter(Boolean)

    const byId = new Map(enrichedTrackers.map((tracker) => [String(tracker.id), tracker]))
    for (const tracker of normalizedManual) {
      if (!byId.has(String(tracker.id))) byId.set(String(tracker.id), tracker)
    }
    return Array.from(byId.values())
  }, [enrichedTrackers, masterData])

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

  const priorityTrackers = [...enrichedTrackers].sort((a, b) => {
    const leftScore = (a.eventCounts.speedup || 0) + (a.eventCounts.excessive_parking || 0)
    const rightScore = (b.eventCounts.speedup || 0) + (b.eventCounts.excessive_parking || 0)
    if (leftScore !== rightScore) return rightScore - leftScore
    return (b.events.length || 0) - (a.events.length || 0)
  })
  const offlineTrackers = enrichedTrackers.filter((tracker) => tracker.state.connection_status === 'offline')
  const anomalyTrackers = [...enrichedTrackers].filter((tracker) => tracker.events.length > 3).sort((a, b) => b.events.length - a.events.length)
  const topDrivers = [...enrichedTrackers].sort((a, b) => b.latestDayMileage - a.latestDayMileage).slice(0, 5).map((tracker) => ({ name: tracker.employeeName, tracker: tracker.label, mileage: tracker.latestDayMileage, events: tracker.events.length }))
  const connectionChart = [
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]
  const executiveCards = [
    { title: 'Kilométrage total', value: `${stats.totalMileage} km`, helper: 'activité consolidée du jour' },
    { title: 'Événements suivis', value: `${importantEvents.length}`, helper: 'alertes critiques et surveillance' },
    { title: 'Alertes critiques', value: `${importantEvents.length}`, helper: 'événements surveillés' },
    { title: 'Trackers offline', value: `${stats.offline}`, helper: 'unités à vérifier' },
  ]

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #0f172a, #111827)', color: '#fff' }}>
        <div style={{ padding: 24, borderRadius: 18, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(6px)' }}>Vérification de session...</div>
      </div>
    )
  }
  if (!currentUser) {
    return (
      <Suspense fallback={<div className="info-banner">Chargement…</div>}>
        <LoginPage onLoggedIn={async (user) => {
          if (user) {
            setCurrentUser(user)
            return
          }
          const refreshedUser = await getCurrentUser()
          setCurrentUser(refreshedUser)
        }} />
      </Suspense>
    )
  }

  return (
    <Layout loading={loading} refreshData={refreshData} search={search} setSearch={setSearch} dataset={dataset} currentUser={currentUser} onLogout={() => { logout(); setCurrentUser(null) }}>
      {error && <div className="error-banner">{error}</div>}
      {refreshToastVisible && <div className={`refresh-toast${loading ? ' is-loading' : ''}`}>Actualisation des données flotte en cours...</div>}
      {isEmptySearch && <div className="empty-banner">Aucun résultat trouvé. Essaie un autre tracker, chauffeur ou filtre.</div>}
      <Suspense fallback={<div className="info-banner">Chargement de la vue…</div>}>
        <Routes>
          <Route path="/" element={<DashboardPage filteredTrackers={filteredTrackers} stats={stats} connectionChart={connectionChart} priorityTrackers={priorityTrackers} topDrivers={topDrivers} executiveCards={executiveCards} offlineTrackers={offlineTrackers} anomalyTrackers={anomalyTrackers} filter={filter} setFilter={setFilter} />} />
          <Route path="/map" element={<MapPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} deliveryOrders={deliveryOrders} />} />
          <Route path="/fleet" element={<FleetPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/cameras" element={<CamerasPage />} />
          <Route path="/trackers" element={<FleetPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/drivers" element={<FleetPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />} />
          <Route path="/alerts" element={<AlertsPage importantEvents={importantEvents} />} />
          <Route path="/analytics" element={<AnalyticsPage filteredTrackers={filteredTrackers} importantEvents={importantEvents} />} />
          <Route path="/reports" element={<ReportsPage reports={reports} />} />
          <Route path="/drivers-report" element={<DriversReportPage deliveryOrders={deliveryOrders} filteredTrackers={filteredTrackers} />} />
          <Route path="/trips-report" element={<TripsReportPage filteredTrackers={filteredTrackers} />} />
          <Route path="/delivery-orders" element={<DeliveryOrdersPage deliveryOrders={deliveryOrders} deliveryOrdersSummary={deliveryOrdersSummary} enrichedTrackers={operationalTrackers} refreshData={refreshData} setDeliveryOrders={setDeliveryOrders} setDeliveryOrdersSummary={setDeliveryOrdersSummary} masterData={masterData} setMasterData={setMasterData} />} />
          <Route path="/fuel-vouchers" element={<FuelVouchersPage enrichedTrackers={operationalTrackers} />} />
          <Route path="/fuel-voucher/:id" element={<FuelVoucherDetailPage enrichedTrackers={operationalTrackers} />} />
          <Route path="/delivery-order/:id" element={<DeliveryOrderDetailPage deliveryOrders={deliveryOrders} refreshData={refreshData} />} />
          <Route path="/tracker/:id" element={<TrackerDetailPage enrichedTrackers={operationalTrackers} deliveryOrders={deliveryOrders} />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/admin-users" element={<AdminUsersPage />} />
        </Routes>
      </Suspense>

    </Layout>
  )
}

export default App
