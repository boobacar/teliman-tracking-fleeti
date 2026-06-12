import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, Gauge, Droplet, Wrench, Calendar, Filter, Trash2, AlertCircle, Clock } from 'lucide-react'
import { EmptyBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { StableDatePicker } from '../components/StableDatePicker'
import { loadOilChanges, createOilChange, deleteOilChange, loadLiveOdometer } from '../lib/fleeti'

const OIL_TYPES = ['15W40', '20W50', '10W40', '5W30', '5W40', '0W20', 'Autre']
const STATUS_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'warning', label: 'À prévoir' },
  { id: 'ok', label: 'OK' },
]

const initialForm = {
  trackerId: '',
  truckLabel: '',
  date: '',
  odometerKm: '',
  oilType: '',
  oilQuantityL: '',
  filterChanged: true,
  nextChangeKm: '',
  nextChangeDate: '',
  notes: '',
  receiptExpiryDate: '',
}

export function OilChangesPage({ enrichedTrackers = [] }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [liveOdometer, setLiveOdometer] = useState([])
  const [odometerLoading, setOdometerLoading] = useState(false)
  const [odometerError, setOdometerError] = useState('')

  // Filtrer les véhicules : exclure les labels contenant "plateau"
  const truckOptions = useMemo(() => {
    return enrichedTrackers.filter((t) => {
      const label = String(t.label || '').toLowerCase()
      return !label.includes('plateau')
    })
  }, [enrichedTrackers])

  const reload = async () => {
    const payload = await loadOilChanges()
    setItems(payload.items ?? [])
  }

  const reloadOdometer = async () => {
    setOdometerLoading(true)
    setOdometerError('')
    try {
      const payload = await loadLiveOdometer()
      setLiveOdometer(payload?.items || [])
    } catch (err) {
      setOdometerError(err.message || 'Impossible de charger le kilométrage live')
    } finally {
      setOdometerLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoading(true)
      try {
        const payload = await loadOilChanges()
        if (!cancelled) setItems(payload.items ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) reloadOdometer()
    }
    loadData()
    return () => { cancelled = true }
  }, [])

  // Fusion kilométrage live avec trackers enrichis
  const truckOdometerMap = useMemo(() => {
    const map = {}
    liveOdometer.forEach((entry) => {
      if (entry.trackerId != null) map[String(entry.trackerId)] = entry
    })
    return map
  }, [liveOdometer])

  // Tableau de bord par camion : fusion trackers enrichis + live + historique
  const fleetRows = useMemo(() => {
    return truckOptions.map((tracker) => {
      const live = truckOdometerMap[String(tracker.id)]
      // Chercher la dernière vidange pour ce tracker
      const lastChange = items.find((item) => String(item.trackerId) === String(tracker.id))
      const liveOdo = live?.odometer ?? null
      const nextChangeKm = lastChange?.nextChangeKm || 0
      const remainingKm = liveOdo != null && nextChangeKm > 0 ? nextChangeKm - liveOdo : null
      let status = 'unknown'
      if (remainingKm != null) {
        if (remainingKm <= 500) status = 'urgent'
        else if (remainingKm <= 2000) status = 'warning'
        else status = 'ok'
      }
      return {
        tracker,
        live,
        lastChange,
        liveOdo,
        nextChangeKm: nextChangeKm || null,
        remainingKm,
        status,
        totalChanges: items.filter((item) => String(item.trackerId) === String(tracker.id)).length,
      }
    })
  }, [truckOptions, truckOdometerMap, items])

  // Filtrage combiné camion + statut
  const filteredFleet = useMemo(() => {
    return fleetRows.filter((row) => {
      if (trackerFilter !== 'all' && String(row.tracker.id) !== String(trackerFilter)) return false
      if (statusFilter === 'urgent' && row.status !== 'urgent') return false
      if (statusFilter === 'warning' && row.status !== 'warning') return false
      if (statusFilter === 'ok' && row.status !== 'ok') return false
      return true
    })
  }, [fleetRows, trackerFilter, statusFilter])

  // Tri de l'historique par date décroissante
  const historyFiltered = useMemo(() => {
    let filtered = [...items]
    if (trackerFilter !== 'all') {
      filtered = filtered.filter((item) => String(item.trackerId) === String(trackerFilter))
    }
    return filtered.sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [items, trackerFilter])

  const onTruckChange = (value) => {
    const tracker = truckOptions.find((item) => String(item.id) === String(value))
    const live = truckOdometerMap[String(value)]
    setForm((current) => ({
      ...current,
      trackerId: value,
      truckLabel: tracker?.label || '',
      odometerKm: live?.odometer != null ? String(live.odometer) : current.odometerKm,
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createOilChange({
        ...form,
        odometerKm: Number(form.odometerKm),
        oilQuantityL: Number(form.oilQuantityL),
        nextChangeKm: Number(form.nextChangeKm),
      })
      await reload()
      setForm(initialForm)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    await deleteOilChange(item.id)
    await reload()
  }

  // Stats globales
  const totalVidanges = items.length
  const trucksWithHistory = new Set(items.map((item) => item.trackerId)).size
  const urgentCount = fleetRows.filter((row) => row.status === 'urgent').length
  const warningCount = fleetRows.filter((row) => row.status === 'warning').length
  const okCount = fleetRows.filter((row) => row.status === 'ok').length
  const trucksWithOdometer = fleetRows.filter((row) => row.liveOdo != null).length

  // Trouver le tracker label par id
  const getTruckLabel = (trackerId) => {
    const tracker = truckOptions.find((t) => String(t.id) === String(trackerId))
    return tracker?.label || `Tracker ${trackerId}`
  }

  return (
    <PageStack className="ops-page-stack">
      {/* KPIs */}
      <section className="panel panel-large delivery-hero-panel">
        <SectionHeader title="Suivi vidange" right={<div className="mission-hero-badge"><Wrench size={14} /> Maintenance</div>} />
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card">
            <span>Total vidanges</span>
            <strong>{totalVidanges}</strong>
            <small>enregistrées</small>
          </div>
          <div className="mission-highlight-card">
            <span>Véhicules suivis</span>
            <strong>{trucksWithHistory}/{truckOptions.length}</strong>
            <small>avec historique</small>
          </div>
          <div className="mission-highlight-card">
            <span><AlertTriangle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#ef4444' }} />Urgent</span>
            <strong style={{ color: urgentCount > 0 ? '#ef4444' : undefined }}>{urgentCount}</strong>
            <small>moins de 500 km</small>
          </div>
          <div className="mission-highlight-card">
            <span><AlertCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#f59e0b' }} />À prévoir</span>
            <strong style={{ color: warningCount > 0 ? '#f59e0b' : undefined }}>{warningCount}</strong>
            <small>500–2000 km</small>
          </div>
          <div className="mission-highlight-card">
            <span><CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#22c55e' }} />OK</span>
            <strong>{okCount}</strong>
            <small>à jour</small>
          </div>
        </div>
      </section>

      {/* Kilométrage live */}
      <section className="panel panel-large delivery-table-panel">
        <SectionHeader
          title="Kilométrage live et échéances"
          description="Données temps réel via l'API publique Fleeti. Kilométrage total de chaque véhicule."
          right={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {odometerError && <span style={{ color: '#ef4444', fontSize: 12 }}>{odometerError}</span>}
              <button type="button" className="ghost-btn small-btn" onClick={reloadOdometer} disabled={odometerLoading}>
                {odometerLoading ? 'Actualisation…' : 'Actualiser'}
              </button>
            </div>
          }
        />
        {/* Filtres rapides */}
        <div className="filters filter-row ops-filter-row">
          <label className="field-stack">
            <span>Camion</span>
            <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
              <option value="all">Tous les camions</option>
              {truckOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span>Statut vidange</span>
            <select className="filter-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_FILTERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div className="field-stack">
            <span>Kilométrage live</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{trucksWithOdometer}/{truckOptions.length} véhicules</span>
          </div>
        </div>

        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Camion</th>
                <th>Kilométrage total</th>
                <th>Prochaine vidange</th>
                <th>Km restants</th>
                <th>Statut</th>
                <th>Dernière vidange</th>
                <th>Nb. vidanges</th>
              </tr>
            </thead>
            <tbody>
              {filteredFleet.map((row) => {
                const StatusIcon = row.status === 'urgent' ? AlertTriangle
                  : row.status === 'warning' ? AlertCircle
                  : row.status === 'ok' ? CheckCircle
                  : Clock
                const statusColor = row.status === 'urgent' ? '#ef4444'
                  : row.status === 'warning' ? '#f59e0b'
                  : row.status === 'ok' ? '#22c55e'
                  : '#64748b'
                const statusLabel = row.status === 'urgent' ? 'Vidange urgente'
                  : row.status === 'warning' ? 'À prévoir'
                  : row.status === 'ok' ? 'À jour'
                  : 'Inconnu'
                return (
                  <tr key={`odo-${row.tracker.id}`}>
                    <td><strong>{row.tracker.label}</strong></td>
                    <td>
                      {row.liveOdo != null
                        ? <span><Gauge size={12} style={{ marginRight: 4, verticalAlign: 'middle', opacity: 0.6 }} />{Number(row.liveOdo).toLocaleString('fr-FR')} km</span>
                        : <span style={{ color: '#64748b' }}>N/A</span>}
                    </td>
                    <td>{row.nextChangeKm ? `${Number(row.nextChangeKm).toLocaleString('fr-FR')} km` : '-'}</td>
                    <td style={{ color: row.remainingKm != null ? statusColor : undefined, fontWeight: row.remainingKm != null && row.remainingKm <= 500 ? 600 : undefined }}>
                      {row.remainingKm != null ? `${row.remainingKm > 0 ? Number(row.remainingKm).toLocaleString('fr-FR') : '0'} km` : '-'}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: statusColor }}>
                        <StatusIcon size={14} />
                        {statusLabel}
                      </span>
                    </td>
                    <td>{row.lastChange ? new Date(row.lastChange.date).toLocaleDateString('fr-FR') : 'Aucune'}</td>
                    <td>{row.totalChanges}</td>
                  </tr>
                )
              })}
              {filteredFleet.length === 0 && (
                <tr><td colSpan={7} className="table-empty-cell">Aucun véhicule ne correspond aux filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Formulaire nouvelle vidange */}
      <section className="panel panel-large delivery-form-panel">
        <SectionHeader title="Nouvelle vidange" right={<Droplet size={16} style={{ opacity: 0.5 }} />} />
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <label className="field-stack">
            <span>Camion</span>
            <select aria-label="Camion" value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required>
              <option value="">Sélectionner un camion</option>
              {truckOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field-stack">
              <span>Date de la vidange</span>
              <StableDatePicker
                value={form.date ? new Date(form.date + 'T00:00:00') : null}
                onChange={(value) => setForm((c) => ({ ...c, date: value ? value.toISOString().slice(0, 10) : '' }))}
                placeholder="Date"
                clearable
                className="filter-control modern-date-input"
              />
            </label>
            <label className="field-stack">
              <span>Kilométrage au moment de la vidange</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" step="1" min="0" value={form.odometerKm}
                  onChange={(e) => setForm((c) => ({ ...c, odometerKm: e.target.value }))}
                  placeholder="Kilométrage" required style={{ flex: 1 }}
                />
                {form.trackerId && truckOdometerMap[String(form.trackerId)]?.odometer != null && (
                  <button type="button" className="ghost-btn small-btn"
                    onClick={() => setForm((c) => ({ ...c, odometerKm: String(truckOdometerMap[String(form.trackerId)].odometer) }))}
                    title="Utiliser le kilométrage live">
                    <Gauge size={14} /> Live
                  </button>
                )}
              </div>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field-stack">
              <span>Type d'huile</span>
              <select aria-label="Type d'huile" value={form.oilType} onChange={(e) => setForm((c) => ({ ...c, oilType: e.target.value }))}>
                <option value="">Sélectionner</option>
                {OIL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span>Quantité (L)</span>
              <input type="number" step="0.5" min="0" value={form.oilQuantityL} onChange={(e) => setForm((c) => ({ ...c, oilQuantityL: e.target.value }))} placeholder="Litres" />
            </label>
          </div>
          <label className="field-stack" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <span style={{ cursor: 'pointer' }} onClick={() => setForm((c) => ({ ...c, filterChanged: !c.filterChanged }))}>Filtre à huile changé</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.filterChanged}
              aria-label="Filtre à huile changé"
              onClick={() => setForm((c) => ({ ...c, filterChanged: !c.filterChanged }))}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                background: form.filterChanged ? '#22c55e' : '#334155',
                position: 'relative',
                transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: form.filterChanged ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field-stack">
              <span>Prochaine vidange (km)</span>
              <input type="number" step="500" min="0" value={form.nextChangeKm}
                onChange={(e) => setForm((c) => ({ ...c, nextChangeKm: e.target.value }))}
                placeholder="ex: 150000" />
            </label>
            <label className="field-stack">
              <span>Prochaine vidange (date indicative)</span>
              <StableDatePicker
                value={form.nextChangeDate ? new Date(form.nextChangeDate + 'T00:00:00') : null}
                onChange={(value) => setForm((c) => ({ ...c, nextChangeDate: value ? value.toISOString().slice(0, 10) : '' }))}
                placeholder="Date estimée"
                clearable
                className="filter-control modern-date-input"
              />
            </label>
          </div>
          <label className="field-stack">
            <span>Notes</span>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Observations, type de filtre, garage..." />
          </label>
          <label className="field-stack">
            <span>Date d'expiration récépissé</span>
            <StableDatePicker
              value={form.receiptExpiryDate ? new Date(form.receiptExpiryDate + 'T00:00:00') : null}
              onChange={(value) => setForm((c) => ({ ...c, receiptExpiryDate: value ? value.toISOString().slice(0, 10) : '' }))}
              placeholder="Date expiration récépissé"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer la vidange'}
          </button>
        </form>
      </section>

      {/* Historique */}
      <section className="panel panel-large delivery-table-panel">
        <SectionHeader
          title="Historique des vidanges"
          description={`${historyFiltered.length} vidange(s) enregistrée(s)`}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)} style={{ width: 180 }}>
                <option value="all">Tous les camions</option>
                {truckOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
              </select>
            </div>
          }
        />
        {loading ? <LoadingBanner message="Chargement…" /> : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Camion</th>
                  <th>Date</th>
                  <th>Kilométrage</th>
                  <th>Huile</th>
                  <th>Qté</th>
                  <th>Filtre</th>
                  <th>Récépissé</th>
                  <th>Prochaine échéance</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historyFiltered.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.truckLabel || '-'}</strong></td>
                    <td>{item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString('fr-FR') : '-'}</td>
                    <td>{item.odometerKm ? `${Number(item.odometerKm).toLocaleString('fr-FR')} km` : '-'}</td>
                    <td>{item.oilType || '-'}</td>
                    <td>{item.oilQuantityL ? `${item.oilQuantityL} L` : '-'}</td>
                    <td>{item.filterChanged ? <CheckCircle size={14} style={{ color: '#22c55e' }} /> : <AlertCircle size={14} style={{ color: '#64748b' }} />}</td>
                    <td>{item.receiptExpiryDate ? new Date(item.receiptExpiryDate + 'T00:00:00').toLocaleDateString('fr-FR') : '-'}</td>
                    <td>
                      {item.nextChangeKm ? `${Number(item.nextChangeKm).toLocaleString('fr-FR')} km` : ''}
                      {item.nextChangeKm && item.nextChangeDate ? ' / ' : ''}
                      {item.nextChangeDate ? new Date(item.nextChangeDate + 'T00:00:00').toLocaleDateString('fr-FR') : ''}
                      {!item.nextChangeKm && !item.nextChangeDate ? '-' : ''}
                    </td>
                    <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.notes}>
                      {item.notes || '-'}
                    </td>
                    <td>
                      <button type="button" className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label="Supprimer">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {historyFiltered.length === 0 && (
                  <tr><td colSpan={9} className="table-empty-cell">Aucune vidange enregistrée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageStack>
  )
}
