import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Car, CheckCircle, ClipboardList, Clock, Fuel, Gauge, MapPin, Radio, Route, ShieldAlert, Signal, Wifi, WifiOff, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
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
import { EmptyBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { useAutoRefresh } from '../hooks'
import { loadFleetSituation, loadLiveOdometer, loadVehicles } from '../lib/fleeti'

// Indicateur cliquable du tableau de bord journalier.
function KpiCard({ icon, label, value, helper, tone, selected, onClick }) {
  return (
    <button
      type="button"
      className={`kpi-card kpi-card--${tone || 'neutral'} ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
      title={`${label} — cliquer pour filtrer`}
    >
      <span className="kpi-card__icon">{icon}</span>
      <span className="kpi-card__body"><strong>{value}</strong><span>{label}</span><small>{helper}</small></span>
    </button>
  )
}

function WatchList({ items, icon, emptyMessage, renderMeta }) {
  if (!items.length) {
    return <EmptyBanner message={emptyMessage} />
  }

  return (
    <div className="dashboard-watch-list">
      {items.map((tracker) => (
        <article key={tracker.id} className="dashboard-watch-row">
          <div className="dashboard-watch-row__icon">{icon}</div>
          <div className="dashboard-watch-row__body">
            <strong>{tracker.label}</strong>
            <p>{tracker.employeeName}</p>
            <span>{renderMeta(tracker)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function formatLastRefresh(date) {
  if (!date) return 'Pas encore actualisé'
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date))
}

// Formate des secondes en « 4h 06m » (ou « 45m » / « 12s »), retourne '—' si nul.
function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.round(Number(seconds))
  if (total <= 0) return '0m'
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m`
  return `${secs}s`
}

function formatStopAddress(location) {
  if (!location) return 'Position inconnue'
  if (location.address) return location.address
  if (Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    return `${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)}`
  }
  return 'Position inconnue'
}

const FLEET_SITUATION_STATUS_LABELS = {
  moving: 'En route',
  parked: 'À l’arrêt',
  idle: 'Au repos',
  unknown: 'Inconnu',
}

export function DashboardPage({
  filteredTrackers,
  stats: _stats,
  connectionChart,
  priorityTrackers,
  topDrivers,
  executiveCards: _executiveCards,
  offlineTrackers,
  anomalyTrackers,
  filter,
  setFilter,
  searchQuery,
  setSearchQuery: _setSearchQuery,
  loading: _loading,
  onRefresh: _onRefresh,
  lastRefreshAt,
  deliveryOrders = [],
  importantEvents = [],
}) {
  const navigate = useNavigate()
  const [kpiFocus, setKpiFocus] = useState(null)
  const [unresolvedAlerts, setUnresolvedAlerts] = useState(null)
  const [vehicles, setVehicles] = useState([])
  const [liveOdo, setLiveOdo] = useState([])
  const [liveDataLoading, setLiveDataLoading] = useState(true)
  const [liveDataError, setLiveDataError] = useState({ vehicles: '', odometer: '' })
  const [liveDataUpdatedAt, setLiveDataUpdatedAt] = useState(null)
  const liveLoadInFlight = useRef(false)

  // Situation flotte : heures de route, temps de repos et lieu du repos par camion
  const [fleetSituation, setFleetSituation] = useState([])
  const [fleetSituationPeriod, setFleetSituationPeriod] = useState('today')
  const [fleetSituationLoading, setFleetSituationLoading] = useState(true)
  const [fleetSituationError, setFleetSituationError] = useState('')
  const fleetSituationInFlight = useRef(false)

  const loadFleetSituationData = useCallback(async () => {
    if (fleetSituationInFlight.current) return
    fleetSituationInFlight.current = true
    setFleetSituationLoading(true)
    try {
      const data = await loadFleetSituation(fleetSituationPeriod)
      const raw = Array.isArray(data) ? data : data?.items || []
      setFleetSituation(raw.filter((item) => item && item.trackerId != null))
      setFleetSituationError('')
    } catch (error) {
      setFleetSituationError(error?.message || 'Impossible de charger la situation de la flotte.')
    } finally {
      setFleetSituationLoading(false)
      fleetSituationInFlight.current = false
    }
  }, [fleetSituationPeriod])

  useEffect(() => { void loadFleetSituationData() }, [loadFleetSituationData, lastRefreshAt])
  useAutoRefresh(loadFleetSituationData, 60000)

  const loadDashboardLiveData = useCallback(async () => {
    if (liveLoadInFlight.current) return
    liveLoadInFlight.current = true
    setLiveDataLoading(true)
    const [vehicleResult, odometerResult] = await Promise.allSettled([loadVehicles(), loadLiveOdometer()])

    if (vehicleResult.status === 'fulfilled') {
      const data = vehicleResult.value
      const raw = Array.isArray(data) ? data : data?.vehicles || data?.items || []
      setVehicles(raw.map((v) => ({
        ...v,
        id: v.id || v.tracker_id,
        name: v.label || v.name,
        garage: v.garage_organization_name || v.garage || v.garage_name || v.affiliated_garage,
      })))
    }
    if (odometerResult.status === 'fulfilled') {
      const data = odometerResult.value
      setLiveOdo(Array.isArray(data) ? data : data?.items || data?.data || [])
    }

    setLiveDataError({
      vehicles: vehicleResult.status === 'rejected' ? (vehicleResult.reason?.message || 'Impossible de charger les véhicules.') : '',
      odometer: odometerResult.status === 'rejected' ? (odometerResult.reason?.message || 'Impossible de charger les odomètres.') : '',
    })
    if (vehicleResult.status === 'fulfilled' || odometerResult.status === 'fulfilled') setLiveDataUpdatedAt(Date.now())
    setLiveDataLoading(false)
    liveLoadInFlight.current = false
  }, [])

  useEffect(() => { void loadDashboardLiveData() }, [loadDashboardLiveData, lastRefreshAt])
  useAutoRefresh(loadDashboardLiveData, 60000)

  // Alertes non traitées (cycle de vie) pour le KPI dédié
  useEffect(() => {
    let cancelled = false
    async function loadAlertsCount() {
      try {
        const { loadAlerts } = await import('../lib/fleeti')
        const data = await loadAlerts()
        if (!cancelled) setUnresolvedAlerts(data?.statusCounts?.new ?? data?.unreadCount ?? null)
      } catch {
        // silencieux : le KPI affiche les événements importants en secours
      }
    }
    void loadAlertsCount()
    const timer = window.setInterval(loadAlertsCount, 60000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const mileageData = useMemo(
    () => filteredTrackers.slice(0, 12).map((tracker) => ({ name: tracker.label, mileage: tracker.latestDayMileage })),
    [filteredTrackers],
  )
  const filteredVehicles = useMemo(() => {
    if (!searchQuery) return vehicles
    const q = searchQuery.toLowerCase()
    return vehicles.filter((v) =>
      (v.label || v.name || '').toLowerCase().includes(q) ||
      (v.garage || '').toLowerCase().includes(q)
    )
  }, [vehicles, searchQuery])
  const filteredOdo = useMemo(() => {
    if (!searchQuery) return liveOdo
    const q = searchQuery.toLowerCase()
    return liveOdo.filter((entry) =>
      (entry.truckLabel || entry.label || '').toLowerCase().includes(q)
    )
  }, [liveOdo, searchQuery])
  const visibleTrackerIds = useMemo(() => new Set(filteredTrackers.map((tracker) => String(tracker.id))), [filteredTrackers])
  const dashboardPriorityTrackers = useMemo(() => priorityTrackers.filter((tracker) => visibleTrackerIds.has(String(tracker.id))), [priorityTrackers, visibleTrackerIds])
  const dashboardOfflineTrackers = useMemo(() => offlineTrackers.filter((tracker) => visibleTrackerIds.has(String(tracker.id))), [offlineTrackers, visibleTrackerIds])
  const dashboardAnomalyTrackers = useMemo(() => anomalyTrackers.filter((tracker) => visibleTrackerIds.has(String(tracker.id))), [anomalyTrackers, visibleTrackerIds])
  const visibleLabels = useMemo(() => new Set(filteredTrackers.map((tracker) => tracker.label)), [filteredTrackers])
  const dashboardTopDrivers = useMemo(() => topDrivers.filter((driver) => visibleLabels.has(driver.tracker)), [topDrivers, visibleLabels])
  const dashboardStats = useMemo(() => ({
    total: filteredTrackers.length,
    active: filteredTrackers.filter((tracker) => tracker.state?.connection_status === 'active').length,
    offline: filteredTrackers.filter((tracker) => tracker.state?.connection_status === 'offline').length,
    moving: filteredTrackers.filter((tracker) => tracker.state?.movement_status === 'moving').length,
    avgSpeed: filteredTrackers.length ? Math.round(filteredTrackers.reduce((sum, tracker) => sum + Number(tracker.state?.gps?.speed || 0), 0) / filteredTrackers.length) : 0,
  }), [filteredTrackers])
  const dashboardConnectionChart = useMemo(() => connectionChart.map((entry) => ({
    ...entry,
    value: entry.name === 'Actifs' ? dashboardStats.active : entry.name === 'Offline' ? dashboardStats.offline : Math.max(0, dashboardStats.total - dashboardStats.active - dashboardStats.offline),
  })), [connectionChart, dashboardStats])
  const kpis = useMemo(() => {
    const withSpeedup = filteredTrackers.filter((t) => (t.eventCounts?.speedup || 0) > 0)
    const withParking = filteredTrackers.filter((t) => (t.eventCounts?.excessive_parking || 0) > 0)
    const withFuelLeap = filteredTrackers.filter((t) => (t.eventCounts?.fuel_level_leap || 0) > 0)
    const totalKm = filteredTrackers.reduce((sum, t) => sum + (Number(t.latestDayMileage) || 0), 0)
    const activeOrders = (deliveryOrders || []).filter((order) => order.active)
    const deliveredToday = (deliveryOrders || []).filter((order) => {
      const status = String(order.status || '').toLowerCase()
      const referenceDate = order.completedAt || order.date
      if (!referenceDate) return false
      const day = new Date(referenceDate)
      const today = new Date()
      return status.includes('livr') && day.toDateString() === today.toDateString()
    })
    const alertsCount = unresolvedAlerts ?? importantEvents.length
    return [
      { id: 'flotte', icon: <Car size={18} />, label: 'Flotte totale', value: filteredTrackers.length, helper: 'unités géolocalisées', tone: 'neutral', trackers: filteredTrackers },
      { id: 'actifs', icon: <Wifi size={18} />, label: 'Connectés', value: dashboardStats.active, helper: 'liaison live active', tone: 'good', trackers: filteredTrackers.filter((t) => t.state?.connection_status === 'active') },
      { id: 'mouvement', icon: <Activity size={18} />, label: 'En mouvement', value: dashboardStats.moving, helper: 'terrain roulant', tone: 'good', trackers: filteredTrackers.filter((t) => t.state?.movement_status === 'moving') },
      { id: 'offline', icon: <WifiOff size={18} />, label: 'Offline', value: dashboardStats.offline, helper: 'unités à vérifier', tone: 'bad', trackers: filteredTrackers.filter((t) => t.state?.connection_status === 'offline') },
      { id: 'surveillance', icon: <ShieldAlert size={18} />, label: 'À surveiller', value: dashboardPriorityTrackers.length, helper: 'classés par alertes', tone: 'warn', trackers: dashboardPriorityTrackers },
      { id: 'speedup', icon: <Gauge size={18} />, label: 'Excès de vitesse', value: withSpeedup.length, helper: 'camions concernés', tone: 'bad', trackers: withSpeedup },
      { id: 'parking', icon: <Clock size={18} />, label: 'Stationnements', value: withParking.length, helper: 'arrêts prolongés', tone: 'warn', trackers: withParking },
      { id: 'carburant', icon: <Fuel size={18} />, label: 'Variations carburant', value: withFuelLeap.length, helper: 'sauts de niveau détectés', tone: 'warn', trackers: withFuelLeap },
      { id: 'km', icon: <Route size={18} />, label: 'Km du jour', value: `${Math.round(totalKm)} km`, helper: 'activité consolidée', tone: 'neutral', trackers: topDrivers.map((d) => ({ id: d.tracker, label: d.name || d.tracker, employeeName: d.tracker, meta: `${d.mileage} km` })) },
      { id: 'missions', icon: <ClipboardList size={18} />, label: 'Missions actives', value: activeOrders.length, helper: 'BL en cours', tone: 'neutral', navigate: '/delivery-orders', meta: `${activeOrders.length} BL actifs` },
      { id: 'livraisons', icon: <CheckCircle size={18} />, label: 'Livraisons du jour', value: deliveredToday.length, helper: 'BL livrés', tone: 'good', navigate: '/delivery-orders', meta: `${deliveredToday.length} livrés` },
      { id: 'alertes', icon: <AlertTriangle size={18} />, label: 'Alertes non traitées', value: alertsCount, helper: 'cycle de vie ouvert', tone: 'bad', navigate: '/alerts', meta: `${alertsCount} nouvelles` },
    ]
  }, [filteredTrackers, dashboardStats, dashboardPriorityTrackers, topDrivers, deliveryOrders, unresolvedAlerts, importantEvents])

  const focusedKpi = kpis.find((kpi) => kpi.id === kpiFocus)

  function openKpi(kpi) {
    if (kpi.navigate) {
      navigate(kpi.navigate)
      return
    }
    setKpiFocus((prev) => (prev === kpi.id ? null : kpi.id))
  }

  return (
    <PageStack className="dashboard-page">
      <section className="panel dashboard-hero-panel">
        <h1 className="dashboard-hero-title">Dashboard opérationnel</h1>
        <div className="dashboard-toolbar">
          <div className="dashboard-toolbar__filters">
            {['all', 'active', 'idle', 'offline'].map((value) => (
              <button
                type="button"
                key={value}
                className={`chip ${filter === value ? 'selected' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'Tous' : value === 'active' ? 'Actifs' : value === 'idle' ? 'En attente' : 'Offline'}
              </button>
            ))}
          </div>
          <div className="dashboard-toolbar__summary">
            <span>{filteredTrackers.length} trackers visibles</span>
            <span>{dashboardStats.active} actifs</span>
            <span>{dashboardStats.offline} offline</span>
            <span>{liveDataUpdatedAt ? `Données live : ${formatLastRefresh(liveDataUpdatedAt)}` : 'Données live en attente'}</span>
          </div>
        </div>
      </section>

      {liveDataLoading && <div className="info-banner" role="status">Actualisation des véhicules et odomètres…</div>}
      {liveDataError.vehicles && <div className="error-banner" role="alert">Véhicules : {liveDataError.vehicles}</div>}
      {liveDataError.odometer && <div className="error-banner" role="alert">Odomètres : {liveDataError.odometer}</div>}
      {!liveDataLoading && !liveDataError.vehicles && !liveDataError.odometer && vehicles.length === 0 && liveOdo.length === 0 && <EmptyBanner message="Aucune donnée véhicule ou odomètre disponible." />}

      <section className="kpi-grid dashboard-kpi-grid" aria-label="Indicateurs journaliers cliquables">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.id}
            icon={kpi.icon}
            label={kpi.label}
            value={kpi.value}
            helper={kpi.helper}
            tone={kpi.tone}
            selected={kpiFocus === kpi.id}
            onClick={() => openKpi(kpi)}
          />
        ))}
      </section>

      {focusedKpi && (
        <section className="panel kpi-focus-panel" aria-label={`Focus : ${focusedKpi.label}`}>
          <div className="panel-header">
            <div>
              <h2>{focusedKpi.label} <span className="kpi-focus-count">({focusedKpi.trackers?.length ?? focusedKpi.value})</span></h2>
              <p>{focusedKpi.helper}{focusedKpi.meta ? ` · ${focusedKpi.meta}` : ''}</p>
            </div>
            <button type="button" className="ghost-btn" onClick={() => setKpiFocus(null)} aria-label="Fermer le focus"><X size={18} />Fermer</button>
          </div>
          {focusedKpi.trackers?.length ? (
            <div className="kpi-focus-list">
              {focusedKpi.trackers.slice(0, 12).map((tracker) => (
                <article key={`${focusedKpi.id}-${tracker.id}`} className="kpi-focus-row">
                  <strong>{tracker.label}</strong>
                  <span>{tracker.employeeName || 'Non assigné'}</span>
                  {tracker.meta ? <small>{tracker.meta}</small> : <small>{tracker.state?.connection_status === 'offline' ? 'Offline' : `${tracker.state?.gps?.speed ?? 0} km/h`}</small>}
                </article>
              ))}
              {focusedKpi.trackers.length > 12 && <p className="kpi-focus-more">+ {focusedKpi.trackers.length - 12} autres…</p>}
            </div>
          ) : <div className="empty-banner">Aucun élément pour cet indicateur.</div>}
          {focusedKpi.id !== 'km' && (
            <p className="kpi-focus-actions"><Link className="ghost-btn" to="/map">Ouvrir sur la carte</Link></p>
          )}
        </section>
      )}

      <section className="panel fleet-situation-panel" aria-label="Situation flotte">
        <SectionHeader
          title="Situation flotte"
          description="Heures de route, temps de repos et lieu du repos par camion"
          right={(
            <div className="dashboard-toolbar__filters">
              {[['today', 'Aujourd’hui'], ['24h', '24h'], ['7d', '7 jours']].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`chip ${fleetSituationPeriod === value ? 'selected' : ''}`}
                  onClick={() => setFleetSituationPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        />

        {fleetSituationLoading && fleetSituation.length === 0 && <div className="info-banner" role="status">Chargement de la situation flotte…</div>}
        {fleetSituationError && <div className="error-banner" role="alert">Situation flotte : {fleetSituationError}</div>}

        {!fleetSituationLoading && !fleetSituationError && fleetSituation.length === 0 && (
          <EmptyBanner message="Aucune donnée de situation flotte disponible." />
        )}

        {fleetSituation.length > 0 && (
          <div className="fleet-situation-table-wrap">
            <table className="ops-table fleet-situation-table">
              <thead>
                <tr>
                  <th>Camion</th>
                  <th>Statut</th>
                  <th>Heures de route</th>
                  <th>Temps de repos</th>
                  <th>Trajets</th>
                  <th>Distance</th>
                  <th>Lieu du repos</th>
                </tr>
              </thead>
              <tbody>
                {fleetSituation.map((item) => (
                  <tr key={item.trackerId}>
                    <td>
                      <strong>{item.label}</strong>
                      <small className="fleet-situation-driver">{item.employeeName}</small>
                    </td>
                    <td>
                      <span className={`fleet-situation-status fleet-situation-status--${item.movementStatus}`}>
                        {FLEET_SITUATION_STATUS_LABELS[item.movementStatus] || item.movementStatus}
                      </span>
                      {item.connectionStatus === 'offline' && <small className="fleet-situation-offline"> hors ligne</small>}
                    </td>
                    <td>{formatDuration(item.tripDurationSec)}</td>
                    <td>{formatDuration(item.parkingDurationSec)}</td>
                    <td>{item.tripsCount || '—'}</td>
                    <td>{item.distanceKm ? `${Math.round(item.distanceKm)} km` : '—'}</td>
                    <td>
                      <span className="fleet-situation-stop">
                        <MapPin size={14} />
                        {formatStopAddress(item.restLocation)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dashboard-grid dashboard-grid--primary">
        <div className="panel panel-large dashboard-chart-panel">
          <SectionHeader
            title="Kilométrage du jour"
            description="Classement des unités les plus actives"
            right={<span className="data-phase-chip">Vue exploit.</span>}
          />

          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={mileageData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" stroke="rgba(226,232,240,0.6)" tickLine={false} axisLine={false} />
              <YAxis stroke="rgba(226,232,240,0.6)" tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: '#0b1220',
                  border: '1px solid rgba(148,163,184,0.18)',
                  borderRadius: 16,
                  color: '#e2e8f0',
                }}
              />
              <Bar dataKey="mileage" fill="#946239" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel dashboard-pie-panel">
          <SectionHeader title="Répartition flotte" description="Connectivité live" />
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={dashboardConnectionChart} dataKey="value" innerRadius={52} outerRadius={80} paddingAngle={4}>
                {dashboardConnectionChart.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#0b1220',
                  border: '1px solid rgba(148,163,184,0.18)',
                  borderRadius: 16,
                  color: '#e2e8f0',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="dashboard-inline-stats">
            <span><CheckCircle size={14} /> {dashboardStats.active} actifs</span>
            <span><WifiOff size={14} /> {dashboardStats.offline} offline</span>
            <span><Signal size={14} /> {dashboardStats.total - dashboardStats.active - dashboardStats.offline} autres</span>
          </div>
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid--secondary">
        <div className="panel panel-large">
          <SectionHeader
            title="Camions à surveiller en priorité"
            description="Classement par nombre d’alertes détectées"
          />
          <WatchList
            items={dashboardPriorityTrackers.slice(0, 5)}
            icon={<ShieldAlert size={16} />}
            emptyMessage="Aucun camion prioritaire pour le moment."
            renderMeta={(tracker) => `${tracker.events.length} événements · ${tracker.eventCounts.speedup || 0} excès de vitesse`}
          />
        </div>

        <div className="panel">
          <SectionHeader title="Chauffeurs les plus actifs" description="Classement par kilométrage du jour" />
          <div className="driver-ranking">
            {dashboardTopDrivers.map((driver, index) => (
              <div key={`${driver.name}-${index}`} className="driver-rank-row driver-rank-row--dashboard">
                <strong>#{index + 1}</strong>
                <div>
                  <span>{driver.name}</span>
                  <small>{driver.tracker}</small>
                </div>
                <div>
                  <span>{driver.mileage} km</span>
                  <small>{driver.events} événements</small>
                </div>
              </div>
            ))}
            {!dashboardTopDrivers.length && <EmptyBanner message="Aucune donnée chauffeur disponible." />}
          </div>
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid--tertiary">
        <div className="panel">
          <SectionHeader
            title="Unités offline"
            description="À vérifier rapidement"
            right={<Link className="ghost-btn" to="/trackers">Voir les trackers</Link>}
          />
          <WatchList
            items={dashboardOfflineTrackers.slice(0, 5)}
            icon={<AlertTriangle size={16} />}
            emptyMessage="Aucun tracker offline actuellement."
            renderMeta={(tracker) => `Batterie ${tracker.state?.battery_level ?? '-'}% · ${tracker.state?.last_update ? new Date(tracker.state.last_update).toLocaleString('fr-FR') : 'MàJ inconnue'}`}
          />
        </div>

        <div className="panel">
          <SectionHeader
            title="Anomalies terrain"
            description="Unités avec signaux à surveiller"
            right={<Link className="ghost-btn" to="/analytics">Voir analytics</Link>}
          />
          <WatchList
            items={dashboardAnomalyTrackers.slice(0, 5)}
            icon={<Activity size={16} />}
            emptyMessage="Aucune anomalie terrain détectée."
            renderMeta={(tracker) => `${tracker.events.length} événements détectés`}
          />
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid--tertiary">
        {filteredVehicles.length > 0 && (
          <div className="panel panel-large dashboard-data-panel">
            <SectionHeader
              title="Assurances et conformité"
              description={searchQuery ? `${filteredVehicles.length} résultat${filteredVehicles.length > 1 ? 's' : ''}` : 'État des assurances par camion'}
            />
            <div className="dashboard-card-grid">
              {filteredVehicles.map((vehicle) => {
                const liabilityDate = vehicle.liability_insurance_valid_till ? new Date(vehicle.liability_insurance_valid_till) : null
                const freeDate = vehicle.free_insurance_valid_till ? new Date(vehicle.free_insurance_valid_till) : null
                const now = new Date()
                const thirtyDays = 30 * 24 * 60 * 60 * 1000
                const liabilityUrgent = liabilityDate && liabilityDate.getTime() - now.getTime() < thirtyDays
                const freeUrgent = freeDate && freeDate.getTime() - now.getTime() < thirtyDays
                return (
                  <article key={vehicle.id || vehicle.label} className="dashboard-vehicle-card">
                    <div>
                      <strong>{vehicle.label || vehicle.name || 'Sans nom'}</strong>
                      <small>{vehicle.garage || vehicle.affiliated_garage || 'Garage inconnu'}</small>
                    </div>
                    <div className="dashboard-vehicle-card__row">
                      <span>RC</span>
                      {liabilityDate ? (
                        liabilityUrgent ? (
                          <strong className="is-danger"><AlertTriangle size={14} /> {liabilityDate.toLocaleDateString('fr-FR')}</strong>
                        ) : (
                          <strong className="is-ok"><CheckCircle size={14} /> {liabilityDate.toLocaleDateString('fr-FR')}</strong>
                        )
                      ) : (
                        <strong className="is-muted"><Clock size={14} /> Non renseigné</strong>
                      )}
                    </div>
                    <div className="dashboard-vehicle-card__row">
                      <span>Libre</span>
                      {freeDate ? (
                        freeUrgent ? (
                          <strong className="is-danger"><AlertTriangle size={14} /> {freeDate.toLocaleDateString('fr-FR')}</strong>
                        ) : (
                          <strong className="is-ok"><CheckCircle size={14} /> {freeDate.toLocaleDateString('fr-FR')}</strong>
                        )
                      ) : (
                        <strong className="is-muted"><Clock size={14} /> Non renseigné</strong>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {filteredOdo.length > 0 && (
          <div className="panel panel-large dashboard-data-panel">
            <SectionHeader
              title="Live odomètre"
              description={searchQuery ? `${filteredOdo.length} résultat${filteredOdo.length > 1 ? 's' : ''}` : 'Kilométrage et statut en temps réel'}
            />
            <div className="dashboard-card-grid">
              {filteredOdo.map((entry) => (
                <article key={entry.trackerId || entry.id} className="dashboard-sensor-card">
                  <strong>{entry.truckLabel || entry.label || '-'}</strong>
                  <span>Km: {entry.odometer != null ? `${Number(entry.odometer).toLocaleString('fr-FR')} km` : '-'}</span>
                  <span>Vitesse: {entry.speed != null ? `${entry.speed} km/h` : '-'}</span>
                  <span>
                    <Radio size={12} />{' '}
                    {entry.isOnline ? 'En ligne' : 'Hors ligne'}
                  </span>
                  <span>MàJ: {entry.lastUpdate ? new Date(entry.lastUpdate).toLocaleTimeString('fr-FR') : '-'}</span>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </PageStack>
  )
}
