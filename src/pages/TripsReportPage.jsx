import { useEffect, useMemo, useState } from 'react'
import { Download, Route, Truck, UserRound } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { StableDatePicker } from '../components/StableDatePicker'
import { loadTracksBatch } from '../lib/fleeti'

const STOP_GAP_MINUTES = 35
const MIN_TRIP_DISTANCE_KM = 1

function dateToYmd(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return value.toISOString().slice(0, 10)
}

function ymdToDate(value) {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toDate(value) {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(normalized.getTime()) ? null : normalized
}

function formatDateTime(value) {
  const date = toDate(value)
  return date ? date.toLocaleString('fr-FR') : '-'
}

function formatDurationMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (!hours) return `${mins} min`
  return `${hours}h ${String(mins).padStart(2, '0')}`
}

function formatDistance(km) {
  const value = Number(km) || 0
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

function pointLat(point) {
  return Number(point?.lat ?? point?.latitude ?? point?.location?.lat ?? null)
}

function pointLng(point) {
  return Number(point?.lng ?? point?.lon ?? point?.longitude ?? point?.location?.lng ?? null)
}

function pointTime(point) {
  return point?.time ?? point?.datetime ?? point?.date_time ?? point?.created_at ?? null
}

function pointSpeed(point) {
  return Number(point?.speed ?? point?.gps?.speed ?? point?.velocity ?? 0)
}

function segmentStart(segment) {
  return segment?.from ?? segment?.start_time ?? segment?.start_date ?? segment?.begin ?? segment?.start ?? segment?.date_from ?? null
}

function segmentEnd(segment) {
  return segment?.to ?? segment?.end_time ?? segment?.end_date ?? segment?.finish ?? segment?.end ?? segment?.date_to ?? null
}

function segmentLengthKm(segment) {
  return Number(segment?.length ?? segment?.distance ?? segment?.km ?? 0) || 0
}

function segmentAvgSpeed(segment) {
  return Number(segment?.avg_speed ?? segment?.average_speed ?? 0) || 0
}

function segmentMaxSpeed(segment) {
  return Number(segment?.max_speed ?? segment?.speed_max ?? 0) || 0
}

function durationMinutes(start, end) {
  const startDate = toDate(start)
  const endDate = toDate(end)
  if (!startDate || !endDate) return 0
  return Math.max(0, (endDate.getTime() - startDate.getTime()) / 60000)
}

function buildTrips(bundle, tracker) {
  const points = Array.isArray(bundle?.points) ? bundle.points : []
  const segments = Array.isArray(bundle?.segments) ? bundle.segments : []
  const events = Array.isArray(bundle?.events) ? bundle.events : []

  const normalizedSegments = segments
    .map((segment, index) => ({
      id: `${bundle.trackerId}-segment-${index}`,
      start: segmentStart(segment),
      end: segmentEnd(segment),
      distanceKm: segmentLengthKm(segment),
      avgSpeed: segmentAvgSpeed(segment),
      maxSpeed: segmentMaxSpeed(segment),
    }))
    .filter((segment) => toDate(segment.start) && toDate(segment.end))
    .sort((a, b) => toDate(a.start) - toDate(b.start))

  if (!normalizedSegments.length && points.length > 1) {
    const firstTime = pointTime(points[0])
    const lastTime = pointTime(points[points.length - 1])
    if (toDate(firstTime) && toDate(lastTime)) {
      normalizedSegments.push({
        id: `${bundle.trackerId}-fallback-0`,
        start: firstTime,
        end: lastTime,
        distanceKm: 0,
        avgSpeed: 0,
        maxSpeed: Math.max(...points.map(pointSpeed), 0),
      })
    }
  }

  const trips = []
  let currentTrip = null

  const flushTrip = () => {
    if (!currentTrip) return
    currentTrip.durationMinutes = durationMinutes(currentTrip.start, currentTrip.end)
    currentTrip.events = events.filter((event) => {
      const eventTime = toDate(event?.time)
      return eventTime && eventTime >= toDate(currentTrip.start) && eventTime <= toDate(currentTrip.end)
    })
    currentTrip.eventCount = currentTrip.events.length
    currentTrip.distanceKm = Number(currentTrip.distanceKm.toFixed(1))
    currentTrip.avgSpeed = currentTrip.durationMinutes > 0
      ? Number((currentTrip.distanceKm / (currentTrip.durationMinutes / 60)).toFixed(1))
      : Number((currentTrip.avgSpeed || 0).toFixed(1))
    currentTrip.maxSpeed = Number((currentTrip.maxSpeed || 0).toFixed(0))
    if (currentTrip.distanceKm >= MIN_TRIP_DISTANCE_KM || currentTrip.durationMinutes >= 10) {
      trips.push(currentTrip)
    }
    currentTrip = null
  }

  normalizedSegments.forEach((segment) => {
    if (!currentTrip) {
      currentTrip = {
        id: `${bundle.trackerId}-trip-${trips.length + 1}`,
        trackerId: bundle.trackerId,
        truckLabel: tracker?.label || `Camion ${bundle.trackerId}`,
        driver: tracker?.employeeName || 'Non assigné',
        start: segment.start,
        end: segment.end,
        distanceKm: segment.distanceKm,
        avgSpeed: segment.avgSpeed,
        maxSpeed: segment.maxSpeed,
      }
      return
    }

    const gapMinutes = durationMinutes(currentTrip.end, segment.start)
    if (gapMinutes <= STOP_GAP_MINUTES) {
      currentTrip.end = segment.end
      currentTrip.distanceKm += segment.distanceKm
      currentTrip.maxSpeed = Math.max(currentTrip.maxSpeed || 0, segment.maxSpeed || 0)
      currentTrip.avgSpeed = currentTrip.avgSpeed || segment.avgSpeed
      return
    }

    flushTrip()
    currentTrip = {
      id: `${bundle.trackerId}-trip-${trips.length + 1}`,
      trackerId: bundle.trackerId,
      truckLabel: tracker?.label || `Camion ${bundle.trackerId}`,
      driver: tracker?.employeeName || 'Non assigné',
      start: segment.start,
      end: segment.end,
      distanceKm: segment.distanceKm,
      avgSpeed: segment.avgSpeed,
      maxSpeed: segment.maxSpeed,
    }
  })

  flushTrip()
  return trips
}

export function TripsReportPage({ filteredTrackers = [] }) {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [selectedTrackerId, setSelectedTrackerId] = useState('')
  const [selectedDriver, setSelectedDriver] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trips, setTrips] = useState([])

  const trackerOptions = useMemo(() => filteredTrackers.map((tracker) => ({
    id: String(tracker.id),
    label: tracker.label,
    driver: tracker.employeeName || 'Non assigné',
  })).sort((a, b) => a.label.localeCompare(b.label, 'fr')), [filteredTrackers])

  const driverOptions = useMemo(() => Array.from(new Set(trackerOptions.map((tracker) => tracker.driver))).sort((a, b) => a.localeCompare(b, 'fr')), [trackerOptions])

  useEffect(() => {
    let cancelled = false

    async function run() {
      const candidateTrackers = filteredTrackers.filter((tracker) => {
        if (selectedTrackerId && String(tracker.id) !== selectedTrackerId) return false
        if (selectedDriver && (tracker.employeeName || 'Non assigné') !== selectedDriver) return false
        return true
      })

      if (!candidateTrackers.length) {
        setTrips([])
        return
      }

      setLoading(true)
      setError('')
      try {
        const payload = await loadTracksBatch({
          trackerIds: candidateTrackers.map((tracker) => tracker.id),
          from: `${from} 00:00:00`,
          to: `${to} 23:59:59`,
        })

        if (cancelled) return

        const trackerMap = new Map(candidateTrackers.map((tracker) => [String(tracker.id), tracker]))
        const builtTrips = (payload?.items || [])
          .flatMap((bundle) => buildTrips(bundle, trackerMap.get(String(bundle.trackerId))))
          .sort((a, b) => (toDate(b.start)?.getTime() || 0) - (toDate(a.start)?.getTime() || 0))

        setTrips(builtTrips)
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Impossible de charger les trajets Fleeti.')
          setTrips([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [filteredTrackers, from, to, selectedDriver, selectedTrackerId])

  const filteredTrips = useMemo(() => trips.filter((trip) => {
    if (selectedTrackerId && String(trip.trackerId) !== selectedTrackerId) return false
    if (selectedDriver && trip.driver !== selectedDriver) return false
    return true
  }), [trips, selectedDriver, selectedTrackerId])

  const summaryByTruck = useMemo(() => {
    const grouped = new Map()
    filteredTrips.forEach((trip) => {
      const key = `${trip.trackerId}`
      const current = grouped.get(key) || { trackerId: trip.trackerId, truckLabel: trip.truckLabel, driver: trip.driver, tripCount: 0, distanceKm: 0, durationMinutes: 0, eventCount: 0 }
      current.tripCount += 1
      current.distanceKm += trip.distanceKm
      current.durationMinutes += trip.durationMinutes
      current.eventCount += trip.eventCount
      grouped.set(key, current)
    })
    return Array.from(grouped.values()).sort((a, b) => b.distanceKm - a.distanceKm)
  }, [filteredTrips])

  const summaryByDriver = useMemo(() => {
    const grouped = new Map()
    filteredTrips.forEach((trip) => {
      const key = trip.driver || 'Non assigné'
      const current = grouped.get(key) || { driver: key, tripCount: 0, distanceKm: 0, durationMinutes: 0, eventCount: 0, trucks: new Set() }
      current.tripCount += 1
      current.distanceKm += trip.distanceKm
      current.durationMinutes += trip.durationMinutes
      current.eventCount += trip.eventCount
      current.trucks.add(trip.truckLabel)
      grouped.set(key, current)
    })
    return Array.from(grouped.values()).map((entry) => ({ ...entry, trucks: Array.from(entry.trucks).sort((a, b) => a.localeCompare(b, 'fr')) })).sort((a, b) => b.distanceKm - a.distanceKm)
  }, [filteredTrips])

  const totals = useMemo(() => ({
    tripCount: filteredTrips.length,
    distanceKm: filteredTrips.reduce((sum, trip) => sum + trip.distanceKm, 0),
    durationMinutes: filteredTrips.reduce((sum, trip) => sum + trip.durationMinutes, 0),
    eventCount: filteredTrips.reduce((sum, trip) => sum + trip.eventCount, 0),
  }), [filteredTrips])

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(18)
    doc.text('Rapport Trajets Fleeti', 14, 18)
    doc.setFontSize(11)
    doc.text(`Période: ${from} → ${to}`, 14, 26)
    doc.text(`Règle métier: option B (regroupement de segments proches, arrêt > ${STOP_GAP_MINUTES} min = nouveau trajet)`, 14, 33)

    autoTable(doc, {
      startY: 40,
      head: [['Camion', 'Chauffeur', 'Trajets', 'Distance', 'Durée', 'Événements']],
      body: summaryByTruck.map((item) => [
        item.truckLabel,
        item.driver,
        item.tripCount,
        formatDistance(item.distanceKm),
        formatDurationMinutes(item.durationMinutes),
        item.eventCount,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [0, 153, 102] },
    })

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 10,
      head: [['Départ', 'Arrivée', 'Camion', 'Chauffeur', 'Distance', 'Durée', 'Vitesse moy.', 'Vitesse max', 'Événements']],
      body: filteredTrips.map((trip) => [
        formatDateTime(trip.start),
        formatDateTime(trip.end),
        trip.truckLabel,
        trip.driver,
        formatDistance(trip.distanceKm),
        formatDurationMinutes(trip.durationMinutes),
        `${trip.avgSpeed || 0} km/h`,
        `${trip.maxSpeed || 0} km/h`,
        trip.eventCount,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    })

    doc.save(`rapport-trajets-fleeti-${Date.now()}.pdf`)
  }

  return (
    <div className="reports-excel" style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>Rapport Trajets Fleeti</h3><p>Trajets camion / chauffeur calculés directement depuis les données de trajet Fleeti avec regroupement métier option B.</p></div></div>
      </section>

      <section className="panel panel-large" style={{ minHeight: 'unset', paddingBottom: 18 }}>
        <div className="reports-filter-grid" style={{ marginTop: 0, alignItems: 'start' }}>
          <label className="field-stack">
            <span>Du</span>
            <StableDatePicker value={ymdToDate(from)} onChange={(value) => setFrom(dateToYmd(value) || today)} placeholder="Date début" className="filter-control modern-date-input" popperClassName="modern-date-popper" />
          </label>
          <label className="field-stack">
            <span>Au</span>
            <StableDatePicker value={ymdToDate(to)} onChange={(value) => setTo(dateToYmd(value) || today)} placeholder="Date fin" className="filter-control modern-date-input" popperClassName="modern-date-popper" />
          </label>
          <label className="field-stack">
            <span>Camion</span>
            <select value={selectedTrackerId} onChange={(e) => setSelectedTrackerId(e.target.value)}>
              <option value="">Tous</option>
              {trackerOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span>Chauffeur</span>
            <select value={selectedDriver} onChange={(e) => setSelectedDriver(e.target.value)}>
              <option value="">Tous</option>
              {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
            </select>
          </label>
          <div className="field-stack" style={{ alignSelf: 'start', justifySelf: 'stretch' }}>
            <span>Export</span>
            <button className="primary-btn" onClick={exportPdf} style={{ width: '100%', minHeight: 48 }} disabled={loading || !filteredTrips.length}><Download size={16} />Exporter PDF</button>
          </div>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="info-banner">Chargement des trajets Fleeti…</div>}

      <section className="stats-grid stats-grid-tight">
        <article className="stat-card"><div className="stat-icon"><Route size={18} /></div><div><p>Total trajets</p><strong>{totals.tripCount}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><Truck size={18} /></div><div><p>Distance totale</p><strong>{formatDistance(totals.distanceKm)}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><UserRound size={18} /></div><div><p>Temps conduite</p><strong>{formatDurationMinutes(totals.durationMinutes)}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><Download size={18} /></div><div><p>Événements</p><strong>{totals.eventCount}</strong></div></article>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Synthèse par camion</h3><p>Regroupement des trajets Fleeti par véhicule.</p></div></div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Camion</th><th>Chauffeur</th><th>Trajets</th><th>Distance</th><th>Durée</th><th>Événements</th></tr></thead>
            <tbody>
              {summaryByTruck.map((item) => (
                <tr key={item.trackerId}>
                  <td>{item.truckLabel}</td>
                  <td>{item.driver}</td>
                  <td>{item.tripCount}</td>
                  <td>{formatDistance(item.distanceKm)}</td>
                  <td>{formatDurationMinutes(item.durationMinutes)}</td>
                  <td>{item.eventCount}</td>
                </tr>
              ))}
              {!summaryByTruck.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun trajet trouvé sur la période.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Synthèse par chauffeur</h3><p>Vue consolidée chauffeur avec les camions utilisés.</p></div></div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Chauffeur</th><th>Camions</th><th>Trajets</th><th>Distance</th><th>Durée</th><th>Événements</th></tr></thead>
            <tbody>
              {summaryByDriver.map((item) => (
                <tr key={item.driver}>
                  <td>{item.driver}</td>
                  <td>{item.trucks.join(', ') || '-'}</td>
                  <td>{item.tripCount}</td>
                  <td>{formatDistance(item.distanceKm)}</td>
                  <td>{formatDurationMinutes(item.durationMinutes)}</td>
                  <td>{item.eventCount}</td>
                </tr>
              ))}
              {!summaryByDriver.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun chauffeur avec trajet sur la période.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Détail des trajets</h3><p>Chaque ligne correspond à un trajet métier obtenu par regroupement de segments Fleeti proches.</p></div></div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Départ</th><th>Arrivée</th><th>Camion</th><th>Chauffeur</th><th>Distance</th><th>Durée</th><th>Vitesse moy.</th><th>Vitesse max</th><th>Événements</th></tr></thead>
            <tbody>
              {filteredTrips.map((trip) => (
                <tr key={trip.id}>
                  <td>{formatDateTime(trip.start)}</td>
                  <td>{formatDateTime(trip.end)}</td>
                  <td>{trip.truckLabel}</td>
                  <td>{trip.driver}</td>
                  <td>{formatDistance(trip.distanceKm)}</td>
                  <td>{formatDurationMinutes(trip.durationMinutes)}</td>
                  <td>{trip.avgSpeed || 0} km/h</td>
                  <td>{trip.maxSpeed || 0} km/h</td>
                  <td>{trip.eventCount}</td>
                </tr>
              ))}
              {!filteredTrips.length && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun trajet Fleeti trouvé pour ce filtre.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
