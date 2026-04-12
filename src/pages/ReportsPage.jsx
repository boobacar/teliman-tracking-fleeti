import { useEffect, useMemo, useState } from 'react'
import DatePicker from 'react-datepicker'
import { fr } from 'date-fns/locale'
import { loadDeliveryOrders, loadFuelVouchers } from '../lib/fleeti'
import 'react-datepicker/dist/react-datepicker.css'

const REPORT_TYPES = [
  { value: 'k1', label: 'HIGH LEVEL K1' },
  { value: 'caderac', label: 'HIGH LEVEL CADERAC' },
  { value: 'reco-k1', label: 'ETAT RECONCILIATION K1' },
  { value: 'fuel', label: 'SUIVI BON DE CARBURANT' },
]

function toDate(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateTime(value) {
  const d = toDate(value)
  return d ? d.toLocaleString('fr-FR') : '-'
}

function toQtyNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  const normalized = typeof value === 'string' ? value.replace(',', '.').replace(/\s+/g, '') : value
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
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

function formatPeriodDate(value, endOfDay = false) {
  if (!value) return '...'
  const base = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  if (Number.isNaN(base.getTime())) return '...'
  return base.toLocaleString('fr-FR')
}

function formatPeriodLabel(from, to) {
  return `du ${formatPeriodDate(from)} au ${formatPeriodDate(to, true)}`
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

function isK1Client(client = '') {
  return String(client).toUpperCase().includes('K1')
}

function isCaderacClient(client = '') {
  return String(client).toUpperCase().includes('CADERAC')
}

function isBatch05(goods = '') {
  const g = String(goods).toLowerCase()
  return g.includes('0/5') || g.includes('0x5')
}

function isBatch1014(goods = '') {
  const g = String(goods).toLowerCase()
  return g.includes('10/14') || g.includes('10x14')
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

async function buildPdfHeader(doc, title, from, to) {
  const now = new Date().toLocaleString('fr-FR')
  try {
    const logo = await loadLogoDataUrl()
    doc.addImage(logo, 'JPEG', 14, 8, 44, 14)
  } catch {}
  doc.setFontSize(14)
  doc.text('TELIMAN TRACKING FLEETI', 62, 14)
  doc.setFontSize(11)
  doc.text(title, 62, 22)
  doc.text(`Période: ${formatPeriodLabel(from, to)}`, 62, 28)
  doc.text(`Date export: ${now}`, 62, 34)
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
  const [type, setType] = useState('k1')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deliveries, setDeliveries] = useState([])
  const [fuel, setFuel] = useState([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const [d, f] = await Promise.all([loadDeliveryOrders(), loadFuelVouchers()])
        if (!cancelled) {
          setDeliveries(d?.items || [])
          setFuel(f?.items || [])
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

  const rowsInRange = useMemo(() => deliveries.filter((r) => inRange(r.arrivalDateTime || r.date, from, to)), [deliveries, from, to])
  const k1Rows = useMemo(() => rowsInRange.filter((r) => isK1Client(r.client)), [rowsInRange])
  const caderacRows = useMemo(() => rowsInRange.filter((r) => isCaderacClient(r.client)), [rowsInRange])
  const k1_05 = useMemo(() => k1Rows.filter((r) => isBatch05(r.goods)), [k1Rows])
  const k1_1014 = useMemo(() => k1Rows.filter((r) => isBatch1014(r.goods)), [k1Rows])
  const caderacByDestination = useMemo(() => {
    const map = new Map()
    caderacRows.forEach((r) => {
      const key = r.destination || 'Non renseignée'
      map.set(key, (map.get(key) || 0) + toQtyNumber(r.quantity))
    })
    return Array.from(map.entries()).map(([destination, quantity]) => ({ destination, quantity }))
  }, [caderacRows])
  const fuelRows = useMemo(() => fuel.filter((r) => inRange(r.dateTime, from, to)), [fuel, from, to])
  const fuelTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.amount), 0), [fuelRows])
  const fuelQtyTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.quantityLiters), 0), [fuelRows])

  const getCurrentReportForExport = () => {
    if (type === 'k1') {
      return {
        title: 'HIGH LEVEL K1',
        headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION'],
        rows: [
          ...k1_05.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel]),
          ...k1_1014.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel]),
        ],
        footerRows: [[
          'TOTAL K1',
          '',
          formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)),
          '',
          '',
        ]],
      }
    }
    if (type === 'caderac') {
      return {
        title: 'HIGH LEVEL CADERAC',
        headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'DESTINATION'],
        rows: caderacRows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel, r.destination]),
        footerRows: [[
          'TOTAL CADERAC',
          '',
          formatQtyPlain(caderacRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)),
          '',
          '',
          '',
        ]],
      }
    }
    if (type === 'reco-k1') {
      return {
        title: 'ETAT DE RECONCILIATION K1',
        headers: ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'NOM DU CHAUFFEUR'],
        rows: k1Rows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel, r.driver]),
        footerRows: [[
          'TOTAL K1',
          '',
          formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)),
          '',
          '',
          '',
        ]],
      }
    }
    return {
      title: 'SUIVI BON DE CARBURANT',
      headers: ['FOURNISSEUR', 'NUMERO BL/BON', 'IMMATRICULATION', 'DATE ET HEURE DE PRISE', 'QTE', 'PRIX UNITAIRE', 'MONTANT'],
      rows: fuelRows.map((r) => [r.supplier || '-', r.voucherNumber || '-', r.truckLabel || '-', formatDateTime(r.dateTime), formatQty(r.quantityLiters), formatQty(r.unitPrice, 0), formatQty(r.amount, 0)]),
      footerRows: [
        ['QUANTITE TOTALE', '', '', '', formatQtyPlain(fuelQtyTotal), '', ''],
        ['MONTANT TOTAL', '', '', '', '', '', formatQtyPlain(fuelTotal, 0)],
      ],
    }
  }

  const exportCurrentPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const autoTableModule = await import('jspdf-autotable')
    const autoTable = autoTableModule.default
    const report = getCurrentReportForExport()
    const doc = new jsPDF({ orientation: 'landscape' })
    await buildPdfHeader(doc, report.title, from, to)
    const bodyRows = [...report.rows]
    const footerCount = Array.isArray(report.footerRows) ? report.footerRows.length : 0
    if (footerCount) {
      bodyRows.push([])
      bodyRows.push(...report.footerRows)
    }
    autoTable(doc, {
      startY: 40,
      head: [report.headers],
      body: bodyRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [16, 185, 129] },
      didParseCell: (data) => {
        if (data.section !== 'body' || !footerCount) return
        const footerStart = bodyRows.length - footerCount
        if (data.row.index >= footerStart) {
          data.cell.styles.fillColor = [224, 247, 239]
          data.cell.styles.textColor = [6, 78, 59]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.lineWidth = 0.2
        }
      },
    })
    doc.save(`${report.title.replaceAll(' ', '_')}_${from || 'NA'}_${to || 'NA'}.pdf`)
  }

  const exportCurrent = () => {
    if (type === 'k1') {
      return downloadCsv('HIGH_LEVEL_K1.csv', [
        ['HIGH LEVEL K1 - PRODUIT 0/5'],
        ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION'],
        ...k1_05.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel]),
        ['TOTAL 0/5', '', formatQtyPlain(k1_05.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', ''],
        [],
        ['HIGH LEVEL K1 - PRODUIT 10/14'],
        ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION'],
        ...k1_1014.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel]),
        ['TOTAL 10/14', '', formatQtyPlain(k1_1014.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', ''],
        ['TOTAL K1', '', formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', ''],
      ], from, to)
    }

    if (type === 'caderac') {
      return downloadCsv('HIGH_LEVEL_CADERAC.csv', [
        ['HIGH LEVEL CADERAC - DETAIL'],
        ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'DESTINATION'],
        ...caderacRows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel, r.destination]),
        [],
        ['AGREGAT QUANTITE PAR DESTINATION'],
        ['DESTINATION', 'QTE'],
        ...caderacByDestination.map((r) => [r.destination, formatQty(r.quantity)]),
        [],
        ['QUANTITE TOTALE', formatQtyPlain(caderacRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0))],
      ], from, to)
    }

    if (type === 'reco-k1') {
      return downloadCsv('RECONCILIATION_K1.csv', [
        ['NUMERO BL', 'TYPE DE PRODUIT', 'QTE', 'DATE ET HEURE DE DECHARGEMENT', 'IMMATRICULATION', 'NOM CHAUFFEUR'],
        ...k1Rows.map((r) => [r.reference, r.goods, formatQty(r.quantity), formatDateTime(r.arrivalDateTime || r.date), r.truckLabel, r.driver]),
        [],
        ['TOTAL K1', '', formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '', ''],
      ], from, to)
    }

    return downloadCsv('SUIVI_BON_CARBURANT.csv', [
      ['FOURNISSEUR', 'NUMERO BL/BON', 'IMMATRICULATION', 'DATE ET HEURE DE PRISE', 'QTE', 'PRIX UNITAIRE', 'MONTANT'],
      ...fuelRows.map((r) => [r.supplier || '-', r.voucherNumber || '-', r.truckLabel || '-', formatDateTime(r.dateTime), formatQty(r.quantityLiters), formatQty(r.unitPrice, 0), formatQty(r.amount, 0)]),
      [],
      ['QUANTITE TOTALE', '', '', '', formatQtyPlain(fuelQtyTotal), '', ''],
      ['MONTANT TOTAL', '', '', '', '', '', formatQtyPlain(fuelTotal, 0)],
    ], from, to)
  }

  return (
    <div className="reports-excel" style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>RAPPORTS TLM</h3></div><div className="table-actions"><button className="ghost-btn" onClick={exportCurrentPdf}>Exporter PDF</button><button className="primary-btn" onClick={exportCurrent}>Télécharger CSV</button></div></div>
        <div className="filters filter-row">{REPORT_TYPES.map((item) => <button key={item.value} className={`chip ${type === item.value ? 'selected' : ''}`} onClick={() => setType(item.value)}>{item.label}</button>)}</div>
        <div className="reports-filter-grid" style={{ marginTop: 12 }}>
          <label className="field-stack">
            <span>Du</span>
            <DatePicker
              selected={ymdToDate(from)}
              onChange={(value) => setFrom(dateToYmd(value))}
              dateFormat="dd/MM/yyyy"
              locale={fr}
              placeholderText="Date début"
              isClearable
              className="filter-control modern-date-input"
              popperClassName="modern-date-popper"
            />
          </label>
          <label className="field-stack">
            <span>Au</span>
            <DatePicker
              selected={ymdToDate(to)}
              onChange={(value) => setTo(dateToYmd(value))}
              dateFormat="dd/MM/yyyy"
              locale={fr}
              placeholderText="Date fin"
              isClearable
              className="filter-control modern-date-input"
              popperClassName="modern-date-popper"
            />
          </label>
        </div>
        {loading && <div className="info-banner">Chargement des données…</div>}
        {error && <div className="error-banner">{error}</div>}
      </section>

      {type === 'k1' && (
        <>
          <Table title="HIGH LEVEL K1 – Tableau produit 0/5" subtitle={`${k1_05.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={k1_05} footerRows={[[`TOTAL`, '', formatQtyPlain(k1_05.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '']]} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'arrivalDateTime', label: 'DATE ET HEURE DE DECHARGEMENT', render: (_, row) => formatDateTime(row.arrivalDateTime || row.date) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
          ]} />
          <Table title="HIGH LEVEL K1 – Tableau produit 10/14" subtitle={`${k1_1014.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={k1_1014} footerRows={[[`TOTAL`, '', formatQtyPlain(k1_1014.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '']]} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'arrivalDateTime', label: 'DATE ET HEURE DE DECHARGEMENT', render: (_, row) => formatDateTime(row.arrivalDateTime || row.date) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
          ]} />
        </>
      )}

      {type === 'caderac' && (
        <>
          <Table title="HIGH LEVEL CADERAC – Détail" subtitle={`${caderacRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={caderacRows} footerRows={[[`TOTAL`, '', formatQtyPlain(caderacRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '', '']]} columns={[
            { key: 'reference', label: 'NUMERO BL' },
            { key: 'goods', label: 'TYPE DE PRODUIT' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'arrivalDateTime', label: 'DATE ET HEURE DE DECHARGEMENT', render: (_, row) => formatDateTime(row.arrivalDateTime || row.date) },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'destination', label: 'DESTINATION' },
          ]} />
          <Table title="CADERAC – Agrégat quantité par destination" subtitle={`${caderacByDestination.length} destination(s)`} rows={caderacByDestination} columns={[
            { key: 'destination', label: 'DESTINATION' },
            { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
          ]} />
          <section className="panel panel-large"><div className="panel-header"><div><h3>Quantité totale</h3></div></div><div className="mini-kpi"><strong>{formatQty(caderacRows.reduce((a, r) => a + toQtyNumber(r.quantity), 0))}</strong></div></section>
        </>
      )}

      {type === 'reco-k1' && (
        <Table title="ETAT DE RECONCILIATION K1" subtitle={`${k1Rows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={k1Rows} footerRows={[[`TOTAL`, '', formatQtyPlain(k1Rows.reduce((a, r) => a + toQtyNumber(r.quantity), 0)), '', '', '']]} columns={[
          { key: 'reference', label: 'NUMERO BL' },
          { key: 'goods', label: 'TYPE DE PRODUIT' },
          { key: 'quantity', label: 'QTE', render: (v) => formatQty(v) },
          { key: 'arrivalDateTime', label: 'DATE ET HEURE DE DECHARGEMENT', render: (_, row) => formatDateTime(row.arrivalDateTime || row.date) },
          { key: 'truckLabel', label: 'IMMATRICULATION' },
          { key: 'driver', label: 'NOM DU CHAUFFEUR' },
        ]} />
      )}

      {type === 'fuel' && (
        <>
          <Table title="SUIVI BON DE CARBURANT (par fournisseur)" subtitle={`${fuelRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={fuelRows} footerRows={[[`QUANTITE TOTALE`, '', '', '', formatQtyPlain(fuelQtyTotal), '', ''], [`MONTANT TOTAL`, '', '', '', '', '', formatQtyPlain(fuelTotal, 0)]]} columns={[
            { key: 'supplier', label: 'FOURNISSEUR' },
            { key: 'voucherNumber', label: 'NUMERO BL/BON' },
            { key: 'truckLabel', label: 'IMMATRICULATION' },
            { key: 'dateTime', label: 'DATE ET HEURE DE PRISE', render: (v) => formatDateTime(v) },
            { key: 'quantityLiters', label: 'QTE', render: (v) => formatQty(v) },
            { key: 'unitPrice', label: 'PRIX UNITAIRE', render: (v) => formatQty(v, 0) },
            { key: 'amount', label: 'MONTANT', render: (v) => formatQty(v, 0) },
          ]} />
        </>
      )}
    </div>
  )
}
