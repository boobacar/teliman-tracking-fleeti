import { useMemo, useState } from 'react'
import { StableDatePicker } from '../components/StableDatePicker'
import { Download, MapPin, Truck } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

function toDate(value) {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = new Date(String(value).replace(' ', 'T'))
  if (!Number.isNaN(normalized.getTime())) return normalized
  return null
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

function dateToYmd(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return value.toISOString().slice(0, 10)
}

function ymdToDate(value) {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value || '').trim().replace(',', '.')
  if (!raw) return 0
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function formatQty(value) {
  const num = parseQuantity(value)
  if (!Number.isFinite(num)) return value || '-'
  return `${num.toLocaleString('fr-FR')} t`
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

export function DriversReportPage({ deliveryOrders = [], filteredTrackers = [] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [selectedDriver, setSelectedDriver] = useState('')

  const rows = useMemo(() => deliveryOrders.filter((item) => inRange(item.date, from, to)), [deliveryOrders, from, to])

  const driverSummaries = useMemo(() => {
    const grouped = new Map()
    for (const item of rows) {
      const driver = String(item.driver || 'Non renseigné').trim() || 'Non renseigné'
      if (!grouped.has(driver)) grouped.set(driver, [])
      grouped.get(driver).push(item)
    }
    return Array.from(grouped.entries()).map(([driver, items]) => {
      const latest = [...items].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))[0]
      const tracker = filteredTrackers.find((entry) => Number(entry.id) === Number(latest?.trackerId)) || null
      const totalTonnage = items.reduce((sum, item) => sum + parseQuantity(item.quantity), 0)
      const clients = Array.from(new Set(items.map((item) => item.client).filter(Boolean)))
      const destinations = Array.from(new Set(items.map((item) => item.destination).filter(Boolean)))
      return {
        driver,
        totalTonnage,
        blCount: items.length,
        clients,
        destinations,
        truckLabel: latest?.truckLabel || tracker?.label || '-',
        currentStatus: tracker?.state?.movement_status || 'inconnu',
        currentLocation: tracker?.state?.gps?.location ? `${tracker.state.gps.location.lat.toFixed(5)}, ${tracker.state.gps.location.lng.toFixed(5)}` : '-',
        currentSpeed: tracker?.state?.gps?.speed ?? 0,
        currentClient: latest?.client || '-',
        currentDestination: latest?.destination || '-',
        items,
      }
    }).sort((a, b) => a.driver.localeCompare(b.driver, 'fr'))
  }, [rows, filteredTrackers])

  const selectedSummary = driverSummaries.find((item) => item.driver === selectedDriver) || null

  async function exportPdf() {
    const brandBrown = [120, 72, 32]
    const brandGreen = [22, 101, 52]
    const softBrown = [248, 244, 236]
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })
    doc.setFillColor(...brandBrown)
    doc.roundedRect(12, 8, 273, 40, 4, 4, 'F')
    doc.setFillColor(...softBrown)
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
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('Rapport Chauffeurs', 150, 24, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text(`Période: du ${from || 'début'} au ${to || 'fin'}`, 280, 22, { align: 'right' })
    doc.text(`Édité le: ${new Date().toLocaleString('fr-FR')}`, 280, 31, { align: 'right' })
    doc.setDrawColor(...brandBrown)
    doc.line(14, 50, 283, 50)

    autoTable(doc, {
      startY: 56,
      head: [['Chauffeur', 'Camion', 'BL', 'Tonnage', 'Clients', 'Destination actuelle', 'Statut actuel', 'Position actuelle']],
      body: driverSummaries.map((item) => [
        item.driver,
        item.truckLabel,
        item.blCount,
        formatQty(item.totalTonnage),
        item.clients.join(', '),
        item.currentDestination,
        item.currentStatus,
        item.currentLocation,
      ]),
      styles: { fontSize: 10.5, cellPadding: 3, halign: 'center', valign: 'middle' },
      headStyles: { fillColor: brandGreen, textColor: [255, 255, 255], fontSize: 11, halign: 'center', valign: 'middle' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      bodyStyles: { textColor: [30, 41, 59], halign: 'center', valign: 'middle' },
    })

    const summaryY = (doc.lastAutoTable?.finalY || 56) + 10
    doc.setFillColor(...softBrown)
    doc.roundedRect(190, summaryY, 92, 16, 3, 3, 'F')
    doc.setTextColor(...brandBrown)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`Total chauffeurs: ${driverSummaries.length}`, 278, summaryY + 10, { align: 'right' })

    doc.setLineWidth(0.4)
    doc.line(14, 200, 283, 200)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text('Teliman Logistique', 14, 206)
    doc.text('Page 1/1', 283, 206, { align: 'right' })
    doc.save(`rapport-chauffeurs-${Date.now()}.pdf`)
  }

  return (
    <div className="reports-excel" style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>Rapport Chauffeurs</h3><p>Vue consolidée de l’activité chauffeur, clients desservis, tonnage et position actuelle.</p></div></div>
      </section>

      <section className="panel panel-large" style={{ minHeight: 'unset', paddingBottom: 18 }}>
        <div className="reports-filter-grid" style={{ marginTop: 0, alignItems: 'start' }}>
          <label className="field-stack">
            <span>Du</span>
            <StableDatePicker
              value={ymdToDate(from)}
              onChange={(value) => setFrom(dateToYmd(value) || today)}
              placeholder="Date début"
              clearable
              className="filter-control modern-date-input"
              popperClassName="modern-date-popper driver-report-date-popper"
            />
          </label>
          <label className="field-stack">
            <span>Au</span>
            <StableDatePicker
              value={ymdToDate(to)}
              onChange={(value) => setTo(dateToYmd(value) || today)}
              placeholder="Date fin"
              clearable
              className="filter-control modern-date-input"
              popperClassName="modern-date-popper driver-report-date-popper"
            />
          </label>
          <label className="field-stack">
            <span>Chauffeur</span>
            <select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
              <option value="">Tous</option>
              {driverSummaries.map((item) => <option key={item.driver} value={item.driver}>{item.driver}</option>)}
            </select>
          </label>
          <div className="field-stack" style={{ alignSelf: 'start', justifySelf: 'stretch' }}>
            <span>Export</span>
            <button type="button" className="primary-btn" onClick={exportPdf} style={{ width: '100%', minHeight: 48 }}><Download size={16} />Exporter PDF</button>
          </div>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Chauffeur</th><th>Camion</th><th>BL</th><th>Tonnage</th><th>Clients</th><th>Où il est allé</th><th>Où il est actuellement</th><th>Statut</th></tr></thead>
            <tbody>
              {(selectedDriver ? driverSummaries.filter((item) => item.driver === selectedDriver) : driverSummaries).map((item) => (
                <tr key={item.driver} onClick={() => setSelectedDriver(item.driver)} style={{ cursor: 'pointer' }}>
                  <td><strong>{item.driver}</strong></td>
                  <td><Truck size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.truckLabel}</td>
                  <td>{item.blCount}</td>
                  <td>{formatQty(item.totalTonnage)}</td>
                  <td>{item.clients.join(', ') || '-'}</td>
                  <td>{item.destinations.join(', ') || '-'}</td>
                  <td><MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.currentLocation}</td>
                  <td>{item.currentStatus}</td>
                </tr>
              ))}
              {driverSummaries.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucune activité chauffeur sur la période.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedSummary && (
        <section className="panel panel-large">
          <div className="panel-header"><div><h3>Détail chauffeur</h3><p>{selectedSummary.driver}</p></div></div>
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>BL</th><th>Client</th><th>Destination</th><th>Produit</th><th>Tonnage</th><th>Date déchargement</th><th>Camion</th></tr></thead>
              <tbody>
                {selectedSummary.items.map((item) => (
                  <tr key={item.id || item.reference}>
                    <td>{item.reference || '-'}</td>
                    <td>{item.client || '-'}</td>
                    <td>{item.destination || '-'}</td>
                    <td>{item.goods || '-'}</td>
                    <td>{formatQty(item.quantity)}</td>
                    <td>{item.date ? new Date(item.date).toLocaleString('fr-FR') : '-'}</td>
                    <td>{item.truckLabel || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
