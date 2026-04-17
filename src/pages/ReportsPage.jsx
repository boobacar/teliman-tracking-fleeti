import { useEffect, useMemo, useState } from 'react'
import { StableDatePicker } from '../components/StableDatePicker'
import { loadDeliveryOrders, loadFuelVouchers, loadMasterData } from '../lib/fleeti'

const STATIC_REPORT_TYPES = [
  { value: 'reco-k1', label: 'ETAT RECONCILIATION K1' },
  { value: 'reco-caderac', label: 'ETAT RECONCILIATION CADERAC ABIDJAN' },
  { value: 'reco-lafarge', label: 'ETAT RECONCILIATION LAFARGE' },
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

function formatMoney(value) {
  const n = toQtyNumber(value)
  return n.toFixed(0).replace('.', ',')
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

  const rowsInRange = useMemo(() => sortByReference(deliveries.filter((r) => {
    if (!inRange(r.date, from, to)) return false
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

  const reportTypes = useMemo(() => [...dynamicReportTypes, ...STATIC_REPORT_TYPES], [dynamicReportTypes])

  useEffect(() => {
    if (!reportTypes.length) return
    if (!reportTypes.some((item) => item.value === type)) {
      setType(reportTypes[0].value)
    }
  }, [reportTypes, type])

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

  const fuelRows = useMemo(() => sortByReference(fuel.filter((r) => inRange(r.dateTime, from, to)), (row) => row.voucherNumber || row.reference), [fuel, from, to])
  const fuelTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.amount), 0), [fuelRows])
  const fuelQtyTotal = useMemo(() => fuelRows.reduce((a, r) => a + toQtyNumber(r.quantityLiters), 0), [fuelRows])

  const currentClientPurchaseOrder = selectedClientGroup ? (masterData.purchaseOrders?.[selectedClientGroup.clientName] || masterData.purchaseOrders?.[selectedClientGroup.clientKey] || '') : ''

  const getCurrentReportForExport = () => {
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
        styles: { fontSize: 10.5, cellPadding: 3, halign: 'center', valign: 'middle' },
        headStyles: { fillColor: brandGreen, textColor: [255, 255, 255], fontSize: 11, halign: 'center', valign: 'middle' },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        bodyStyles: { textColor: [30, 41, 59], halign: 'center', valign: 'middle' },
        columnStyles: type === 'fuel'
          ? {
              0: { cellWidth: 34 },
              1: { cellWidth: 28 },
              2: { cellWidth: 34 },
              3: { cellWidth: 42 },
              4: { cellWidth: 18 },
              5: { cellWidth: 22, halign: 'center' },
              6: { cellWidth: 24, halign: 'center' },
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
    <div className="reports-excel" style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>RAPPORTS TLM</h3></div><div className="table-actions"><button className="ghost-btn" onClick={exportCurrentPdf}>Exporter PDF</button><button className="primary-btn" onClick={exportCurrent}>Télécharger CSV</button></div></div>
        <div className="filters filter-row">{reportTypes.map((item) => <button key={item.value} className={`chip ${type === item.value ? 'selected' : ''}`} onClick={() => setType(item.value)}>{item.label}</button>)}</div>
        <div className="reports-filter-grid" style={{ marginTop: 12 }}>
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
          <div className="field-stack" style={{ alignSelf: 'end' }}>
            <span>Options PDF</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '10px 16px', border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: 16, background: 'linear-gradient(180deg, rgba(15,23,42,0.42), rgba(15,23,42,0.28))', width: 'fit-content', boxShadow: '0 8px 18px rgba(15,23,42,0.12)' }}>
              <div style={{ display: 'grid', gap: 2 }}>
                <strong style={{ fontSize: 14, color: '#f8fafc' }}>Inclure le bon de commande</strong>
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>Ajoute le numéro dans l’en-tête du PDF exporté</span>
              </div>
              <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={includePurchaseOrder} onChange={(e) => setIncludePurchaseOrder(e.target.checked)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                <span style={{ width: 44, height: 24, borderRadius: 999, background: includePurchaseOrder ? '#2563eb' : '#475569', display: 'inline-flex', alignItems: 'center', padding: 3, transition: 'all 0.2s ease' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: '#fff', transform: includePurchaseOrder ? 'translateX(20px)' : 'translateX(0)', transition: 'all 0.2s ease', boxShadow: '0 2px 6px rgba(15,23,42,0.25)' }} />
                </span>
              </label>
            </div>
          </div>
        </div>
        {loading && <div className="info-banner">Chargement des données…</div>}
        {error && <div className="error-banner">{error}</div>}
      </section>

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
        <Table title="SUIVI BON DE CARBURANT (par fournisseur)" subtitle={`${fuelRows.length} ligne(s) • ${formatPeriodLabel(from, to)}`} rows={fuelRows} footerRows={[[`QUANTITE TOTALE`, '', '', '', formatQtyPlain(fuelQtyTotal), '', ''], [`MONTANT TOTAL`, '', '', '', '', '', formatQtyPlain(fuelTotal, 0)]]} columns={[
          { key: 'supplier', label: 'FOURNISSEUR' },
          { key: 'voucherNumber', label: 'NUMERO BL/BON' },
          { key: 'truckLabel', label: 'IMMATRICULATION' },
          { key: 'dateTime', label: 'DATE ET HEURE DE PRISE', render: (v) => formatDateTime(v) },
          { key: 'quantityLiters', label: 'QTE', render: (v) => formatQty(v) },
          { key: 'unitPrice', label: 'PRIX UNITAIRE', render: (v) => formatQty(v, 0) },
          { key: 'amount', label: 'MONTANT', render: (v) => formatQty(v, 0) },
        ]} />
      )}
    </div>
  )
}
