import { useEffect, useMemo, useState } from 'react'
import { StableDatePicker } from '../components/StableDatePicker'
import { Download, MapPin, PackageCheck, Scale, Truck, UserRound } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  buildDriverReportTotals,
  buildDriverSummaries,
  dateToYmd,
  deliveryActivityDate,
  formatQty,
  latestDeliveryActivityYmd,
  toDate,
  ymdToDate,
} from '../lib/driverReport'

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
  const latestActivityDate = useMemo(() => latestDeliveryActivityYmd(deliveryOrders), [deliveryOrders])
  const fallbackDate = latestActivityDate || new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(fallbackDate)
  const [to, setTo] = useState(fallbackDate)
  const [selectedDriver, setSelectedDriver] = useState('')
  const [autoPeriodApplied, setAutoPeriodApplied] = useState(false)

  useEffect(() => {
    if (!latestActivityDate || autoPeriodApplied) return
    setFrom(latestActivityDate)
    setTo(latestActivityDate)
    setAutoPeriodApplied(true)
  }, [autoPeriodApplied, latestActivityDate])

  const driverSummaries = useMemo(() => buildDriverSummaries({ deliveryOrders, filteredTrackers, from, to }), [deliveryOrders, filteredTrackers, from, to])

  const selectedSummary = driverSummaries.find((item) => item.driver === selectedDriver) || null
  const visibleSummaries = selectedDriver ? driverSummaries.filter((item) => item.driver === selectedDriver) : driverSummaries
  const totals = useMemo(() => buildDriverReportTotals(driverSummaries), [driverSummaries])

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
      <section className="panel reports-v2-hero" style={{ minHeight: 'unset' }}>
        <div className="panel-header"><div><h3>Rapport Chauffeurs</h3><p>Vue consolidée des BL, tonnages, clients desservis et position actuelle par chauffeur.</p></div></div>
        <section className="stats-grid stats-grid-tight" style={{ marginTop: 18 }}>
          <article className="stat-card"><div className="stat-icon"><UserRound size={18} /></div><div><p>Chauffeurs actifs</p><strong>{totals.drivers}</strong></div></article>
          <article className="stat-card"><div className="stat-icon"><PackageCheck size={18} /></div><div><p>Bons livraison</p><strong>{totals.blCount}</strong></div></article>
          <article className="stat-card"><div className="stat-icon"><Scale size={18} /></div><div><p>Tonnage livré</p><strong>{formatQty(totals.tonnage)}</strong></div></article>
          <article className="stat-card"><div className="stat-icon"><Truck size={18} /></div><div><p>Camions</p><strong>{totals.trucks}</strong></div></article>
        </section>
      </section>

      <section className="panel panel-large" style={{ minHeight: 'unset', paddingBottom: 18 }}>
        <div className="reports-filter-grid" style={{ marginTop: 0, alignItems: 'start' }}>
          <label className="field-stack">
            <span>Du</span>
            <StableDatePicker
              value={ymdToDate(from)}
              onChange={(value) => setFrom(dateToYmd(value) || fallbackDate)}
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
              onChange={(value) => setTo(dateToYmd(value) || fallbackDate)}
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
              {visibleSummaries.map((item) => (
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
              {visibleSummaries.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucune activité chauffeur sur la période sélectionnée.</td></tr>}
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
                    <td>{deliveryActivityDate(item) ? toDate(deliveryActivityDate(item))?.toLocaleString('fr-FR') : '-'}</td>
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
