import { useEffect, useMemo, useState } from 'react'
import {
  loadReportAlerts,
  loadReportBatches,
  loadReportByClient,
  loadReportByDestination,
  loadReportByGoods,
  loadReportByTruck,
  loadReportDetailedDeliveries,
  loadReportFleet,
  loadReportFuelSummary,
  loadReportMissions,
  loadReportPerformanceDays,
  loadReportPerformanceDrivers,
  loadReportPivot,
  loadReportSummary,
} from '../lib/fleeti'

const REPORT_TYPES = [
  { value: 'overview', label: 'Vue d’ensemble' },
  { value: 'fleet', label: 'Flotte' },
  { value: 'alerts', label: 'Alertes' },
  { value: 'missions', label: 'Missions' },
  { value: 'pivot', label: 'Tableau croisé' },
  { value: 'business-detailed', label: 'Livraisons détaillées' },
  { value: 'business-client', label: 'Par client' },
  { value: 'business-goods', label: 'Par produit' },
  { value: 'business-truck', label: 'Par camion' },
  { value: 'business-destination', label: 'Par destination' },
  { value: 'business-performance-drivers', label: 'Performance chauffeurs' },
  { value: 'business-performance-days', label: 'Performance journalière' },
  { value: 'business-fuel', label: 'Carburant / flotte' },
  { value: 'business-batches', label: 'Batch / volumes' },
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

function exportGeneric(filename, headers, rows = [], projector) {
  downloadCsv(filename, [headers, ...rows.map(projector)])
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('fr-FR')
}

function GenericTable({ title, subtitle, columns, rows, rowKey }) {
  return <section className="panel panel-large"><div className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={rowKey ? rowKey(row, index) : index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row[column.key], row) : (row[column.key] ?? '-')}</td>)}</tr>)}</tbody></table></div></section>
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
    goods: '',
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
  const [businessDetailedPayload, setBusinessDetailedPayload] = useState({ rows: [] })
  const [businessClientPayload, setBusinessClientPayload] = useState({ rows: [] })
  const [businessGoodsPayload, setBusinessGoodsPayload] = useState({ rows: [] })
  const [businessTruckPayload, setBusinessTruckPayload] = useState({ rows: [] })
  const [businessDestinationPayload, setBusinessDestinationPayload] = useState({ rows: [] })
  const [businessPerformanceDriversPayload, setBusinessPerformanceDriversPayload] = useState({ rows: [] })
  const [businessPerformanceDaysPayload, setBusinessPerformanceDaysPayload] = useState({ rows: [] })
  const [businessFuelPayload, setBusinessFuelPayload] = useState({ rows: [] })
  const [businessBatchesPayload, setBusinessBatchesPayload] = useState({ rows: [] })

  const summaryQuery = useMemo(() => buildQuery({
    period: filters.period,
    trackerId: filters.trackerId,
    driver: filters.driver,
    status: filters.status,
    eventType: filters.eventType,
    client: filters.client,
    destination: filters.destination,
    goods: filters.goods,
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
        } else if (reportType === 'business-detailed') {
          const payload = await loadReportDetailedDeliveries(activeQuery)
          if (!cancelled) setBusinessDetailedPayload(payload)
        } else if (reportType === 'business-client') {
          const payload = await loadReportByClient(activeQuery)
          if (!cancelled) setBusinessClientPayload(payload)
        } else if (reportType === 'business-goods') {
          const payload = await loadReportByGoods(activeQuery)
          if (!cancelled) setBusinessGoodsPayload(payload)
        } else if (reportType === 'business-truck') {
          const payload = await loadReportByTruck(activeQuery)
          if (!cancelled) setBusinessTruckPayload(payload)
        } else if (reportType === 'business-destination') {
          const payload = await loadReportByDestination(activeQuery)
          if (!cancelled) setBusinessDestinationPayload(payload)
        } else if (reportType === 'business-performance-drivers') {
          const payload = await loadReportPerformanceDrivers(activeQuery)
          if (!cancelled) setBusinessPerformanceDriversPayload(payload)
        } else if (reportType === 'business-performance-days') {
          const payload = await loadReportPerformanceDays(activeQuery)
          if (!cancelled) setBusinessPerformanceDaysPayload(payload)
        } else if (reportType === 'business-fuel') {
          const payload = await loadReportFuelSummary(activeQuery)
          if (!cancelled) setBusinessFuelPayload(payload)
        } else if (reportType === 'business-batches') {
          const payload = await loadReportBatches(activeQuery)
          if (!cancelled) setBusinessBatchesPayload(payload)
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

  const businessCards = [
    { label: 'Bons', value: summaryPayload?.missions?.totalMissions ?? 0, helper: 'missions trouvées' },
    { label: 'Clients', value: businessClientPayload?.rows?.length ?? 0, helper: 'dans le filtre' },
    { label: 'Produits', value: businessGoodsPayload?.rows?.length ?? 0, helper: 'dans le filtre' },
    { label: 'Camions', value: businessTruckPayload?.rows?.length ?? 0, helper: 'exploités' },
  ]

  const handleExport = () => {
    if (reportType === 'overview') return exportOverview(summaryPayload)
    if (reportType === 'fleet') return exportFleet(fleetPayload.rows)
    if (reportType === 'alerts') return exportAlerts(alertsPayload.rows)
    if (reportType === 'missions') return exportMissions(missionsPayload.rows)
    if (reportType === 'pivot') return exportPivot(pivotPayload.pivot)
    if (reportType === 'business-detailed') return exportGeneric('rapport-livraisons-detaillees.csv', ['Référence', 'Camion', 'Chauffeur', 'Client', 'Destination', 'Marchandise', 'Quantité', 'Départ', 'Arrivée', 'Statut', 'Date', 'Actif', 'Preuve'], businessDetailedPayload.rows, (row) => [row.reference, row.camion, row.chauffeur, row.client, row.destination, row.marchandise, row.quantite, row.depart, row.arrivee, row.statut, row.date, row.actif ? 'Oui' : 'Non', row.preuve])
    if (reportType === 'business-client') return exportGeneric('rapport-par-client.csv', ['Client', 'Bons', 'Quantité', 'Actifs', 'Livrés'], businessClientPayload.rows, (row) => [row.client, row.bons, row.quantite, row.actifs, row.livres])
    if (reportType === 'business-goods') return exportGeneric('rapport-par-produit.csv', ['Produit', 'Bons', 'Quantité', 'Clients', 'Destinations'], businessGoodsPayload.rows, (row) => [row.marchandise, row.bons, row.quantite, row.clients, row.destinations])
    if (reportType === 'business-truck') return exportGeneric('rapport-par-camion.csv', ['Camion', 'Chauffeur', 'Bons', 'Quantité', 'Actifs', 'Livrés', 'Destinations'], businessTruckPayload.rows, (row) => [row.camion, row.chauffeur, row.bons, row.quantite, row.actifs, row.livres, row.destinations])
    if (reportType === 'business-destination') return exportGeneric('rapport-par-destination.csv', ['Destination', 'Bons', 'Quantité', 'Clients', 'Camions', 'Livrés'], businessDestinationPayload.rows, (row) => [row.destination, row.bons, row.quantite, row.clients, row.camions, row.livres])
    if (reportType === 'business-performance-drivers') return exportGeneric('rapport-performance-chauffeurs.csv', ['Chauffeur', 'Rotations', 'Quantité', 'Livrés', 'Camions', 'Clients', 'Durée moyenne (h)'], businessPerformanceDriversPayload.rows, (row) => [row.chauffeur, row.rotations, row.quantite, row.livres, row.camions, row.clients, row.dureeMoyenneH])
    if (reportType === 'business-performance-days') return exportGeneric('rapport-performance-jours.csv', ['Date', 'Rotations', 'Quantité', 'Livrés', 'Clients', 'Destinations'], businessPerformanceDaysPayload.rows, (row) => [row.date, row.rotations, row.quantite, row.livres, row.clients, row.destinations])
    if (reportType === 'business-fuel') return exportGeneric('rapport-carburant-flotte.csv', ['Camion', 'Chauffeur', 'Statut', 'Distance (km)', 'Trajets', 'Carburant'], businessFuelPayload.rows, (row) => [row.camion, row.chauffeur, row.statut, row.distanceKm, row.trajets, row.carburant])
    return exportGeneric('rapport-batch-volumes.csv', ['Produit', 'Quantité livrée', 'Rotations', 'Camions', 'Clients'], businessBatchesPayload.rows, (row) => [row.produit, row.quantiteLivree, row.rotations, row.camions, row.clients])
  }

  const isBusinessReport = reportType.startsWith('business-')

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large reports-v2-hero">
      <div className="panel-header"><div><h3>Centre de rapports</h3><p>Fleeti + rapports métier de type Excel</p></div><button className="primary-btn" onClick={handleExport}>Exporter CSV</button></div>
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
          <option value="Prévu">Prévu</option>
        </select>
        <input placeholder="Produit / marchandise" value={filters.goods} onChange={(e) => setFilters((current) => ({ ...current, goods: e.target.value }))} />
      </div>
      {!isBusinessReport && <div className="reports-filter-grid" style={{ marginTop: 12 }}>
        <input placeholder="Type alerte (ex: speedup)" value={filters.eventType} onChange={(e) => setFilters((current) => ({ ...current, eventType: e.target.value }))} />
      </div>}
      {reportType === 'pivot' && <div className="reports-filter-grid reports-pivot-grid"><select value={filters.pivotRows} onChange={(e) => setFilters((current) => ({ ...current, pivotRows: e.target.value }))}>{PIVOT_DIMENSIONS.map((item) => <option key={item.value} value={item.value}>{item.label} lignes</option>)}</select><select value={filters.pivotCols} onChange={(e) => setFilters((current) => ({ ...current, pivotCols: e.target.value }))}>{PIVOT_DIMENSIONS.map((item) => <option key={item.value} value={item.value}>{item.label} colonnes</option>)}</select><select value={filters.metric} onChange={(e) => setFilters((current) => ({ ...current, metric: e.target.value }))}>{PIVOT_METRICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>}
      {loading && reportType !== 'overview' && <div className="info-banner">Chargement du rapport {REPORT_TYPES.find((item) => item.value === reportType)?.label?.toLowerCase()}…</div>}
      {error && <div className="error-banner">{error}</div>}
    </section>

    <section className="reports-summary-grid reports-v2-kpis">
      {(isBusinessReport ? businessCards : overviewCards).map((card) => <div key={card.label} className="overview-card"><span>{card.label}</span><strong>{card.value}</strong><small>{card.helper}</small></div>)}
    </section>

    {reportType === 'overview' && <section className="dashboard-grid premium-grid phase2-grid"><div className="panel"><div className="panel-header"><div><h3>Vue d’ensemble flotte</h3></div></div><div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.totalVehicles ?? 0}</strong><div><span>Véhicules</span><small>dans le périmètre</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.activeVehicles ?? 0}</strong><div><span>Actifs</span><small>connectés</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.fleet?.movingVehicles ?? 0}</strong><div><span>En mouvement</span><small>terrain</small></div></div></div></div><div className="panel"><div className="panel-header"><div><h3>Vue alertes & missions</h3></div></div><div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{summaryPayload?.alerts?.totalAlerts ?? 0}</strong><div><span>Alertes</span><small>toutes catégories</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.missions?.totalMissions ?? 0}</strong><div><span>Missions</span><small>bons enregistrés</small></div></div><div className="driver-rank-row static-row"><strong>{summaryPayload?.missions?.pendingProofs ?? 0}</strong><div><span>Preuves en attente</span><small>à compléter</small></div></div></div></div></section>}

    {reportType === 'fleet' && <GenericTable title="Rapport flotte détaillé" subtitle={`${fleetPayload?.rows?.length ?? 0} lignes`} rows={fleetPayload.rows || []} rowKey={(row) => row.trackerId} columns={[
      { key: 'immatriculation', label: 'Camion' },
      { key: 'conducteur', label: 'Conducteur' },
      { key: 'status', label: 'Statut' },
      { key: 'movementStatus', label: 'Mouvement' },
      { key: 'distanceKm', label: 'Distance', render: (value) => `${value} km` },
      { key: 'trajets', label: 'Trajets' },
      { key: 'alertCount', label: 'Alertes' },
      { key: 'vitesseMoy', label: 'Vit. moy', render: (value) => `${value} km/h` },
      { key: 'vitesseMax', label: 'Vit. max', render: (value) => `${value} km/h` },
      { key: 'inactiviteH', label: 'Inactivité', render: (value) => `${value} h` },
      { key: 'carburantL', label: 'Carburant' },
    ]} />}

    {reportType === 'alerts' && <GenericTable title="Rapport alertes" subtitle={`${alertsPayload?.rows?.length ?? 0} événements`} rows={alertsPayload.rows || []} rowKey={(row) => row.id} columns={[
      { key: 'time', label: 'Date', render: (value) => value ? new Date(value).toLocaleString() : '-' },
      { key: 'immatriculation', label: 'Camion' },
      { key: 'conducteur', label: 'Conducteur' },
      { key: 'eventType', label: 'Type' },
      { key: 'severity', label: 'Gravité' },
      { key: 'address', label: 'Adresse' },
      { key: 'message', label: 'Message' },
    ]} />}

    {reportType === 'missions' && <GenericTable title="Rapport missions" subtitle={`${missionsPayload?.rows?.length ?? 0} bons`} rows={missionsPayload.rows || []} rowKey={(row) => row.id} columns={[
      { key: 'reference', label: 'Référence' },
      { key: 'immatriculation', label: 'Camion' },
      { key: 'conducteur', label: 'Conducteur' },
      { key: 'client', label: 'Client' },
      { key: 'destination', label: 'Destination' },
      { key: 'status', label: 'Statut' },
      { key: 'active', label: 'Actif', render: (value) => value ? 'Oui' : 'Non' },
      { key: 'date', label: 'Date', render: (value) => value ? new Date(value).toLocaleString() : '-' },
      { key: 'proofStatus', label: 'Preuve' },
    ]} />}

    {reportType === 'pivot' && <section className="panel panel-large"><div className="panel-header"><div><h3>Tableau croisé</h3><p>{pivotPayload?.pivot?.rowsKey} × {pivotPayload?.pivot?.colsKey}</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Ligne</th>{(pivotPayload?.pivot?.columns || []).map((column) => <th key={column}>{column}</th>)}<th>Total</th></tr></thead><tbody>{(pivotPayload?.pivot?.rows || []).map((row) => <tr key={row.label}><td>{row.label}</td>{(pivotPayload?.pivot?.columns || []).map((column) => <td key={`${row.label}-${column}`}>{row.values?.[column] ?? 0}</td>)}<td>{row.total}</td></tr>)}</tbody></table></div></section>}

    {reportType === 'business-detailed' && <GenericTable title="Livraisons détaillées" subtitle={`${businessDetailedPayload?.rows?.length ?? 0} lignes`} rows={businessDetailedPayload.rows || []} rowKey={(row, index) => `${row.reference}-${row.camion}-${index}`} columns={[
      { key: 'reference', label: 'Référence' },
      { key: 'camion', label: 'Camion' },
      { key: 'chauffeur', label: 'Chauffeur' },
      { key: 'client', label: 'Client' },
      { key: 'destination', label: 'Destination' },
      { key: 'marchandise', label: 'Produit' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'depart', label: 'Départ', render: (value) => formatDateTime(value) },
      { key: 'arrivee', label: 'Arrivée', render: (value) => formatDateTime(value) },
      { key: 'statut', label: 'Statut' },
      { key: 'preuve', label: 'Preuve' },
    ]} />}

    {reportType === 'business-client' && <GenericTable title="Rapport par client" subtitle={`${businessClientPayload?.rows?.length ?? 0} clients`} rows={businessClientPayload.rows || []} rowKey={(row) => row.client} columns={[
      { key: 'client', label: 'Client' },
      { key: 'bons', label: 'Bons' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'actifs', label: 'Actifs' },
      { key: 'livres', label: 'Livrés' },
    ]} />}

    {reportType === 'business-goods' && <GenericTable title="Rapport par produit" subtitle={`${businessGoodsPayload?.rows?.length ?? 0} produits`} rows={businessGoodsPayload.rows || []} rowKey={(row) => row.marchandise} columns={[
      { key: 'marchandise', label: 'Produit' },
      { key: 'bons', label: 'Bons' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'clients', label: 'Clients' },
      { key: 'destinations', label: 'Destinations' },
    ]} />}

    {reportType === 'business-truck' && <GenericTable title="Rapport par camion" subtitle={`${businessTruckPayload?.rows?.length ?? 0} camions`} rows={businessTruckPayload.rows || []} rowKey={(row) => row.camion} columns={[
      { key: 'camion', label: 'Camion' },
      { key: 'chauffeur', label: 'Chauffeur' },
      { key: 'bons', label: 'Bons' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'actifs', label: 'Actifs' },
      { key: 'livres', label: 'Livrés' },
      { key: 'destinations', label: 'Destinations' },
    ]} />}

    {reportType === 'business-destination' && <GenericTable title="Récap par destination" subtitle={`${businessDestinationPayload?.rows?.length ?? 0} destinations`} rows={businessDestinationPayload.rows || []} rowKey={(row) => row.destination} columns={[
      { key: 'destination', label: 'Destination' },
      { key: 'bons', label: 'Bons' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'clients', label: 'Clients' },
      { key: 'camions', label: 'Camions' },
      { key: 'livres', label: 'Livrés' },
    ]} />}

    {reportType === 'business-performance-drivers' && <GenericTable title="Performance chauffeurs" subtitle={`${businessPerformanceDriversPayload?.rows?.length ?? 0} chauffeurs`} rows={businessPerformanceDriversPayload.rows || []} rowKey={(row) => row.chauffeur} columns={[
      { key: 'chauffeur', label: 'Chauffeur' },
      { key: 'rotations', label: 'Rotations' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'livres', label: 'Livrés' },
      { key: 'camions', label: 'Camions' },
      { key: 'clients', label: 'Clients' },
      { key: 'dureeMoyenneH', label: 'Durée moy. (h)' },
    ]} />}

    {reportType === 'business-performance-days' && <GenericTable title="Performance journalière" subtitle={`${businessPerformanceDaysPayload?.rows?.length ?? 0} jours`} rows={businessPerformanceDaysPayload.rows || []} rowKey={(row) => row.date} columns={[
      { key: 'date', label: 'Date' },
      { key: 'rotations', label: 'Rotations' },
      { key: 'quantite', label: 'Quantité' },
      { key: 'livres', label: 'Livrés' },
      { key: 'clients', label: 'Clients' },
      { key: 'destinations', label: 'Destinations' },
    ]} />}

    {reportType === 'business-fuel' && <GenericTable title="Carburant / flotte" subtitle={`${businessFuelPayload?.rows?.length ?? 0} lignes`} rows={businessFuelPayload.rows || []} rowKey={(row) => row.camion} columns={[
      { key: 'camion', label: 'Camion' },
      { key: 'chauffeur', label: 'Chauffeur' },
      { key: 'statut', label: 'Statut' },
      { key: 'distanceKm', label: 'Distance (km)' },
      { key: 'trajets', label: 'Trajets' },
      { key: 'carburant', label: 'Carburant' },
    ]} />}

    {reportType === 'business-batches' && <GenericTable title="Batch / volumes" subtitle={`${businessBatchesPayload?.rows?.length ?? 0} produits`} rows={businessBatchesPayload.rows || []} rowKey={(row) => row.produit} columns={[
      { key: 'produit', label: 'Produit' },
      { key: 'quantiteLivree', label: 'Quantité livrée' },
      { key: 'rotations', label: 'Rotations' },
      { key: 'camions', label: 'Camions' },
      { key: 'clients', label: 'Clients' },
    ]} />}
  </div>
}
