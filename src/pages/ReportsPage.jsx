import { useEffect, useMemo, useState } from 'react'
import { loadReportAlerts, loadReportFleet, loadReportMissions, loadReportPivot, loadReportSummary } from '../lib/fleeti'

const REPORT_TYPES = [
  { value: 'overview', label: 'Vue d’ensemble' },
  { value: 'fleet', label: 'Flotte' },
  { value: 'alerts', label: 'Alertes' },
  { value: 'missions', label: 'Missions' },
  { value: 'pivot', label: 'Tableau croisé' },
]

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '48h', label: '48h' },
  { value: '7d', label: '7 jours' },
  { value: 'today', label: "Aujourd'hui" },
]

const PIVOT_DIMENSIONS = [
  { value: 'tracker', label: 'Camion' },
  { value: 'driver', label: 'Chauffeur' },
  { value: 'event', label: 'Type alerte' },
  { value: 'status', label: 'Statut' },
  { value: 'client', label: 'Client' },
  { value: 'destination', label: 'Destination' },
  { value: 'date', label: 'Date' },
]

const PIVOT_METRICS = [
  { value: 'count', label: 'Nombre' },
  { value: 'distance', label: 'Distance' },
]

function buildQuery(params) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  })
  return query.toString()
}

function downloadCsv(filename, rows) {
  const csv = rows.map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportOverview(summaryPayload) {
  const rows = [
    ['Bloc', 'Métrique', 'Valeur'],
    ['Global', 'Trajets total', summaryPayload?.summary?.trajetsTotal ?? 0],
    ['Global', 'Distance totale (km)', summaryPayload?.summary?.distanceTotaleKm ?? 0],
    ['Global', 'Temps trajet total (h)', summaryPayload?.summary?.tempsTrajetTotalH ?? 0],
    ['Global', 'Temps inactivité total (h)', summaryPayload?.summary?.tempsInactiviteTotalH ?? 0],
    ['Global', 'Vitesse moyenne flotte (km/h)', summaryPayload?.summary?.vitesseMoyenneFlotte ?? 0],
    ['Flotte', 'Véhicules total', summaryPayload?.fleet?.totalVehicles ?? 0],
    ['Flotte', 'Véhicules actifs', summaryPayload?.fleet?.activeVehicles ?? 0],
    ['Flotte', 'Véhicules offline', summaryPayload?.fleet?.offlineVehicles ?? 0],
    ['Alertes', 'Total alertes', summaryPayload?.alerts?.totalAlerts ?? 0],
    ['Alertes', 'Alertes critiques', summaryPayload?.alerts?.criticalAlerts ?? 0],
    ['Missions', 'Total missions', summaryPayload?.missions?.totalMissions ?? 0],
    ['Missions', 'Missions actives', summaryPayload?.missions?.activeMissions ?? 0],
    ['Missions', 'Missions livrées', summaryPayload?.missions?.deliveredMissions ?? 0],
  ]
  downloadCsv('rapport-vue-ensemble.csv', rows)
}

function exportFleet(rows = []) {
  const csvRows = [
    ['Camion', 'Conducteur', 'Statut', 'Mouvement', 'Distance (km)', 'Trajets', 'Alertes', 'Vitesse moy', 'Vitesse max', 'Inactivité (h)', 'Carburant'],
    ...rows.map((row) => [row.immatriculation, row.conducteur, row.status, row.movementStatus, row.distanceKm, row.trajets, row.alertCount, row.vitesseMoy, row.vitesseMax, row.inactiviteH, row.carburantL]),
  ]
  downloadCsv('rapport-flotte-v2.csv', csvRows)
}

function exportAlerts(rows = []) {
  const csvRows = [
    ['Date', 'Camion', 'Conducteur', 'Type', 'Gravité', 'Adresse', 'Message'],
    ...rows.map((row) => [row.time, row.immatriculation, row.conducteur, row.eventType, row.severity, row.address, row.message]),
  ]
  downloadCsv('rapport-alertes.csv', csvRows)
}

function exportMissions(rows = []) {
  const csvRows = [
    ['Référence', 'Camion', 'Conducteur', 'Client', 'Destination', 'Statut', 'Actif', 'Date', 'Preuve'],
    ...rows.map((row) => [row.reference, row.immatriculation, row.conducteur, row.client, row.destination, row.status, row.active ? 'Oui' : 'Non', row.date, row.proofStatus]),
  ]
  downloadCsv('rapport-missions.csv', csvRows)
}

function exportPivot(pivot) {
  const rows = [
    ['Ligne / Colonne', ...(pivot?.columns || []), 'Total'],
    ...((pivot?.rows || []).map((row) => [row.label, ...(pivot.columns || []).map((column) => row.values?.[column] ?? 0), row.total])),
  ]
  downloadCsv('rapport-pivot.csv', rows)
}

export function ReportsPage() {
  const [reportType, setReportType] = useState('overview')
  const [filters, setFilters] = useState({
    period: '48h',
    trackerId: '',
    driver: '',
    status: '',
    eventType: '',
    client: '',
    destination: '',
    pivotRows: 'tracker',
    pivotCols: 'event',
    metric: 'count',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summaryPayload, setSummaryPayload] = useState({ summary: {}, fleet: {}, alerts: {}, missions: {} })
  const [fleetPayload, setFleetPayload] = useState({ summary: {}, rows: [] })
  const [alertsPayload, setAlertsPayload] = useState({ summary: {}, rows: [] })
  const [missionsPayload, setMissionsPayload] = useState({ summary: {}, rows: [] })
  const [pivotPayload, setPivotPayload] = useState({ pivot: { columns: [], rows: [] } })

  const summaryQuery = useMemo(() => buildQuery({
    period: filters.period,
    trackerId: filters.trackerId,
    driver: filters.driver,
    status: filters.status,
    eventType: filters.eventType,
    client: filters.client,
    destination: filters.destination,
  }), [filters])

  const activeQuery = useMemo(() => buildQuery(filters), [filters])

  useEffect(() => {
    let cancelled = false

    async function loadSummary() {
      try {
        const summary = await loadReportSummary(summaryQuery)
        if (!cancelled) setSummaryPayload(summary)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Erreur de chargement des rapports')
      }
    }

    loadSummary()
    return () => {
      cancelled = true
    }
  }, [summaryQuery])

  useEffect(() => {
    let cancelled = false

    async function loadActiveReport() {
      setLoading(true)
      setError('')
      try {
        if (reportType === 'overview') {
          if (!cancelled) setLoading(false)
          return
        }

        if (reportType === 'fleet') {
          const payload = await loadReportFleet(activeQuery)
          if (!cancelled) setFleetPayload(payload)
        } else if (reportType === 'alerts') {
          const payload = await loadReportAlerts(activeQuery)
          if (!cancelled) setAlertsPayload(payload)
        } else if (reportType === 'missions') {
          const payload = await loadReportMissions(activeQuery)
          if (!cancelled) setMissionsPayload(payload)
        } else if (reportType === 'pivot') {
          const payload = await loadReportPivot(activeQuery)
          if (!cancelled) setPivotPayload(payload)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Erreur de chargement des rapports')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadActiveReport()
    return () => {
      cancelled = true
    }
  }, [activeQuery, reportType])

  const overviewCards = [
    { label: 'Distance totale', value: `${summaryPayload?.summary?.distanceTotaleKm ?? 0} km`, helper: 'sur la période' },
    { label: 'Trajets total', value: summaryPayload?.summary?.trajetsTotal ?? 0, helper: 'activité flotte' },
    { label: 'Alertes critiques', value: summaryPayload?.alerts?.criticalAlerts ?? 0, helper: 'priorité haute' },
    { label: 'Missions actives', value: summaryPayload?.missions?.activeMissions ?? 0, helper: 'bons en cours' },
    { label: 'Véhicules offline', value: summaryPayload?.fleet?.offlineVehicles ?? 0, helper: 'à surveiller' },
    { label: 'Vitesse moyenne', value: `${summaryPayload?.summary?.vitesseMoyenneFlotte ?? 0} km/h`, helper: 'instantané' },
  ]

  const handleExport = () => {
    if (reportType === 'overview') return exportOverview(summaryPayload)
    if (reportType === 'fleet') return exportFleet(fleetPayload.rows)
    if (reportType === 'alerts') return exportAlerts(alertsPayload.rows)
    if (reportType === 'missions') return exportMissions(missionsPayload.rows)
    return exportPivot(pivotPayload.pivot)
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large reports-v2-hero">
      <div className="panel-header"><div><h3>Centre de rapports V2</h3><p>Analyse flotte, alertes, missions et tableaux croisés</p></div><button className="primary-btn" onClick={handleExport}>Exporter CSV</button></div>
      <div className="filters filter-row">{REPORT_TYPES.map((item) => <button key={item.value} className={`chip ${reportType === item.value ? 'selected' : ''}`} onClick={() => setReportType(item.value)}>{item.label}</button>)}</div>
      <div className="reports-filter-grid">
        <select value={filters.period} onChange={(e) => setFilters((current) => ({ ...current, period: e.target.value }))}>{PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <input placeholder="Chauffeur" value={filters.driver} onChange={(e) => setFilters((current) => ({ ...current, driver: e.target.value }))} />
        <input placeholder="Client" value={filters.client} onChange={(e) => setFilters((current) => ({ ...current, client: e.target.value }))} />
        <input placeholder="Destination" value={filters.destination} onChange={(e) => setFilters((current) => ({ ...current, destination: e.target.value }))} />
        <select value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}>
          <option value="">Tous statuts</option>
          <option value="active">Active</option>
          <option value="offline">Offline</option>
          <option value="Livré">Mission livrée</option>
          <option value="En cours">Mission en cours</option>
        </select>
        <input placeholder="Type alerte (ex: speedup)" value={filters.eventType} onChange={(e) => setFilters((current) => ({ ...current, eventType: e.target.value }))} />
      </div>
      {reportType === 'pivot' && <div className="reports-filter-grid reports-pivot-grid"><select value={filters.pivotRows} onChange={(e) => setFilters((current) => ({ ...current, pivotRows: e.target.value }))}>{PIVOT_DIMENSIONS.map((item) => <option key={item.value} value={item.value}>{item.label} lignes</option>)}</select><select value={filters.pivotCols} onChange={(e) => setFilters((current) => ({ ...current, pivotCols: e.target.value }))}>{PIVOT_DIMENSIONS.map((item) => <option key={item.value} value={item.value}>{item.label} colonnes</option>)}</select><select value={filters.metric} onChange={(e) => setFilters((current) => ({ ...current, metric: e.target.value }))}>{PIVOT_METRICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>}
      {loading && reportType !== 'overview' && <div className="info-banner">Chargement du rapport {REPORT_TYPES.find((item) => item.value === reportType)?.label?.toLowerCase()}…</div>}
      {error && <div className="error-banner">{error}</div>}
    </section>

    <section className="reports-summary-grid reports-v2-kpis">
      {overviewCards.map((card) => <div key={card.label} className="overview-card"><span>{card.label}</span><strong>{card.value}</strong><small>{card.helper}</small></div>)}
    </section>

    {reportType === 'overview' && <section className="dashboard-grid premium-grid phase2-grid"><div className="panel"><div className="panel-header"><div><h3>Vue d’ensemble flotte</h3></div></div><div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.totalVehicles ?? 0}</strong><div><span>Véhicules</span><small>dans le périmètre</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.activeVehicles ?? 0}</strong><div><span>Actifs</span><small>connectés</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.movingVehicles ?? 0}</strong><div><span>En mouvement</span><small>terrain</small></div></div></div></div><div className="panel"><div className="panel-header"><div><h3>Vue alertes & missions</h3></div></div><div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{summaryPayload?.alerts?.totalAlerts ?? 0}</strong><div><span>Alertes</span><small>toutes catégories</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.missions?.totalMissions ?? 0}</strong><div><span>Missions</span><small>bons enregistrés</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.missions?.pendingProofs ?? 0}</strong><div><span>Preuves en attente</span><small>à compléter</small></div></div></div></div></section>}

    {reportType === 'fleet' && <section className="panel panel-large"><div className="panel-header"><div><h3>Rapport flotte détaillé</h3><p>{fleetPayload?.rows?.length ?? 0} lignes</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Camion</th><th>Conducteur</th><th>Statut</th><th>Mouvement</th><th>Distance</th><th>Trajets</th><th>Alertes</th><th>Vit. moy</th><th>Vit. max</th><th>Inactivité</th><th>Carburant</th></tr></thead><tbody>{(fleetPayload?.rows || []).map((row) => <tr key={row.trackerId}><td>{row.immatriculation}</td><td>{row.conducteur}</td><td>{row.status}</td><td>{row.movementStatus}</td><td>{row.distanceKm} km</td><td>{row.trajets}</td><td>{row.alertCount}</td><td>{row.vitesseMoy} km/h</td><td>{row.vitesseMax} km/h</td><td>{row.inactiviteH} h</td><td>{row.carburantL}</td></tr>)}</tbody></table></div></section>}

    {reportType === 'alerts' && <section className="panel panel-large"><div className="panel-header"><div><h3>Rapport alertes</h3><p>{alertsPayload?.rows?.length ?? 0} événements</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Date</th><th>Camion</th><th>Conducteur</th><th>Type</th><th>Gravité</th><th>Adresse</th><th>Message</th></tr></thead><tbody>{(alertsPayload?.rows || []).map((row) => <tr key={row.id}><td>{row.time ? new Date(row.time).toLocaleString() : '-'}</td><td>{row.immatriculation}</td><td>{row.conducteur}</td><td>{row.eventType}</td><td>{row.severity}</td><td>{row.address}</td><td>{row.message}</td></tr>)}</tbody></table></div></section>}

    {reportType === 'missions' && <section className="panel panel-large"><div className="panel-header"><div><h3>Rapport missions</h3><p>{missionsPayload?.rows?.length ?? 0} bons</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Référence</th><th>Camion</th><th>Conducteur</th><th>Client</th><th>Destination</th><th>Statut</th><th>Actif</th><th>Date</th><th>Preuve</th></tr></thead><tbody>{(missionsPayload?.rows || []).map((row) => <tr key={row.id}><td>{row.reference}</td><td>{row.immatriculation}</td><td>{row.conducteur}</td><td>{row.client}</td><td>{row.destination}</td><td>{row.status}</td><td>{row.active ? 'Oui' : 'Non'}</td><td>{row.date ? new Date(row.date).toLocaleString() : '-'}</td><td>{row.proofStatus}</td></tr>)}</tbody></table></div></section>}

    {reportType === 'pivot' && <section className="panel panel-large"><div className="panel-header"><div><h3>Tableau croisé</h3><p>{pivotPayload?.pivot?.rowsKey} × {pivotPayload?.pivot?.colsKey}</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Ligne</th>{(pivotPayload?.pivot?.columns || []).map((column) => <th key={column}>{column}</th>)}<th>Total</th></tr></thead><tbody>{(pivotPayload?.pivot?.rows || []).map((row) => <tr key={row.label}><td>{row.label}</td>{(pivotPayload?.pivot?.columns || []).map((column) => <td key={`${row.label}-${column}`}>{row.values?.[column] ?? 0}</td>)}<td>{row.total}</td></tr>)}</tbody></table></div></section>}
  </div>
}
