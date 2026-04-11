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
  loadReportProjects,
  loadReportSummary,
  loadDeliveryOrders,
  loadFuelVouchers,
} from '../lib/fleeti'

const REPORT_TYPES = [
  { value: 'custom-high-level-k1', label: 'HIGH LEVEL K1' },
  { value: 'custom-high-level-caderac', label: 'HIGH LEVEL CADERAC' },
  { value: 'custom-reconciliation-k1', label: 'ETAT RECONCILIATION K1' },
  { value: 'custom-fuel-by-supplier', label: 'SUIVI BON DE CARBURANT' },
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
  const exportAt = new Date().toLocaleString('fr-FR')
  const finalRows = [
    ['Date export', exportAt],
    [],
    ...rows,
  ]
  const csv = finalRows.map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
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

function formatFrenchQuantity(value, digits = 3) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value ?? '-'
  return number.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function GenericTable({ title, subtitle, columns, rows, rowKey }) {
  return <section className="panel panel-large"><div className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="reports-table-wrap"><table className="reports-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={rowKey ? rowKey(row, index) : index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row[column.key], row) : (row[column.key] ?? '-')}</td>)}</tr>)}</tbody></table></div></section>
}

export function ReportsPage() {
  const [reportType, setReportType] = useState('custom-high-level-k1')
  const [filters, setFilters] = useState({
    period: '48h',
    trackerId: '',
    driver: '',
    status: '',
    eventType: '',
    client: '',
    destination: '',
    goods: '',
    project: '',
    targetQuantity: '',
    pivotRows: 'tracker',
    pivotCols: 'event',
    metric: 'count',
    dateFrom: '',
    dateTo: '',
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
  const [businessProjectsPayload, setBusinessProjectsPayload] = useState({ rows: [] })
  const [filterOptionsPayload, setFilterOptionsPayload] = useState({
    missions: { rows: [] },
    clients: { rows: [] },
    goods: { rows: [] },
    destinations: { rows: [] },
    projects: { rows: [] },
    performanceDrivers: { rows: [] },
  })
  const [rawDeliveryOrders, setRawDeliveryOrders] = useState([])
  const [rawFuelVouchers, setRawFuelVouchers] = useState([])

  const summaryQuery = useMemo(() => buildQuery({
    period: filters.period,
    trackerId: filters.trackerId,
    driver: filters.driver,
    status: filters.status,
    eventType: filters.eventType,
    client: filters.client,
    destination: filters.destination,
    goods: filters.goods,
    project: filters.project,
    targetQuantity: filters.targetQuantity,
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

    async function loadBaseOrders() {
      try {
        const [deliveries, fuel] = await Promise.all([
          loadDeliveryOrders(),
          loadFuelVouchers(),
        ])
        if (!cancelled) {
          setRawDeliveryOrders(deliveries?.items || [])
          setRawFuelVouchers(fuel?.items || [])
        }
      } catch {
        if (!cancelled) {
          setRawDeliveryOrders([])
          setRawFuelVouchers([])
        }
      }
    }

    loadBaseOrders()

    async function loadFilterOptions() {
      try {
        const baseQuery = buildQuery({ period: filters.period })
        const [missions, clients, goods, destinations, projects, performanceDrivers] = await Promise.all([
          loadReportMissions(baseQuery),
          loadReportByClient(baseQuery),
          loadReportByGoods(baseQuery),
          loadReportByDestination(baseQuery),
          loadReportProjects(baseQuery),
          loadReportPerformanceDrivers(baseQuery),
        ])
        if (!cancelled) {
          setFilterOptionsPayload({ missions, clients, goods, destinations, projects, performanceDrivers })
        }
      } catch {
        if (!cancelled) {
          setFilterOptionsPayload({
            missions: { rows: [] },
            clients: { rows: [] },
            goods: { rows: [] },
            destinations: { rows: [] },
            projects: { rows: [] },
            performanceDrivers: { rows: [] },
          })
        }
      }
    }

    loadFilterOptions()
    return () => {
      cancelled = true
    }
  }, [filters.period])

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
        } else if (reportType === 'business-projects') {
          const payload = await loadReportProjects(activeQuery)
          if (!cancelled) setBusinessProjectsPayload(payload)
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

  const driverOptions = useMemo(() => {
    const values = new Set()
    ;(filterOptionsPayload?.missions?.rows || []).forEach((row) => row?.conducteur && values.add(row.conducteur))
    ;(filterOptionsPayload?.performanceDrivers?.rows || []).forEach((row) => row?.chauffeur && values.add(row.chauffeur))
    ;(fleetPayload?.rows || []).forEach((row) => row?.conducteur && values.add(row.conducteur))
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [filterOptionsPayload, fleetPayload])

  const clientOptions = useMemo(() => {
    const values = new Set()
    ;(filterOptionsPayload?.missions?.rows || []).forEach((row) => row?.client && values.add(row.client))
    ;(filterOptionsPayload?.clients?.rows || []).forEach((row) => row?.client && values.add(row.client))
    ;(filterOptionsPayload?.projects?.rows || []).forEach((row) => row?.client && values.add(row.client))
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [filterOptionsPayload])

  const destinationOptions = useMemo(() => {
    const values = new Set()
    ;(filterOptionsPayload?.missions?.rows || []).forEach((row) => row?.destination && values.add(row.destination))
    ;(filterOptionsPayload?.destinations?.rows || []).forEach((row) => row?.destination && values.add(row.destination))
    ;(filterOptionsPayload?.projects?.rows || []).forEach((row) => row?.destination && values.add(row.destination))
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [filterOptionsPayload])

  const goodsOptions = useMemo(() => {
    const values = new Set()
    ;(filterOptionsPayload?.missions?.rows || []).forEach((row) => row?.goods && values.add(row.goods))
    ;(filterOptionsPayload?.goods?.rows || []).forEach((row) => row?.marchandise && values.add(row.marchandise))
    ;(businessBatchesPayload?.rows || []).forEach((row) => row?.produit && values.add(row.produit))
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [filterOptionsPayload, businessBatchesPayload])

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

  const inDateRange = (value) => {
    if (!value) return true
    const current = new Date(value)
    if (Number.isNaN(current.getTime())) return false
    if (filters.dateFrom) {
      const from = new Date(`${filters.dateFrom}T00:00:00`)
      if (current < from) return false
    }
    if (filters.dateTo) {
      const to = new Date(`${filters.dateTo}T23:59:59`)
      if (current > to) return false
    }
    return true
  }

  const normalizedDeliveries = useMemo(() => rawDeliveryOrders.map((row) => ({
    reference: row.reference,
    produit: row.goods,
    quantite: Number(row.quantity) || 0,
    dechargement: row.arrivalDateTime || row.date,
    immatriculation: row.truckLabel,
    client: row.client,
    destination: row.destination,
    chauffeur: row.driver,
  })), [rawDeliveryOrders])

  const k1Rows = useMemo(() => normalizedDeliveries.filter((row) => String(row.client || '').toUpperCase().includes('K1') && inDateRange(row.dechargement)), [normalizedDeliveries, filters.dateFrom, filters.dateTo])
  const caderacRows = useMemo(() => normalizedDeliveries.filter((row) => String(row.client || '').toUpperCase().includes('CADERAC') && inDateRange(row.dechargement)), [normalizedDeliveries, filters.dateFrom, filters.dateTo])

  const k1Batch05Rows = useMemo(() => k1Rows.filter((row) => /0\/?5/i.test(String(row.produit || ''))), [k1Rows])
  const k1Batch1014Rows = useMemo(() => k1Rows.filter((row) => /10\/?14/i.test(String(row.produit || ''))), [k1Rows])

  const caderacByDestination = useMemo(() => {
    const map = new Map()
    caderacRows.forEach((row) => {
      const key = row.destination || 'Non renseignée'
      map.set(key, (map.get(key) || 0) + (Number(row.quantite) || 0))
    })
    return Array.from(map.entries()).map(([destination, quantite]) => ({ destination, quantite }))
  }, [caderacRows])

  const fuelBySupplierRows = useMemo(() => {
    const filtered = rawFuelVouchers.filter((row) => inDateRange(row.dateTime))
    return filtered
  }, [rawFuelVouchers, filters.dateFrom, filters.dateTo])

  const fuelBySupplierTotal = useMemo(() => fuelBySupplierRows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0), [fuelBySupplierRows])

  const handleExport = () => {
    if (reportType === 'overview') return exportOverview(summaryPayload)
    if (reportType === 'fleet') return exportFleet(fleetPayload.rows)
    if (reportType === 'alerts') return exportAlerts(alertsPayload.rows)
    if (reportType === 'missions') return exportMissions(missionsPayload.rows)
    if (reportType === 'pivot') return exportPivot(pivotPayload.pivot)
    if (reportType === 'business-detailed') return exportGeneric('rapport-livraisons-detaillees.csv', ['Référence', 'Camion', 'Chauffeur', 'Client', 'Destination', 'Marchandise', 'Quantité', 'Départ', 'Arrivée', 'Statut', 'Date', 'Actif', 'Preuve'], businessDetailedPayload.rows, (row) => [row.reference, row.camion, row.chauffeur, row.client, row.destination, row.marchandise, row.quantite, row.depart, row.arrivee, row.statut, row.date, row.actif ? 'Oui' : 'Non', row.preuve])
    if (reportType === 'business-client') return exportGeneric('rapport-par-client.csv', ['Client', 'Bons', 'Quantité', 'Actifs', 'Livrés'], businessClientPayload.rows, (row) => [row.client, row.bons, formatFrenchQuantity(row.quantite), row.actifs, row.livres])
    if (reportType === 'business-goods') return exportGeneric('rapport-par-produit.csv', ['Produit', 'Bons', 'Quantité', 'Clients', 'Destinations'], businessGoodsPayload.rows, (row) => [row.marchandise, row.bons, formatFrenchQuantity(row.quantite), row.clients, row.destinations])
    if (reportType === 'business-truck') return exportGeneric('rapport-par-camion.csv', ['Camion', 'Chauffeur', 'Bons', 'Quantité', 'Actifs', 'Livrés', 'Destinations'], businessTruckPayload.rows, (row) => [row.camion, row.chauffeur, row.bons, formatFrenchQuantity(row.quantite), row.actifs, row.livres, row.destinations])
    if (reportType === 'business-destination') return exportGeneric('rapport-par-destination.csv', ['Destination', 'Bons', 'Quantité', 'Clients', 'Camions', 'Livrés'], businessDestinationPayload.rows, (row) => [row.destination, row.bons, formatFrenchQuantity(row.quantite), row.clients, row.camions, row.livres])
    if (reportType === 'business-performance-drivers') return exportGeneric('rapport-performance-chauffeurs.csv', ['Chauffeur', 'Rotations', 'Quantité', 'Livrés', 'Camions', 'Clients', 'Durée moyenne (h)'], businessPerformanceDriversPayload.rows, (row) => [row.chauffeur, row.rotations, formatFrenchQuantity(row.quantite), row.livres, row.camions, row.clients, row.dureeMoyenneH])
    if (reportType === 'business-performance-days') return exportGeneric('rapport-performance-jours.csv', ['Date', 'Rotations', 'Quantité', 'Livrés', 'Clients', 'Destinations'], businessPerformanceDaysPayload.rows, (row) => [row.date, row.rotations, formatFrenchQuantity(row.quantite), row.livres, row.clients, row.destinations])
    if (reportType === 'business-fuel') return exportGeneric('rapport-carburant-flotte.csv', ['Camion', 'Chauffeur', 'Statut', 'Distance (km)', 'Trajets', 'Carburant'], businessFuelPayload.rows, (row) => [row.camion, row.chauffeur, row.statut, formatFrenchQuantity(row.distanceKm, 1), row.trajets, row.carburant])
    if (reportType === 'business-batches') return exportGeneric('rapport-batch-volumes.csv', ['Produit', 'Quantité livrée', 'Objectif', 'Restant', 'Completion %', 'Rotations', 'Camions', 'Clients'], businessBatchesPayload.rows, (row) => [row.produit, formatFrenchQuantity(row.quantiteLivree), row.objectif ? formatFrenchQuantity(row.objectif) : '', row.restant !== null && row.restant !== undefined ? formatFrenchQuantity(row.restant) : '', row.completion ?? '', row.rotations, row.camions, row.clients])
    if (reportType === 'custom-high-level-k1') {
      const rows = [
        ['HIGH LEVEL K1 - PRODUIT 0/5'],
        ['N° BL', 'Type produit', 'Qté', 'Date/heure déchargement', 'Immatriculation'],
        ...k1Batch05Rows.map((row) => [row.reference, row.produit, formatFrenchQuantity(row.quantite), formatDateTime(row.dechargement), row.immatriculation]),
        [],
        ['HIGH LEVEL K1 - PRODUIT 10/14'],
        ['N° BL', 'Type produit', 'Qté', 'Date/heure déchargement', 'Immatriculation'],
        ...k1Batch1014Rows.map((row) => [row.reference, row.produit, formatFrenchQuantity(row.quantite), formatDateTime(row.dechargement), row.immatriculation]),
      ]
      return downloadCsv('rapport-high-level-k1.csv', rows)
    }
    if (reportType === 'custom-high-level-caderac') {
      const rows = [
        ['HIGH LEVEL CADERAC - DETAIL'],
        ['N° BL', 'Type produit', 'Qté', 'Date/heure déchargement', 'Immatriculation', 'Destination'],
        ...caderacRows.map((row) => [row.reference, row.produit, formatFrenchQuantity(row.quantite), formatDateTime(row.dechargement), row.immatriculation, row.destination]),
        [],
        ['QUANTITE PAR DESTINATION'],
        ['Destination', 'Qté'],
        ...caderacByDestination.map((row) => [row.destination, formatFrenchQuantity(row.quantite)]),
        [],
        ['QUANTITE TOTALE', formatFrenchQuantity(caderacRows.reduce((acc, row) => acc + (Number(row.quantite) || 0), 0))],
      ]
      return downloadCsv('rapport-high-level-caderac.csv', rows)
    }
    if (reportType === 'custom-reconciliation-k1') {
      return exportGeneric('rapport-reconciliation-k1.csv', ['N° BL', 'Type produit', 'Qté', 'Date/heure déchargement', 'Immatriculation', 'Chauffeur'], k1Rows, (row) => [row.reference, row.produit, formatFrenchQuantity(row.quantite), formatDateTime(row.dechargement), row.immatriculation, row.chauffeur])
    }
    if (reportType === 'custom-fuel-by-supplier') {
      const rows = [
        ['Fournisseur', 'N° bon', 'Immatriculation', 'Date/heure prise', 'Qté', 'Prix unitaire', 'Montant'],
        ...fuelBySupplierRows.map((row) => [row.supplier || '-', row.voucherNumber || '-', row.truckLabel || '-', formatDateTime(row.dateTime), formatFrenchQuantity(row.quantityLiters), formatFrenchQuantity(row.unitPrice), formatFrenchQuantity(row.amount)]),
        [],
        ['MONTANT TOTAL', '', '', '', '', '', formatFrenchQuantity(fuelBySupplierTotal)],
      ]
      return downloadCsv('rapport-suivi-bon-carburant.csv', rows)
    }
    return exportGeneric('rapport-projets-clients.csv', ['Projet', 'Client', 'Destination', 'Bons', 'Quantité livrée', 'Camions', 'Chauffeurs', 'Marchandises'], businessProjectsPayload.rows, (row) => [row.projet, row.client, row.destination, row.bons, formatFrenchQuantity(row.quantiteLivree), row.camions, row.chauffeurs, row.marchandises])
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large reports-v2-hero">
      <div className="panel-header"><div><h3>Centre de rapports métier</h3><p>Rapports TLM alignés sur ton fichier de suivi</p></div><button className="primary-btn" onClick={handleExport}>Exporter CSV (période)</button></div>
      <div className="filters filter-row">{REPORT_TYPES.map((item) => <button key={item.value} className={`chip ${reportType === item.value ? 'selected' : ''}`} onClick={() => setReportType(item.value)}>{item.label}</button>)}</div>
      <div className="reports-filter-grid" style={{ marginTop: 12 }}>
        <label className="field-stack"><span>Du</span><input type="date" value={filters.dateFrom} onChange={(e) => setFilters((current) => ({ ...current, dateFrom: e.target.value }))} /></label>
        <label className="field-stack"><span>Au</span><input type="date" value={filters.dateTo} onChange={(e) => setFilters((current) => ({ ...current, dateTo: e.target.value }))} /></label>
      </div>
      {loading && <div className="info-banner">Chargement du rapport…</div>}
      {error && <div className="error-banner">{error}</div>}
    </section>

    <section className="reports-summary-grid reports-v2-kpis">
      <div className="overview-card"><span>Période</span><strong>{filters.dateFrom || '...'} → {filters.dateTo || '...'}</strong><small>filtre appliqué</small></div>
      {reportType === 'custom-high-level-k1' && <div className="overview-card"><span>Bons K1</span><strong>{k1Rows.length}</strong><small>dans la période</small></div>}
      {reportType === 'custom-high-level-caderac' && <div className="overview-card"><span>Bons CADERAC</span><strong>{caderacRows.length}</strong><small>dans la période</small></div>}
      {reportType === 'custom-fuel-by-supplier' && <div className="overview-card"><span>Montant total carburant</span><strong>{formatFrenchQuantity(fuelBySupplierTotal)}</strong><small>FCFA</small></div>}
    </section>

    {reportType === 'business-projects' && <GenericTable title="Projets / clients" subtitle={`${businessProjectsPayload?.rows?.length ?? 0} projets`} rows={businessProjectsPayload.rows || []} rowKey={(row) => row.projet} columns={[
      { key: 'projet', label: 'Projet' },
      { key: 'client', label: 'Client' },
      { key: 'destination', label: 'Destination' },
      { key: 'bons', label: 'Bons' },
      { key: 'quantiteLivree', label: 'Quantité livrée', render: (value) => formatFrenchQuantity(value) },
      { key: 'camions', label: 'Camions' },
      { key: 'chauffeurs', label: 'Chauffeurs' },
      { key: 'marchandises', label: 'Marchandises' },
    ]} />}

    {reportType === 'custom-high-level-k1' && <>
      <GenericTable title="HIGH LEVEL K1 - Produit 0/5" subtitle={`${k1Batch05Rows.length} lignes`} rows={k1Batch05Rows} rowKey={(row, i) => `${row.reference}-${i}`} columns={[
        { key: 'reference', label: 'N° BL' },
        { key: 'produit', label: 'Type produit' },
        { key: 'quantite', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
        { key: 'dechargement', label: 'Date/heure déchargement', render: (value) => formatDateTime(value) },
        { key: 'immatriculation', label: 'Immatriculation' },
      ]} />
      <GenericTable title="HIGH LEVEL K1 - Produit 10/14" subtitle={`${k1Batch1014Rows.length} lignes`} rows={k1Batch1014Rows} rowKey={(row, i) => `${row.reference}-${i}`} columns={[
        { key: 'reference', label: 'N° BL' },
        { key: 'produit', label: 'Type produit' },
        { key: 'quantite', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
        { key: 'dechargement', label: 'Date/heure déchargement', render: (value) => formatDateTime(value) },
        { key: 'immatriculation', label: 'Immatriculation' },
      ]} />
    </>}

    {reportType === 'custom-high-level-caderac' && <>
      <GenericTable title="HIGH LEVEL CADERAC - Détail" subtitle={`${caderacRows.length} lignes`} rows={caderacRows} rowKey={(row, i) => `${row.reference}-${i}`} columns={[
        { key: 'reference', label: 'N° BL' },
        { key: 'produit', label: 'Type produit' },
        { key: 'quantite', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
        { key: 'dechargement', label: 'Date/heure déchargement', render: (value) => formatDateTime(value) },
        { key: 'immatriculation', label: 'Immatriculation' },
        { key: 'destination', label: 'Destination' },
      ]} />
      <GenericTable title="CADERAC - Quantité par destination" subtitle={`${caderacByDestination.length} destinations`} rows={caderacByDestination} rowKey={(row) => row.destination} columns={[
        { key: 'destination', label: 'Destination' },
        { key: 'quantite', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
      ]} />
      <section className="panel panel-large"><div className="panel-header"><div><h3>Quantité totale CADERAC</h3></div></div><div className="mini-kpi"><strong>{formatFrenchQuantity(caderacRows.reduce((acc, row) => acc + (Number(row.quantite) || 0), 0))}</strong></div></section>
    </>}

    {reportType === 'custom-reconciliation-k1' && <GenericTable title="ETAT DE RECONCILIATION K1" subtitle={`${k1Rows.length} lignes`} rows={k1Rows} rowKey={(row, i) => `${row.reference}-${i}`} columns={[
      { key: 'reference', label: 'N° BL' },
      { key: 'produit', label: 'Type produit' },
      { key: 'quantite', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
      { key: 'dechargement', label: 'Date/heure déchargement', render: (value) => formatDateTime(value) },
      { key: 'immatriculation', label: 'Immatriculation' },
      { key: 'chauffeur', label: 'Nom chauffeur' },
    ]} />}

    {reportType === 'custom-fuel-by-supplier' && <>
      <GenericTable title="SUIVI BON DE CARBURANT (par fournisseur)" subtitle={`${fuelBySupplierRows.length} lignes`} rows={fuelBySupplierRows} rowKey={(row) => row.id} columns={[
        { key: 'supplier', label: 'Fournisseur' },
        { key: 'voucherNumber', label: 'N° BL / N° bon' },
        { key: 'truckLabel', label: 'Immatriculation' },
        { key: 'dateTime', label: 'Date/heure de prise', render: (value) => formatDateTime(value) },
        { key: 'quantityLiters', label: 'Qté', render: (value) => formatFrenchQuantity(value) },
        { key: 'unitPrice', label: 'Prix unitaire', render: (value) => formatFrenchQuantity(value) },
        { key: 'amount', label: 'Montant', render: (value) => formatFrenchQuantity(value) },
      ]} />
      <section className="panel panel-large"><div className="panel-header"><div><h3>Montant TOTAL</h3></div></div><div className="mini-kpi"><strong>{formatFrenchQuantity(fuelBySupplierTotal)}</strong></div></section>
    </>}
  </div>
}
