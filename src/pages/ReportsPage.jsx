import { useEffect, useMemo, useState } from 'react'
import { StableDatePicker } from '../components/StableDatePicker'
import { ErrorBanner, LoadingBanner } from '../components/FeedbackBanners'
import { SkeletonTable } from '../components/Skeleton'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import {
  loadDeliveryOrders,
  loadFuelVouchers,
  loadMasterData,
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
  loadVehicles,
  loadEmployeesDetail,
} from '../lib/fleeti'
import { parseDeliveryQuantity } from '../lib/deliveryOrders.js'
import { AlertTriangle, CheckCircle, Shield, Truck } from 'lucide-react'

const STATIC_REPORT_TYPES = [
  { value: 'reco-k1', label: 'ETAT RECONCILIATION K1' },
  { value: 'reco-caderac', label: 'ETAT RECONCILIATION CADERAC ABIDJAN' },
  { value: 'reco-lafarge', label: 'ETAT RECONCILIATION LAFARGE' },
  { value: 'fuel', label: 'SUIVI BON DE CARBURANT' },
  { value: 'fleet-compliance', label: 'FLOTTE & CONFORMITÉ' },
]

const OPERATIONAL_REPORT_TYPES = [
  { value: 'ops-summary', label: 'SYNTHESE OPERATIONNELLE', loader: loadReportSummary },
  { value: 'ops-fleet', label: 'FLOTTE & TRAJETS', loader: loadReportFleet },
  { value: 'ops-alerts', label: 'ALERTES', loader: loadReportAlerts },
  { value: 'ops-missions', label: 'MISSIONS', loader: loadReportMissions },
  { value: 'ops-pivot', label: 'TABLEAU CROISE', loader: loadReportPivot },
  { value: 'ops-detailed-deliveries', label: 'LIVRAISONS DETAILLEES', loader: loadReportDetailedDeliveries },
  { value: 'ops-by-client', label: 'PAR CLIENT', loader: loadReportByClient },
  { value: 'ops-by-goods', label: 'PAR PRODUIT', loader: loadReportByGoods },
  { value: 'ops-by-truck', label: 'PAR CAMION', loader: loadReportByTruck },
  { value: 'ops-by-destination', label: 'PAR DESTINATION', loader: loadReportByDestination },
  { value: 'ops-performance-drivers', label: 'PERFORMANCE CHAUFFEURS', loader: loadReportPerformanceDrivers },
  { value: 'ops-performance-days', label: 'PERFORMANCE JOURNALIERE', loader: loadReportPerformanceDays },
  { value: 'ops-fuel-summary', label: 'SYNTHESE CARBURANT', loader: loadReportFuelSummary },
  { value: 'ops-batches', label: 'LOTS / OBJECTIFS', loader: loadReportBatches },
  { value: 'ops-projects', label: 'PROJETS', loader: loadReportProjects },
]

const OPERATIONAL_REPORTS_BY_VALUE = Object.fromEntries(OPERATIONAL_REPORT_TYPES.map((item) => [item.value, item]))

function toDate(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateTime(value) {
  const d = toDate(value)
  return d ? d.toLocaleString('fr-FR') : '-'
}

function toQtyNumber(value) {
  return parseDeliveryQuantity(value)
}

function formatQty(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '-'
  const n = toQtyNumber(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function formatQtyPlain(value, digits = 2) {
  const n = toQtyNumber(value)
  return n.toFixed(digits).replace('.', ',')
}

function formatMoney(value) {
  const n = toQtyNumber(value)
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function ymdToDate(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function dateToYmd(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatPeriodLabel(from, to) {
  const formatShort = (value) => {
    if (!value) return '...'
    const base = new Date(`${value}T00:00:00`)
    if (Number.isNaN(base.getTime())) return '...'
    return base.toLocaleDateString('fr-FR')
  }
  return `du ${formatShort(from)} au ${formatShort(to)}`
}

function inRange(value, from, to) {
  const d = toDate(value)
  if (!d) return false
  if (from) {
    const f = new Date(`${from}T00:00:00`)
    if (d < f) return false
  }
  if (to) {
    const t = new Date(`${to}T23:59:59`)
    if (d > t) return false
  }
  return true
}

function parseReferenceNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return Number.POSITIVE_INFINITY
  const digits = raw.match(/\d+/g)
  if (!digits || digits.length === 0) return Number.POSITIVE_INFINITY
  return Number(digits.join(''))
}

function sortByReference(rows = [], selector) {
  return [...rows].sort((a, b) => {
    const leftRaw = String(selector(a) || '')
    const rightRaw = String(selector(b) || '')
    const leftNum = parseReferenceNumber(leftRaw)
    const rightNum = parseReferenceNumber(rightRaw)
    if (leftNum !== rightNum) return leftNum - rightNum
    return leftRaw.localeCompare(rightRaw, 'fr', { numeric: true, sensitivity: 'base' })
  })
}

function normalizeClientName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function getClientKey(value) {
  return normalizeClientName(value).toUpperCase()
}

function groupRowsByGoods(rows = []) {
  const groups = new Map()
  rows.forEach((row) => {
    const key = String(row.goods || 'Produit non renseigné').trim() || 'Produit non renseigné'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })
  return Array.from(groups.entries())
    .map(([goods, items]) => ({ goods, items: sortByReference(items, (row) => row.reference) }))
    .sort((a, b) => a.goods.localeCompare(b.goods, 'fr', { sensitivity: 'base' }))
}

function downloadCsv(filename, rows, from, to) {
  const exportAt = new Date().toLocaleString('fr-FR')
  const finalRows = [['Date export', exportAt], ['Période', formatPeriodLabel(from, to)], [], ...rows]
  const csv = finalRows.map((line) => line.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function loadLogoDataUrl() {
  const response = await fetch('/teliman-logistique-logo.jpg')
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de charger le logo'))
    reader.readAsDataURL(blob)
  })
}

async function buildPdfHeader(doc, title, from, to, purchaseOrderNumber = '') {
  const brandBrown = [120, 72, 32]
  const logoPanel = [248, 244, 236]
  const now = new Date().toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  doc.setFillColor(...brandBrown)
  doc.roundedRect(12, 8, 273, 40, 4, 4, 'F')
  doc.setFillColor(...logoPanel)
  doc.roundedRect(16, 13, 66, 20, 3, 3, 'F')

  try {
    const logo = await loadLogoDataUrl()
    doc.addImage(logo, 'JPEG', 19, 15, 60, 13)
  } catch {
    doc.setTextColor(...brandBrown)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('TELIMAN', 24, 25)
  }

  const titleCenterX = 150
  const titleText = purchaseOrderNumber ? `${title} - BC: ${purchaseOrderNumber}` : title
  doc.setDrawColor(...brandBrown)
  doc.setLineWidth(1.2)
  doc.line(14, 50, 283, 50)

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  const longTitle = titleText.length > 34
  doc.setFontSize(longTitle ? 15 : 18)
  const wrappedTitle = doc.splitTextToSize(titleText, 110)
  doc.text(wrappedTitle, titleCenterX, wrappedTitle.length > 1 ? 19 : 24, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Période: ${formatPeriodLabel(from, to)}`, 280, 22, { align: 'right' })
  doc.text(`Édité le: ${now}`, 280, 31, { align: 'right' })
}

function drawPdfFooter(doc) {
  const pages = doc.getNumberOfPages()
  const brandBrown = [120, 72, 32]
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(...brandBrown)
    doc.setLineWidth(0.4)
    doc.line(14, 200, 283, 200)
    doc.setTextColor(...brandBrown)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Teliman Logistique', 14, 206)
    doc.text(`Page ${page}/${pages}`, 283, 206, { align: 'right' })
  }
}

function formatObjectAsInlineSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return String(value)
  const entries = Object.entries(value).slice(0, 6)
  if (!entries.length) return '{}'
  return entries.map(([k, v]) => {
    const val = v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `${titleFromKey(k)}: ${val}`
  }).join(' · ')
}

function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('fr-FR') : value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  if (Array.isArray(value)) return value.length ? value.map(formatCellValue).join(', ') : '-'
  if (typeof value === 'object') return formatObjectAsInlineSummary(value)
  return String(value)
}

function titleFromKey(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function extractRows(payload = {}) {
  if (Array.isArray(payload.rows)) return payload.rows
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.pivot?.rows)) return payload.pivot.rows
  if (Array.isArray(payload.fleet?.rows)) return payload.fleet.rows
  return []
}

function extractSummaries(payload = {}) {
  const entries = []
  const pushObject = (prefix, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    Object.entries(value).forEach(([key, entry]) => {
      if (entry && typeof entry === 'object') return
      entries.push({ label: prefix ? `${prefix} ${titleFromKey(key)}` : titleFromKey(key), value: formatCellValue(entry) })
    })
  }
  pushObject('', payload.summary)
  pushObject('Flotte', payload.fleet)
  pushObject('Alertes', payload.alerts)
  pushObject('Missions', payload.missions)
  return entries.slice(0, 12)
}

function buildOperationalQuery(fromDate, toDate) {
  const params = new URLSearchParams()
  if (fromDate) params.set('from', fromDate)
  if (toDate) params.set('to', toDate)
  if (!fromDate && !toDate) params.set('period', '7d')
  return params.toString()
}

const HIDDEN_FLEET_KEYS = new Set([
  'tracker_id', 'trackerId',
  'tracker_label', 'trackerLabel',
  'driver_name', 'driverName',
  'model', 'model_name', 'modelName',
  'phone', 'phoneNumber', 'phone_number',
  'status', 'state', 'connection_status',
  'events', 'alerts',
])

function buildGenericColumns(rows = [], opts = {}) {
  const { reportType } = opts
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))))
    .filter((key) => reportType === 'ops-fleet' ? !HIDDEN_FLEET_KEYS.has(key) : true)
    .slice(0, 10)
  return keys.map((key) => ({ key, label: titleFromKey(key), render: (value) => formatCellValue(value) }))
}

function Table({ title, subtitle, columns, rows, footerRows = [] }) {
  return (
    <section className="panel panel-large">
      <div className="panel-header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.reference || row.voucherNumber || 'row'}-${i}`}>
                {columns.map((c) => <td key={c.key}>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '-')}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucune donnée sur la période.</td></tr>}
            {footerRows.map((line, idx) => (
              <tr key={`footer-${idx}`} className="report-footer-row">
                {line.map((cell, cIdx) => <td key={`f-${idx}-${cIdx}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ReportsPage() {
  const [type, setType] = useState('fuel')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deliveries, setDeliveries] = useState([])
  const [fuel, setFuel] = useState([])
  const [masterData, setMasterData] = useState({ clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {} })
  const [includePurchaseOrder, setIncludePurchaseOrder] = useState(false)
  const [goodsFilter, setGoodsFilter] = useState('')
  const [operationalPayload, setOperationalPayload] = useState(null)
  const [operationalLoading, setOperationalLoading] = useState(false)
  const [operationalError, setOperationalError] = useState('')
  const [fleetVehicles, setFleetVehicles] = useState([])
  const [employees, setEmployees] = useState([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const [d, f, m] = await Promise.all([loadDeliveryOrders(), loadFuelVouchers(), loadMasterData()])
        if (!cancelled) {
          setDeliveries(d?.items || [])
          setFuel(f?.items || [])
          setMasterData(m || { clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {} })
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Erreur chargement rapports')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // Charger les données flotte et employés pour le rapport conformité
  useEffect(() => {
    let cancelled = false
    async function loadFleetData() {
      try {
        const [vehiclesData, employeesData] = await Promise.all([
          loadVehicles(),
          loadEmployeesDetail(),
        ])
        if (!cancelled) {
          setFleetVehicles(vehiclesData?.vehicles || vehiclesData?.items || [])
          setEmployees(employeesData?.employees || employeesData?.items || [])
        }
      } catch {
        // silent
      }
    }
    loadFleetData()
    return () => { cancelled = true }
  }, [])

  const rowsInRange = useMemo(() => sortByReference(deliveries.filter((r) => {
    const rowDate = r.date || r.departureDateTime || r.arrivalDateTime
    if (!inRange(rowDate, from, to)) return false
    if (goodsFilter && String(r.goods || '').trim() !== goodsFilter) return false
    return true
  }), (row) => row.reference), [deliveries, from, to, goodsFilter])

  const clientGroups = useMemo(() => {
    const groups = new Map()
    rowsInRange.forEach((row) => {
      const clientName = normalizeClientName(row.client || 'Client non renseigné') || 'Client non renseigné'
      const clientKey = getClientKey(clientName)
      if (!groups.has(clientKey)) groups.set(clientKey, { clientKey, clientName, rows: [] })
      groups.get(clientKey).rows.push(row)
    })
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        rows: sortByReference(group.rows, (row) => row.reference),
        goodsGroups: groupRowsByGoods(group.rows),
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName, 'fr', { sensitivity: 'base' }))
  }, [rowsInRange])

  const dynamicReportTypes = useMemo(() => clientGroups.map((group) => ({
    value: `client:${group.clientKey}`,
    label: `HIGH LEVEL ${group.clientName.toUpperCase()}`,
  })), [clientGroups])

  const reportTypes = useMemo(() => [...dynamicReportTypes, ...STATIC_REPORT_TYPES, ...OPERATIONAL_REPORT_TYPES], [dynamicReportTypes])

  useEffect(() => {
    if (!reportTypes.length) return
    if (!reportTypes.some((item) => item.value === type)) {
      setType(reportTypes[0].value)
    }
  }, [reportTypes, type])

  const selectedOperationalReport = OPERATIONAL_REPORTS_BY_VALUE[type] || null

  useEffect(() => {
    if (!selectedOperationalReport) {
      setOperationalPayload(null)
      setOperationalError('')
      setOperationalLoading(false)
      return undefined
    }
    let cancelled = false
    async function run() {
      setOperationalLoading(true)
      setOperationalError('')
      try {
        const payload = await selectedOperationalReport.loader(buildOperationalQuery(from, to))
        if (!cancelled) setOperationalPayload(payload || {})
      } catch (e) {
        if (!cancelled) {
          setOperationalPayload(null)
          setOperationalError(e.message || 'Erreur chargement rapport')
        }
      } finally {
        if (!cancelled) setOperationalLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedOperationalReport, from, to])

  const operationalRows = useMemo(() => extractRows(operationalPayload || {}), [operationalPayload])
  const operationalSummary = useMemo(() => extractSummaries(operationalPayload || {}), [operationalPayload])
  const operationalColumns = useMemo(() => buildGenericColumns(operationalRows, { reportType: type }), [operationalRows, type])

  const selectedClientGroup = useMemo(() => (
    type.startsWith('client:') ? clientGroups.find((group) => `client:${group.clientKey}` === type) || null : null
  ), [type, clientGroups])

  const k1Rows = useMemo(() => {
    const target = clientGroups.find((group) => group.clientKey.includes('K1'))
    return target?.rows || []
  }, [clientGroups])

  const caderacRows = useMemo(() => {
    const target = clientGroups.find((group) => group.clientKey.includes('CADERAC'))
    return target?.rows || []
  }, [clientGroups])

  const lafargeRows = useMemo(() => {
    const target = clientGroups.find((group) => group.clientKey.includes('LAFARGE'))
    return target?.rows || []
  }, [clientGroups])

  const caderacByDestination = useMemo(() => {
    const map = new Map()
    caderacRows.forEach((r) => {
      const key = r.destination || 'Non renseignée'
      map.set(key, (map.get(key) || 0) + toQtyNumber(r.quantity))
    })
    return Array.from(map.entries()).map(([destination, quantity]) => ({ destination, quantity }))
  }, [caderacRows])

  const caderacGeneralTotal = useMemo(() => caderacRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0), [caderacRows])

  const lafargeByDestination = useMemo(() => {
    const map = new Map()
    lafargeRows.forEach((r) => {
      const key = r.destination || 'Non renseignée'
      map.set(key, (map.get(key) || 0) + toQtyNumber(r.quantity))
    })
    return Array.from(map.entries()).map(([destination, quantity]) => ({ destination, quantity }))
  }, [lafargeRows])

  const lafargeGeneralTotal = useMemo(() => lafargeRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0), [lafargeRows])

  // Données du rapport Flotte & Conformité
  const fleetComplianceRows = useMemo(() => {
    const employeeMap = {}
    employees.forEach((emp) => {
      const tid = String(emp.tracker_id || emp.trackerId || '')
      if (tid) employeeMap[tid] = emp
    })
    return fleetVehicles.map((v) => {
      const vid = String(v.id || v.tracker_id)
      const emp = employeeMap[vid] || {}
      const insuranceDate = v.insurance_rc_date || v.insurance_date
      const insuranceExpiry = v.insurance_rc_expiry || v.insurance_expiry
      const libreInsurance = v.insurance_libre || v.assurance_libre
      const driverLicense = emp.driver_license_validity || emp.permis_validite || emp.license_validity
      // Statut assurance
      let insuranceStatus = 'ok'
      if (insuranceExpiry) {
        const expiry = ymdToDate(insuranceExpiry)
        if (expiry) {
          const now = new Date()
          const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24))
          if (daysUntilExpiry < 0) insuranceStatus = 'expired'
          else if (daysUntilExpiry <= 30) insuranceStatus = 'expiring'
        }
      }
      return {
        vid,
        label: v.label || v.name || `Véhicule ${vid}`,
        model: v.model || v.model_name || '-',
        garage: v.garage || v.garage_name || '-',
        insuranceDate: insuranceDate || '-',
        insuranceExpiry: insuranceExpiry || '-',
        insuranceStatus,
        libreInsurance: libreInsurance || '-',
        driverLicense: driverLicense || '-',
      }
    })
  }, [fleetVehicles, employees])

  const fleetComplianceKPIs = useMemo(() => {
    const total = fleetComplianceRows.length
    const withInsurance = fleetComplianceRows.filter((r) => r.insuranceStatus === 'ok').length
    const expiredOrExpiring = fleetComplianceRows.filter((r) => r.insuranceStatus === 'expired' || r.insuranceStatus === 'expiring').length
    const withLicense = fleetComplianceRows.filter((r) => r.driverLicense !== '-').length
    return { total, withInsurance, expiredOrExpiring, withLicense }
  }, [fleetComplianceRows])

  const fuelRows = useMemo(() => sortByReference(fuel.filter((r) => inRange(r.dateTime, from, to)), (row) => row.voucherNumber || row.reference), [fuel, from, to])
  const fuelTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.amount), 0), [fuelRows])
  const fuelQtyTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.quantityLiters), 0), [fuelRows])

  const currentClientPurchaseOrder = selectedClientGroup ? (masterData.purchaseOrders?.[selectedClientGroup.clientName] || masterData.purchaseOrders?.[selectedClientGroup.clientKey] || '') : ''

  const getCurrentReportForExport = () => {
    if (selectedOperationalReport) {
      const title = selectedOperationalReport.label
      return {
        title,
        clientName: '',
        sections: [{
          title: 'Détail',
          headers: operationalColumns.map((column) => column.label),
          rows: operationalRows.map((row) => operationalColumns.map((column) => formatCellValue(row[column.key]))),
          footerRows: [],
        }],
      }
    }

    if (selectedClientGroup) {
      return {
        title: `HIGH LEVEL ${selectedClientGroup.clientName.toUpperCase()}`,
        clientName: selectedClientGroup.clientName,
        sections: selectedClientGroup.goodsGroups.map((group) => ({
          title: group.goods,
          headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'DESTINATION'],
          rows: group.items.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.date), r.truckLabel, r.destination || '-']),
          footerRows: [[
            `TOTAL ${group.goods}`,
            '',
            formatQtyPlain(group.items.reduce((a, r) => a + toQtyNumber(r.quantity), 0)),
            '',
            '',
            '',
          ]],
        })),
      }
    }

    if (type === 'reco-k1') {
      return {
        title: 'ETAT DE RECONCILIATION K1',
        clientName: 'K1 MINE',
        sections: [{
          title: 'Détail',
          headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'NOM DU CHAUFFEUR'],
          rows: k1Rows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.date), r.truckLabel, r.driver]),
          footerRows: [[
            'TOTAL K1',
            '',
            formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)),
            '',
            '',
            '',
          ]],
        }],
      }
    }

    if (type === 'reco-caderac') {
      return {
        title: 'ETAT DE RECONCILIATION CADERAC ABIDJAN',
        clientName: 'CADERAC ABIDJAN',
        sections: [
          {
            title: 'Détail',
            headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'NOM DU CHAUFFEUR', 'DESTINATION'],
            rows: caderacRows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.date), r.truckLabel, r.driver, r.destination || '-']),
            footerRows: [],
          },
          {
            title: 'Totaux par destination',
            headers: ['DESTINATION', 'TOTAL QUANTITE'],
            rows: caderacByDestination.map((row) => [row.destination, formatQty(row.quantity)]),
            footerRows: [['TOTAL GENERAL', formatQtyPlain(caderacGeneralTotal)]],
          },
        ],
      }
    }

    if (type === 'reco-lafarge') {
      return {
        title: 'ETAT DE RECONCILIATION LAFARGE',
        clientName: 'LAFARGE',
        sections: [
          {
            title: 'Détail',
            headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'NOM DU CHAUFFEUR', 'DESTINATION'],
            rows: lafargeRows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.date), r.truckLabel, r.driver, r.destination || '-']),
            footerRows: [],
          },
          {
            title: 'Totaux par destination',
            headers: ['DESTINATION', 'TOTAL QUANTITE'],
            rows: lafargeByDestination.map((row) => [row.destination, formatQty(row.quantity)]),
            footerRows: [['TOTAL GENERAL', formatQtyPlain(lafargeGeneralTotal)]],
          },
        ],
      }
    }

    return {
      title: 'SUIVI BON DE CARBURANT',
      clientName: '',
      sections: [{
        title: 'Détail',
        headers: ['FOURNISSEUR', 'NUMERO BL/BON', 'IMMATRICULATION', 'DATE ET HEURE DE PRISE', 'QTE', 'PRIX UNITAIRE', 'MONTANT'],
        rows: fuelRows.map((r) => [r.supplier || '-', r.voucherNumber || '-', r.truckLabel || '-', formatDateTime(r.dateTime), formatQty(r.quantityLiters), formatMoney(r.unitPrice), formatMoney(r.amount)]),
        footerRows: [
          ['QUANTITE TOTALE', '', '', '', formatQtyPlain(fuelQtyTotal), '', ''],
          ['MONTANT TOTAL', '', '', '', '', '', formatMoney(fuelTotal)],
        ],
      }],
    }
  }

  const exportCurrentPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTableModule = await import('jspdf-autotable')
    const autoTable = autoTableModule.default
    const brandGreen = [22, 101, 52]
    const brandBrown = [120, 72, 32]
    const softBrown = [244, 236, 226]
    const report = getCurrentReportForExport()
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })
    const purchaseOrderNumber = includePurchaseOrder ? (currentClientPurchaseOrder || masterData.purchaseOrders?.[report.clientName || ''] || '') : ''
    await buildPdfHeader(doc, report.title, from, to, purchaseOrderNumber)
    let cursorY = 56
    for (let index = 0; index < report.sections.length; index += 1) {
      const section = report.sections[index]
      if (index > 0) {
        cursorY = doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 14 : cursorY + 14
      }
      if (cursorY > 172) {
        doc.addPage('a4', 'landscape')
        await buildPdfHeader(doc, report.title, from, to, purchaseOrderNumber)
        cursorY = 56
      }
      const showSectionTitle = section.title && section.title.toLowerCase() !== 'détail'
      if (showSectionTitle) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        doc.setTextColor(...brandBrown)
        doc.text(section.title, 14, cursorY)
        doc.setDrawColor(...brandBrown)
        doc.setLineWidth(0.5)
        doc.line(14, cursorY + 2, 120, cursorY + 2)
      }
      const bodyRows = [...section.rows]
      const footerCount = Array.isArray(section.footerRows) ? section.footerRows.length : 0
      if (footerCount) {
        bodyRows.push([])
        bodyRows.push(...section.footerRows)
      }
      autoTable(doc, {
        startY: cursorY + (showSectionTitle ? 4 : 0),
        head: [section.headers],
        body: bodyRows,
        margin: { left: 14, right: 14 },
        tableWidth: 269,
        styles: { fontSize: 10.5, cellPadding: 3, halign: 'center', valign: 'middle' },
        headStyles: { fillColor: brandGreen, textColor: [255, 255, 255], fontSize: 11, halign: 'center', valign: 'middle' },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        bodyStyles: { textColor: [30, 41, 59], halign: 'center', valign: 'middle' },
        columnStyles: type === 'fuel'
          ? {
              0: { cellWidth: 48 },
              1: { cellWidth: 30 },
              2: { cellWidth: 40 },
              3: { cellWidth: 62 },
              4: { cellWidth: 20 },
              5: { cellWidth: 32, halign: 'center' },
              6: { cellWidth: 37, halign: 'center' },
            }
          : undefined,
        didParseCell: (data) => {
          if (data.section !== 'body' || !footerCount) return
          const footerStart = bodyRows.length - footerCount
          if (data.row.index >= footerStart) {
            data.cell.styles.fillColor = softBrown
            data.cell.styles.textColor = brandBrown
            data.cell.styles.fontStyle = 'bold'
          }
          if (type === 'fuel' && data.column.index >= 5) {
            data.cell.styles.fontSize = 9.5
          }
        }
      })
      cursorY = doc.lastAutoTable?.finalY || cursorY
      if (cursorY > 180 && index < report.sections.length - 1) {
        doc.addPage('a4', 'landscape')
        await buildPdfHeader(doc, report.title, from, to, purchaseOrderNumber)
        cursorY = 56
      }
    }
    const grandTotal = type === 'fuel'
      ? fuelTotal
      : report.sections.reduce((sum, section) => sum + section.rows.reduce((sectionSum, row) => sectionSum + toQtyNumber(row[2]), 0), 0)
    let summaryY = (doc.lastAutoTable?.finalY || cursorY) + 10
    if (summaryY > 186) {
      doc.addPage('a4', 'landscape')
      await buildPdfHeader(doc, report.title, from, to, purchaseOrderNumber)
      summaryY = 64
    }
    doc.setFillColor(...softBrown)
    doc.roundedRect(170, summaryY, 112, 16, 3, 3, 'F')
    doc.setTextColor(...brandBrown)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`Total général: ${type === 'fuel' ? formatMoney(grandTotal) : formatQtyPlain(grandTotal)}`, 278, summaryY + 10, { align: 'right' })
    drawPdfFooter(doc)
    doc.save(`${report.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'rapport'}.pdf`)
  }

  const exportCurrent = () => {
    const report = getCurrentReportForExport()
    const rows = report.sections.flatMap((section) => ([
      [section.title],
      section.headers,
      ...section.rows,
      ...(section.footerRows || []),
      [],
    ]))
    downloadCsv(`${report.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'rapport'}.csv`, rows, from, to)
  }

  return (
    <PageStack className="reports-excel">
      <section className="panel panel-large reports-v2-hero reports-excel">
        <SectionHeader
          title="RAPPORTS TLM"
          right={<div className="table-actions"><button type="button" className="ghost-btn" onClick={exportCurrentPdf}>Exporter PDF</button><button type="button" className="primary-btn" onClick={exportCurrent}>Télécharger CSV</button></div>}
        />
        <div className="filters filter-row">{reportTypes.map((item) => <button type="button" key={item.value} className={`chip ${type === item.value ? 'selected' : ''}`} onClick={() => setType(item.value)}>{item.label}</button>)}</div>
        <div className="reports-filter-grid reports-filter-grid-spaced">
          <label className="field-stack">
            <span>Du</span>
            <StableDatePicker value={ymdToDate(from)} onChange={(value) => setFrom(dateToYmd(value))} placeholder="Date début" clearable className="filter-control modern-date-input" />
          </label>
          <label className="field-stack">
            <span>Au</span>
            <StableDatePicker value={ymdToDate(to)} onChange={(value) => setTo(dateToYmd(value))} placeholder="Date fin" clearable className="filter-control modern-date-input" />
          </label>
          <label className="field-stack">
            <span>Type de produit</span>
            <select value={goodsFilter} onChange={(e) => setGoodsFilter(e.target.value)}>
              <option value="">Tous les produits</option>
              {(masterData.goods || []).map((goods) => <option key={goods} value={goods}>{goods}</option>)}
            </select>
          </label>
          <div className="field-stack reports-options-stack">
            <span>Options PDF</span>
            <div className="reports-options-box">
              <div className="reports-options-copy">
                <strong>Inclure le bon de commande</strong>
                <span>Ajoute le numéro dans l’en-tête du PDF exporté</span>
              </div>
              <label className="ui-toggle-wrap">
                <input className="ui-toggle-input" type="checkbox" checked={includePurchaseOrder} onChange={(e) => setIncludePurchaseOrder(e.target.checked)} />
                <span className={`ui-toggle-track ${includePurchaseOrder ? 'is-checked' : ''}`}>
                  <span className={`ui-toggle-knob ${includePurchaseOrder ? 'is-checked' : ''}`} />
                </span>
              </label>
            </div>
          </div>
        </div>
        {loading && <SkeletonTable rows={4} cols={7} />}
        {operationalLoading && <SkeletonTable rows={4} cols={6} />}
        <ErrorBanner message={error || operationalError} />
      </section>

      {selectedOperationalReport && (
        <>
          {operationalSummary.length > 0 && (
            <section className="panel panel-large">
              <div className="panel-header"><div><h3>{selectedOperationalReport.label} – Indicateurs</h3><p>Données sur les 7 derniers jours</p></div></div>
              <div className="kpi-grid">
                {operationalSummary.map((item) => (
                  <div className="mini-kpi" key={`${item.label}-${item.value}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          <Table
            title={selectedOperationalReport.label}
            subtitle={`${operationalRows.length} ligne(s) • période opérationnelle 7 jours`}
            rows={operationalRows}
            columns={operationalColumns.length ? operationalColumns : [{ key: 'empty', label: 'Donnée' }]}
          />
        </>
      )}

      {selectedClientGroup && (
        <>
          {selectedClientGroup.goodsGroups.map((group) => (
            <Table
              key={group.goods}
              title={`HIGH LEVEL ${selectedClientGroup.clientName.toUpperCase()} – ${group.goods}`}
              subtitle={`${group.items.length} ligne(s) • ${formatPeriodLabel(from, to)}`}
              rows={group.items}
              footerRows={[[`TOTAL`, '', formatQtyPlain(group.items.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '', '']]}
              columns={[
                { key: 'reference', label: 'NUMERO BL' },
                { key: 'goods', label: 'TYPE DE PRODUIT' },
                { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
                { key: 'date', label: 'DATE ET HEURE DE DECHARGEMENT', render: (v) => formatDateTime(v) },
                { key: 'truckLabel', label: 'IMMATRICULATION' },
                { key: 'destination', label: 'DESTINATION' },
              ]}
            />
          ))}
          {selectedClientGroup.goodsGroups.length === 0 && <Table title={`HIGH LEVEL ${selectedClientGroup.clientName.toUpperCase()}`} subtitle={`0 ligne • ${formatPeriodLabel(from, to)}`} rows={[]} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'date', label: 'DATE ET HEURE DE DECHARGEMENT', render: (v) => formatDateTime(v) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'destination', label: 'DESTINATION' },
          ]} />}
          <section className="panel panel-large"><div className="panel-header"><div><h3>Quantité totale</h3></div></div><div className="mini-kpi"><strong>{formatQty(selectedClientGroup.rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0))}</strong></div></section>
        </>
      )}

      {type === 'reco-k1' && (
        <Table title="ETAT DE RECONCILIATION K1" subtitle={`${k1Rows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={k1Rows} footerRows={[[`TOTAL`, '', formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '', '']]} columns={[
          { key: 'reference', label: 'NUMERO BL' },
          { key: 'goods', label: 'TYPE DE PRODUIT' },
          { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
          { key: 'date', label: 'DATE ET HEURE DE DECHARGEMENT', render: (v) => formatDateTime(v) },
          { key: 'truckLabel', label: 'IMMATRICULATION' },
          { key: 'driver', label: 'NOM DU CHAUFFEUR' },
        ]} />
      )}

      {type === 'reco-caderac' && (
        <>
          <Table title="ETAT DE RECONCILIATION CADERAC ABIDJAN" subtitle={`${caderacRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={caderacRows} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'date', label: 'DATE ET HEURE DE DECHARGEMENT', render: (v) => formatDateTime(v) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'driver', label: 'NOM DU CHAUFFEUR' },
            { key: 'destination', label: 'DESTINATION' },
          ]} />
          <Table title="CADERAC ABIDJAN – Totaux par destination" subtitle={`${caderacByDestination.length} destination(s)`} rows={caderacByDestination} footerRows={[[`TOTAL GENERAL`, formatQtyPlain(caderacGeneralTotal)]]} columns={[
            { key: 'destination', label: 'DESTINATION' },
            { key: 'quantity', label: 'TOTAL QUANTITE', render: (v) => formatQty(v) },
          ]} />
        </>
      )}

      {type === 'reco-lafarge' && (
        <>
          <Table title="ETAT DE RECONCILIATION LAFARGE" subtitle={`${lafargeRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={lafargeRows} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'date', label: 'DATE ET HEURE DE DECHARGEMENT', render: (v) => formatDateTime(v) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'driver', label: 'NOM DU CHAUFFEUR' },
            { key: 'destination', label: 'DESTINATION' },
          ]} />
          <Table title="LAFARGE – Totaux par destination" subtitle={`${lafargeByDestination.length} destination(s)`} rows={lafargeByDestination} footerRows={[[`TOTAL GENERAL`, formatQtyPlain(lafargeGeneralTotal)]]} columns={[
            { key: 'destination', label: 'DESTINATION' },
            { key: 'quantity', label: 'TOTAL QUANTITE', render: (v) => formatQty(v) },
          ]} />
        </>
      )}

      {type === 'fuel' && (
          <Table title="SUIVI BON DE CARBURANT (par fournisseur)" subtitle={`${fuelRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={fuelRows} footerRows={[[`QUANTITE TOTALE`, '', '', '', formatQtyPlain(fuelQtyTotal), '', ''], [`MONTANT TOTAL`, '', '', '', '', '', formatMoney(fuelTotal)]]} columns={[
            { key: 'supplier', label: 'FOURNISSEUR' },
            { key: 'voucherNumber', label: 'NUMERO BL/BON' },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'dateTime', label: 'DATE ET HEURE DE PRISE', render: (v) => formatDateTime(v) },
            { key: 'quantityLiters', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'unitPrice', label: 'PRIX UNITAIRE', render: (v) => formatMoney(v) },
            { key: 'amount', label: 'MONTANT', render: (v) => formatMoney(v) },
          ]} />
        )}

      {type === 'fleet-compliance' && (
        <>
          {/* KPIs Flotte & Conformité */}
          <section className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={18} style={{ color: '#f59e0b' }} />
                  FLOTTE & CONFORMITÉ – Indicateurs
                </h3>
                <p>État du parc et conformité des documents</p>
              </div>
            </div>
            <div className="kpi-grid">
              <div className="mini-kpi">
                <span><Truck size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Véhicules</span>
                <strong>{fleetComplianceKPIs.total}</strong>
              </div>
              <div className="mini-kpi">
                <span><CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#22c55e' }} />Assurance OK</span>
                <strong style={{ color: '#22c55e' }}>{fleetComplianceKPIs.withInsurance}</strong>
              </div>
              <div className="mini-kpi">
                <span><AlertTriangle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#ef4444' }} />Assurance expirée/expirant</span>
                <strong style={{ color: fleetComplianceKPIs.expiredOrExpiring > 0 ? '#ef4444' : undefined }}>{fleetComplianceKPIs.expiredOrExpiring}</strong>
              </div>
              <div className="mini-kpi">
                <span><CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#3b82f6' }} />Permis chauffeurs</span>
                <strong>{fleetComplianceKPIs.withLicense}</strong>
              </div>
            </div>
          </section>

          {/* Tableau Flotte & Conformité */}
          <section className="panel panel-large">
            <div className="panel-header">
              <div>
                <h3>Détail par véhicule</h3>
                <p>{fleetComplianceRows.length} véhicule(s)</p>
              </div>
            </div>
            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Camion</th>
                    <th>Modèle</th>
                    <th>Garage</th>
                    <th>Assurance RC</th>
                    <th>Statut RC</th>
                    <th>Assurance libre</th>
                    <th>Permis chauffeur</th>
                  </tr>
                </thead>
                <tbody>
                  {fleetComplianceRows.map((row) => {
                    const statusColor = row.insuranceStatus === 'expired' ? '#ef4444'
                      : row.insuranceStatus === 'expiring' ? '#f59e0b'
                      : '#22c55e'
                    const statusLabel = row.insuranceStatus === 'expired' ? 'Expirée'
                      : row.insuranceStatus === 'expiring' ? 'Expire bientôt'
                      : 'OK'
                    const StatusIcon = row.insuranceStatus === 'expired' ? AlertTriangle
                      : row.insuranceStatus === 'expiring' ? AlertTriangle
                      : CheckCircle
                    const formatDate = (val) => {
                      if (!val || val === '-') return '-'
                      const d = ymdToDate(val)
                      return d ? d.toLocaleDateString('fr-FR') : val
                    }
                    return (
                      <tr key={row.vid}>
                        <td><strong>{row.label}</strong></td>
                        <td>{row.model}</td>
                        <td>{row.garage}</td>
                        <td>{formatDate(row.insuranceExpiry)}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: statusColor }}>
                            <StatusIcon size={14} />
                            {statusLabel}
                          </span>
                        </td>
                        <td>{row.libreInsurance}</td>
                        <td>{formatDate(row.driverLicense)}</td>
                      </tr>
                    )
                  })}
                  {fleetComplianceRows.length === 0 && (
                    <tr><td colSpan={7} className="table-empty-cell">Chargement des données flotte…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </PageStack>
  )
}
