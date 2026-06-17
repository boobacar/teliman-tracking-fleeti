import { useEffect, useMemo, useState } from 'react'
import { StableDatePicker } from '../components/StableDatePicker'
import { AlertTriangle, CheckCircle, Clock, Download, IdCard, MapPin, PackageCheck, Scale, Truck, UserRound } from 'lucide-react'
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
import { loadEmployeesDetail } from '../lib/fleeti'
import { PageStack, SectionHeader } from '../components/UIPrimitives'

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
  const [employees, setEmployees] = useState([])

  useEffect(() => {
    let cancelled = false
    loadEmployeesDetail().then((data) => {
      if (!cancelled) setEmployees(Array.isArray(data) ? data : data?.employees || data?.items || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!latestActivityDate || autoPeriodApplied) return
    setFrom(latestActivityDate)
    setTo(latestActivityDate)
    setAutoPeriodApplied(true)
  }, [autoPeriodApplied, latestActivityDate])

  const driverSummaries = useMemo(() => buildDriverSummaries({ deliveryOrders, filteredTrackers, from, to }), [deliveryOrders, filteredTrackers, from, to])

  const licenseByDriver = useMemo(() => {
    const map = {}
    for (const emp of employees) {
      const fullName = [
        emp.first_name || emp.firstname || emp.firstName,
        emp.last_name || emp.lastname || emp.lastName,
      ].filter(Boolean).join(' ').trim().toUpperCase()
      if (!fullName) continue
      const licenseValidTill = emp.license_valid_till || emp.license_expiry || emp.driving_license_expiry || null
      map[fullName] = {
        licenseValidTill,
        licenseNumber: emp.license_number || emp.license_no || emp.driving_license || '-',
        licenseCategories: emp.license_categories || emp.license_category || '-',
      }
    }
    return map
  }, [employees])

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
    <PageStack className="ops-page-stack">
      <section className="panel panel-large delivery-hero-panel reports-v2-hero">
        <SectionHeader title="Rapport Chauffeurs" description="Vue consolidée des BL, tonnages, clients desservis et position actuelle par chauffeur." />
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
            <thead><tr><th>Chauffeur</th><th>Camion</th><th>BL</th><th>Tonnage</th><th>Clients</th><th>Où il est allé</th><th>Où il est actuellement</th><th>Permis</th><th>Statut</th></tr></thead>
            <tbody>
              {visibleSummaries.map((item) => {
                const driverKey = String(item.driver || '').trim().toUpperCase()
                const licenseInfo = licenseByDriver[driverKey]
                const licenseDate = licenseInfo?.licenseValidTill ? new Date(licenseInfo.licenseValidTill) : null
                const now = new Date()
                const thirtyDays = 30 * 24 * 60 * 60 * 1000
                const licenseExpired = licenseDate && licenseDate.getTime() < now.getTime()
                const licenseUrgent = licenseDate && !licenseExpired && licenseDate.getTime() - now.getTime() < thirtyDays

                return (
                <tr key={item.driver} onClick={() => setSelectedDriver(item.driver)} style={{ cursor: 'pointer' }}>
                  <td><strong>{item.driver}</strong></td>
                  <td><Truck size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.truckLabel}</td>
                  <td>{item.blCount}</td>
                  <td>{formatQty(item.totalTonnage)}</td>
                  <td>{item.clients.join(', ') || '-'}</td>
                  <td>{item.destinations.join(', ') || '-'}</td>
                  <td><MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.currentLocation}</td>
                  <td>
                    {licenseDate ? (
                      licenseExpired ? (
                        <span style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <AlertTriangle size={14} /> Expiré
                        </span>
                      ) : licenseUrgent ? (
                        <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <AlertTriangle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}
                        </span>
                      ) : (
                        <span style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <CheckCircle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}
                        </span>
                      )
                    ) : (
                      <span style={{ color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={14} /> Inconnu
                      </span>
                    )}
                  </td>
                  <td>{item.currentStatus}</td>
                </tr>
                )
              })}
              {visibleSummaries.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucune activité chauffeur sur la période sélectionnée.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selectedSummary && (
        <section className="panel panel-large delivery-table-panel">
          <SectionHeader title="Détail chauffeur" description={selectedSummary.driver} />
          {(() => {
            const driverKey = String(selectedSummary.driver || '').trim().toUpperCase()
            const licenseInfo = licenseByDriver[driverKey]
            const licenseDate = licenseInfo?.licenseValidTill ? new Date(licenseInfo.licenseValidTill) : null
            const now = new Date()
            const thirtyDays = 30 * 24 * 60 * 60 * 1000
            const licenseExpired = licenseDate && licenseDate.getTime() < now.getTime()
            const licenseUrgent = licenseDate && !licenseExpired && licenseDate.getTime() - now.getTime() < thirtyDays
            return (
              <div className="stats-grid stats-grid-tight" style={{ marginTop: 12, marginBottom: 8 }}>
                <article className="stat-card">
                  <div className="stat-icon">
                    {licenseDate
                      ? licenseExpired
                        ? <AlertTriangle size={16} color="#ef4444" />
                        : licenseUrgent
                          ? <AlertTriangle size={16} color="#f59e0b" />
                          : <CheckCircle size={16} color="#22c55e" />
                      : <Clock size={16} color="#64748b" />
                    }
                  </div>
                  <div>
                    <p>Permis valide jusqu'au</p>
                    <strong>{licenseDate ? licenseDate.toLocaleDateString('fr-FR') : 'Non renseigné'}</strong>
                  </div>
                </article>
                <article className="stat-card">
                  <div className="stat-icon"><IdCard size={16} /></div>
                  <div><p>N° Permis</p><strong>{licenseInfo?.licenseNumber || '-'}</strong></div>
                </article>
                <article className="stat-card">
                  <div className="stat-icon"><Truck size={16} /></div>
                  <div><p>Catégories</p><strong>{licenseInfo?.licenseCategories || '-'}</strong></div>
                </article>
              </div>
            )
          })()}
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
    </PageStack>
  )
}
