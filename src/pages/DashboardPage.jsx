import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Car, CheckCircle, Clock, Gauge, Radio, ShieldAlert, Signal, Wifi, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
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
import { loadLiveOdometer, loadVehicles } from '../lib/fleeti'

function StatCard({ icon, label, value, helper }) {
  return (
    <article className="stat-card stat-card--dashboard">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </article>
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
}) {
  const [vehicles, setVehicles] = useState([])
  const [liveOdo, setLiveOdo] = useState([])
  const [liveDataLoading, setLiveDataLoading] = useState(true)
  const [liveDataError, setLiveDataError] = useState({ vehicles: '', odometer: '' })
  const [liveDataUpdatedAt, setLiveDataUpdatedAt] = useState(null)
  const liveLoadInFlight = useRef(false)

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

      <section className="stats-grid dashboard-stats-grid">
        <StatCard icon={<Car size={18} />} label="Trackers" value={dashboardStats.total} helper="base flotte" />
        <StatCard icon={<Wifi size={18} />} label="Actifs" value={dashboardStats.active} helper="connectés live" />
        <StatCard icon={<Activity size={18} />} label="En mouvement" value={dashboardStats.moving} helper="terrain roulant" />
        <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${dashboardStats.avgSpeed} km/h`} helper="instantané" />
      </section>

      <section className="dashboard-grid dashboard-grid--primary">
        <div className="panel panel-large dashboard-chart-panel">
          <SectionHeader
            title="Kilométrage du jour"
            description="Classement des unités les plus actives"
            right={<span className="data-phase-chip">Vue exploit.</span>}
          />

          <ResponsiveContainer width="100%" height={300}>
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
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={dashboardConnectionChart} dataKey="value" innerRadius={72} outerRadius={102} paddingAngle={4}>
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
