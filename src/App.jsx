import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import './App.css'
import { getCurrentUser, loadDeliveryOrders, loadDeliveryOrdersSummary, loadFleetData, loadMasterData, loadServiceStatus, logout, SERVICE_SUSPENSION_EVENT } from './lib/fleeti'
import { useAutoRefresh } from './hooks'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SkeletonPage } from './components/Skeleton'
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const FleetPage = lazy(() => import('./pages/FleetPage').then((module) => ({ default: module.FleetPage })))
const WhatsAppPage = lazy(() => import('./pages/WhatsAppPage').then((module) => ({ default: module.WhatsAppPage })))
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((module) => ({ default: module.AlertsPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const DriversReportPage = lazy(() => import('./pages/DriversReportPage').then((module) => ({ default: module.DriversReportPage })))
const TripsReportPage = lazy(() => import('./pages/TripsReportPage').then((module) => ({ default: module.TripsReportPage })))
const DeliveryOrdersPage = lazy(() => import('./pages/DeliveryOrdersPage').then((module) => ({ default: module.DeliveryOrdersPage })))
const DeliveryOrderDetailPage = lazy(() => import('./pages/DeliveryOrderDetailPage').then((module) => ({ default: module.DeliveryOrderDetailPage })))
const FuelVouchersPage = lazy(() => import('./pages/FuelVouchersPage').then((module) => ({ default: module.FuelVouchersPage })))
const FuelVoucherDetailPage = lazy(() => import('./pages/FuelVoucherDetailPage').then((module) => ({ default: module.FuelVoucherDetailPage })))
const OilChangesPage = lazy(() => import('./pages/OilChangesPage').then((module) => ({ default: module.OilChangesPage })))
const TrackerDetailPage = lazy(() => import('./pages/TrackerDetailPage').then((module) => ({ default: module.TrackerDetailPage })))
const DataPage = lazy(() => import('./pages/DataPage').then((module) => ({ default: module.DataPage })))
const GeofencesPage = lazy(() => import('./pages/GeofencesPage').then((module) => ({ default: module.GeofencesPage })))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))

const statusColor = (status) => status === 'active' ? '#22c55e' : status === 'idle' ? '#f59e0b' : status === 'offline' ? '#ef4444' : '#64748b'
function GlobalServerMessageBanner({ kind = 'serverError', loading = false, onRetry, onLogout }) {
  const copy = {
    suspended: ['impossible de joindre le serveur', ''],
    offline: ['Connexion indisponible', 'Vérifiez le réseau puis réessayez. Les données affichées peuvent être anciennes.'],
    timeout: ['Le serveur tarde à répondre', 'La demande a expiré. Réessayez dans un instant.'],
    sessionExpired: ['Session expirée', 'Reconnectez-vous pour continuer.'],
    serverError: ['Erreur serveur', 'Le serveur a rencontré un problème inattendu.'],
  }[kind] || ['Erreur de connexion', 'Réessayez dans un instant.']
  return (
    <section className="service-suspended-page" aria-live="assertive">
      <div className="error-banner service-suspended-banner">
        <AlertTriangle size={22} />
        <div>
          <strong>{copy[0]}</strong>
          {copy[1] ? <p>{loading ? 'Vérification en cours…' : copy[1]}</p> : null}
          <div className="table-actions server-state-actions">
            {kind !== 'sessionExpired' && <button type="button" className="primary-btn" onClick={onRetry} disabled={loading}>Réessayer</button>}
            <button type="button" className="ghost-btn" onClick={onLogout}>Déconnexion</button>
          </div>
        </div>
      </div>
    </section>
  )
}

function PermissionRoute({ user, permission, children }) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : []
  if (permission && !permissions.includes('*') && !permissions.includes(permission)) {
    return <section className="panel panel-large route-state-page"><h1>Accès refusé</h1><p>Vous n’avez pas la permission d’ouvrir cette page.</p><Link className="primary-btn" to="/">Retour au dashboard</Link></section>
  }
  return children
}

function hasPermission(user, permission) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : []
  return permissions.includes('*') || permissions.includes(permission)
}

function NotFoundPage() {
  return <section className="panel panel-large route-state-page"><h1>Page introuvable</h1><p>L’adresse demandée n’existe pas.</p><Link className="primary-btn" to="/">Retour au dashboard</Link></section>
}

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
  const location = useLocation()
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshToastVisible, setRefreshToastVisible] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [, setSelectedTrackerId] = useState(3488326)
  const [deliveryOrders, setDeliveryOrders] = useState([])
  const [deliveryOrdersSummary, setDeliveryOrdersSummary] = useState({ total: 0, active: 0, delivered: 0, byTruck: {} })
  const [masterData, setMasterData] = useState({ clients: [], goods: [], destinations: [], suppliers: [], manualTrackers: [] })
  const [authLoading, setAuthLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState(null)
  const [serviceIssue, setServiceIssue] = useState('')
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState(null)


  const refreshData = useCallback(async () => {
    if (serviceIssue === 'suspended') return
    setLoading(true)
    setError('')
    try {
      const fleet = await loadFleetData()
      setDataset(fleet)
      const secondaryLoads = []
      if (hasPermission(currentUser, 'page_reports') || hasPermission(currentUser, 'manage_delivery_orders')) {
        secondaryLoads.push({ key: 'orders', load: loadDeliveryOrders })
      }
      if (hasPermission(currentUser, 'manage_delivery_orders')) {
        secondaryLoads.push({ key: 'ordersSummary', load: loadDeliveryOrdersSummary })
      }
      if (hasPermission(currentUser, 'manage_delivery_orders') || hasPermission(currentUser, 'manage_data') || hasPermission(currentUser, 'page_fleet')) {
        secondaryLoads.push({ key: 'masterData', load: loadMasterData })
      }
      const secondaryResults = await Promise.allSettled(secondaryLoads.map(({ load }) => load()))
      secondaryResults.forEach((result, index) => {
        if (result.status !== 'fulfilled') return
        const key = secondaryLoads[index].key
        if (key === 'orders') setDeliveryOrders(result.value?.items || [])
        if (key === 'ordersSummary') setDeliveryOrdersSummary(result.value || { total: 0, active: 0, delivered: 0, byTruck: {} })
        if (key === 'masterData') setMasterData(result.value || { clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] })
      })
      setLastRefreshAt(new Date())
    } catch (err) {
      if (err?.serviceSuspended) {
        setServiceIssue('suspended')
        return
      }
      if (err?.kind === 'sessionExpired') setCurrentUser(null)
      setServiceIssue(err?.kind || 'serverError')
      const message = err?.message || 'Chargement impossible. Veuillez vérifier votre session.'
      setError(message === 'Failed to fetch' ? 'Impossible de joindre le serveur. Vérifiez la configuration réseau ou CORS.' : message)
    } finally {
      setLoading(false)
    }
  }, [currentUser, serviceIssue])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const user = await getCurrentUser()
        if (!cancelled) setCurrentUser(user)
      } catch (err) {
        if (!cancelled) {
          setCurrentUser(null)
          if (err?.kind !== 'sessionExpired') setServiceIssue(err?.kind || 'serverError')
        }
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function checkStatusThenRefresh() {
      if (!currentUser) return
      setServiceStatusLoading(true)
      try {
        const status = await loadServiceStatus()
        if (cancelled) return
        const suspended = Boolean(status?.suspended)
        setServiceIssue(suspended ? 'suspended' : '')
        if (!suspended) await refreshData()
      } catch (err) {
        if (!cancelled) {
          if (err?.kind === 'sessionExpired') setCurrentUser(null)
          setServiceIssue(err?.kind || 'serverError')
        }
      } finally {
        if (!cancelled) setServiceStatusLoading(false)
      }
    }
    checkStatusThenRefresh()
    return () => { cancelled = true }
  }, [currentUser, refreshData])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleServiceSuspended = () => {
      setServiceIssue('suspended')
    }
    window.addEventListener(SERVICE_SUSPENSION_EVENT, handleServiceSuspended)
    return () => window.removeEventListener(SERVICE_SUSPENSION_EVENT, handleServiceSuspended)
  }, [])

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

  useAutoRefresh(currentUser && !serviceIssue ? refreshData : null, 90000)

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

    for (const event of (dataset?.history ?? [])) {
      const driver = String(event?.chauffeur || event?.driver || event?.extra?.employee_full_name || event?.employee_full_name || '').trim()
      if (!driver) continue
      const trackerId = Number(event?.tracker_id ?? event?.trackerId)
      if (Number.isFinite(trackerId) && !fallbackDriverByTrackerId[trackerId]) fallbackDriverByTrackerId[trackerId] = driver
      const labelKey = normalizeKey(event?.label || event?.tracker_label || event?.extra?.tracker_label)
      if (labelKey && !fallbackDriverByLabel[labelKey]) fallbackDriverByLabel[labelKey] = driver
    }

    // Overrides locaux (driver-overrides.json) — priorité maximale
    const driverOverrides = dataset?.driverOverrides || {}
    const overrideDriverByTrackerId = {}
    const overrideNameByEmployeeId = {}
    for (const [employeeId, data] of Object.entries(driverOverrides)) {
      if (data?.trackerId) {
        // Chercher le nom (depuis l'override ou depuis l'API employees)
        const first = data.firstName || ''
        const last = data.lastName || ''
        const overrideName = [first, last].filter(Boolean).join(' ').trim()
        if (overrideName) {
          overrideDriverByTrackerId[Number(data.trackerId)] = overrideName
        } else {
          // Fallback: chercher dans l'API employees
          const employee = (dataset?.employees || []).find(
            (e) => String(e.id || e.employee_id || e.tracker_id) === String(employeeId)
          )
          if (employee) {
            const empFirst = String(employee.first_name || employee.firstname || employee.firstName || '').trim()
            const empLast = String(employee.last_name || employee.lastname || employee.lastName || '').trim()
            const empName = [empFirst, empLast].filter(Boolean).join(' ').trim()
            if (empName) overrideDriverByTrackerId[Number(data.trackerId)] = empName
          }
        }
      }
      // Override de nom pour l'employé lui-même
      if (data.firstName || data.lastName) {
        const first = data.firstName || ''
        const last = data.lastName || ''
        const name = [first, last].filter(Boolean).join(' ').trim()
        if (name) overrideNameByEmployeeId[employeeId] = { first, last, full: name }
      }
    }

    const preferredMileageKeys = [dataset?.dateKeys?.todayKey, dataset?.dateKeys?.yesterdayKey].filter(Boolean)

    return (dataset?.trackers ?? []).map((tracker) => {
      const state = dataset?.states?.[tracker.id] ?? {}
      const mileage = dataset?.mileage?.[tracker.id] ?? {}
      const employee = employees[tracker.id]
      const overrideName = overrideNameByEmployeeId[String(employee?.id || employee?.employee_id || employee?.tracker_id || '')]
      const events = (dataset?.history ?? []).filter((event) => event.tracker_id === tracker.id)
      const eventCounts = events.reduce((acc, event) => ({ ...acc, [event.event]: (acc[event.event] || 0) + 1 }), {})
      const firstName = overrideName?.first || String(employee?.first_name || employee?.firstname || employee?.firstName || employee?.name || '').trim()
      const lastName = overrideName?.last || String(employee?.last_name || employee?.lastname || employee?.lastName || '').trim()
      const employeeNameFromApi = [firstName, lastName].filter(Boolean).join(' ').trim()
      const employeeName = overrideDriverByTrackerId[Number(tracker.id)]
        || employeeNameFromApi
        || fallbackDriverByTrackerId[Number(tracker.id)]
        || fallbackDriverByLabel[normalizeKey(tracker.label)]
        || 'Non assigné'
      const base = {
        ...tracker,
        source: 'fleeti',
        state,
        mileage,
        employeeNameFromApi: employeeNameFromApi || '',
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
        if (!label) return null
        return {
          id: Number.isInteger(id) && id > 0 ? id : (9000000 + index + 1),
          label,
          employeeName: driver || 'Non assigné',
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

  const filteredTrackers = useMemo(() => operationalTrackers.filter((tracker) => {
    const text = `${tracker.label} ${tracker.employeeName}`.toLowerCase()
    return text.includes(searchQuery.toLowerCase()) && (filter === 'all' || tracker.state.connection_status === filter)
  }), [operationalTrackers, searchQuery, filter])
  const isEmptySearch = !loading && !error && filteredTrackers.length === 0

  const importantEvents = useMemo(() => ((dataset?.history ?? [])
    .filter((event) => ['speedup', 'fuel_level_leap', 'excessive_parking'].includes(event.event))
    .sort((a, b) => new Date(b.time) - new Date(a.time))), [dataset])

  const stats = {
    total: operationalTrackers.length,
    active: operationalTrackers.filter((t) => t.state.connection_status === 'active').length,
    offline: operationalTrackers.filter((t) => t.state.connection_status === 'offline').length,
    moving: operationalTrackers.filter((t) => t.state.movement_status === 'moving').length,
    avgSpeed: operationalTrackers.length ? Math.round(operationalTrackers.reduce((a, t) => a + (t.state?.gps?.speed ?? 0), 0) / operationalTrackers.length) : 0,
    totalMileage: Math.round(operationalTrackers.reduce((a, t) => a + (t.latestDayMileage || 0), 0)),
  }

  const priorityTrackers = useMemo(() => [...filteredTrackers].sort((a, b) => {
    const leftScore = (a.eventCounts.speedup || 0) + (a.eventCounts.excessive_parking || 0)
    const rightScore = (b.eventCounts.speedup || 0) + (b.eventCounts.excessive_parking || 0)
    if (leftScore !== rightScore) return rightScore - leftScore
    return (b.events.length || 0) - (a.events.length || 0)
  }), [filteredTrackers])
  const offlineTrackers = useMemo(() => filteredTrackers.filter((tracker) => tracker.state.connection_status === 'offline'), [filteredTrackers])
  const anomalyTrackers = useMemo(() => [...filteredTrackers].filter((tracker) => tracker.events.length > 3).sort((a, b) => b.events.length - a.events.length), [filteredTrackers])
  const topDrivers = useMemo(() => [...filteredTrackers].sort((a, b) => b.latestDayMileage - a.latestDayMileage).slice(0, 5).map((tracker) => ({ name: tracker.employeeName, tracker: tracker.label, mileage: tracker.latestDayMileage, events: tracker.events.length })), [filteredTrackers])
  const connectionChart = [
    { name: 'Active', value: stats.active, color: '#22c55e' },
    { name: 'Offline', value: stats.offline, color: '#ef4444' },
    { name: 'Autres', value: Math.max(stats.total - stats.active - stats.offline, 0), color: '#f59e0b' },
  ]
  const executiveCards = [
    { title: 'Kilométrage total', value: `${stats.totalMileage} km`, helper: 'activité consolidée du jour' },
    { title: 'Alertes critiques', value: `${importantEvents.length}`, helper: 'événements surveillés' },
    { title: 'Trackers offline', value: `${stats.offline}`, helper: 'unités à vérifier' },
  ]

  const handleLogout = async () => {
    try { await logout() } finally {
      setCurrentUser(null)
      setServiceIssue('')
    }
  }

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #0f172a, #111827)', color: '#fff' }}>
        <div style={{ padding: 24, borderRadius: 18, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(6px)' }}>Vérification de session...</div>
      </div>
    )
  }
  if (serviceIssue && !currentUser) {
    return <GlobalServerMessageBanner kind={serviceIssue} loading={serviceStatusLoading} onRetry={() => window.location.reload()} onLogout={handleLogout} />
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

  const guard = (permission, element) => <PermissionRoute user={currentUser} permission={permission}>{element}</PermissionRoute>

  if (serviceIssue === 'suspended') {
    return (
      <GlobalServerMessageBanner kind="suspended" loading={serviceStatusLoading} onRetry={() => window.location.reload()} onLogout={handleLogout} />
    )
  }

  return (
    <Layout currentUser={currentUser} onLogout={handleLogout}>
      {(serviceIssue ? null : error) && <div className="error-banner" role="alert">{error}</div>}
      {refreshToastVisible && <div className={`refresh-toast${loading ? ' is-loading' : ''}`} role="status" aria-live="polite">Actualisation des données flotte en cours...</div>}
      {location.pathname === '/' && isEmptySearch && <div className="empty-banner">Aucun résultat trouvé. Essaie un autre tracker, chauffeur ou filtre.</div>}
      <Suspense fallback={<SkeletonPage cards={4} tableRows={5} />}>
      <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={guard('page_dashboard', <DashboardPage filteredTrackers={filteredTrackers} stats={stats} connectionChart={connectionChart} priorityTrackers={priorityTrackers} topDrivers={topDrivers} executiveCards={executiveCards} offlineTrackers={offlineTrackers} anomalyTrackers={anomalyTrackers} filter={filter} setFilter={setFilter} searchQuery={searchQuery} setSearchQuery={setSearchQuery} loading={loading} onRefresh={refreshData} lastRefreshAt={lastRefreshAt} deliveryOrders={deliveryOrders} importantEvents={importantEvents} />)} />
          <Route path="/map" element={guard('page_map', <MapPage filteredTrackers={operationalTrackers} setSelectedTrackerId={setSelectedTrackerId} deliveryOrders={deliveryOrders} />)} />
          <Route path="/fleet" element={guard('page_fleet', <FleetPage filteredTrackers={operationalTrackers} setSelectedTrackerId={setSelectedTrackerId} />)} />
          <Route path="/whatsapp" element={guard('page_whatsapp', <WhatsAppPage />)} />
          <Route path="/trackers" element={guard('page_fleet', <FleetPage filteredTrackers={operationalTrackers} setSelectedTrackerId={setSelectedTrackerId} initialMode="trackers" />)} />
          <Route path="/drivers" element={guard('page_fleet', <FleetPage filteredTrackers={operationalTrackers} setSelectedTrackerId={setSelectedTrackerId} initialMode="drivers" />)} />
          <Route path="/alerts" element={guard('page_alerts', <AlertsPage importantEvents={importantEvents} />)} />
          <Route path="/analytics" element={guard('page_analytics', <AnalyticsPage filteredTrackers={operationalTrackers} importantEvents={importantEvents} />)} />
          <Route path="/reports" element={guard('page_reports', <ReportsPage />)} />
          <Route path="/drivers-report" element={guard('page_reports', <DriversReportPage deliveryOrders={deliveryOrders} filteredTrackers={operationalTrackers} />)} />
          <Route path="/trips-report" element={guard('page_reports', <TripsReportPage filteredTrackers={operationalTrackers} />)} />
          <Route path="/delivery-orders" element={guard('manage_delivery_orders', <DeliveryOrdersPage deliveryOrders={deliveryOrders} deliveryOrdersSummary={deliveryOrdersSummary} enrichedTrackers={operationalTrackers} refreshData={refreshData} setDeliveryOrders={setDeliveryOrders} setDeliveryOrdersSummary={setDeliveryOrdersSummary} masterData={masterData} setMasterData={setMasterData} />)} />
          <Route path="/fuel-vouchers" element={guard('manage_fuel_vouchers', <FuelVouchersPage enrichedTrackers={operationalTrackers} />)} />
          <Route path="/fuel-voucher/:id" element={guard('manage_fuel_vouchers', <FuelVoucherDetailPage enrichedTrackers={operationalTrackers} />)} />
          <Route path="/oil-changes" element={guard('manage_delivery_orders', <OilChangesPage enrichedTrackers={operationalTrackers} />)} />
          <Route path="/delivery-order/:id" element={guard('manage_delivery_orders', <DeliveryOrderDetailPage deliveryOrders={deliveryOrders} refreshData={refreshData} />)} />
          <Route path="/tracker/:id" element={guard('page_fleet', <TrackerDetailPage enrichedTrackers={operationalTrackers} deliveryOrders={deliveryOrders} />)} />
          <Route path="/data" element={guard('manage_data', <DataPage />)} />
          <Route path="/geofences" element={guard('manage_data', <GeofencesPage />)} />
          <Route path="/admin-users" element={guard('manage_users', <AdminUsersPage />)} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
      </Suspense>

    </Layout>
  )
}

export default App
