import { useEffect, useMemo, useState } from 'react'
import { Trash2, Gauge } from 'lucide-react'
import { EmptyBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { StableDatePicker } from '../components/StableDatePicker'
import { loadOilChanges, createOilChange, deleteOilChange, loadLiveOdometer } from '../lib/fleeti'

const OIL_TYPES = ['15W40', '20W50', '10W40', '5W30', '5W40', '0W20', 'Autre']

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
}

export function OilChangesPage({ enrichedTrackers = [] }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [liveOdometer, setLiveOdometer] = useState([])
  const [odometerLoading, setOdometerLoading] = useState(false)

  const reload = async () => {
    const payload = await loadOilChanges()
    setItems(payload.items ?? [])
  }

  const reloadOdometer = async () => {
    setOdometerLoading(true)
    try {
      const payload = await loadLiveOdometer()
      setLiveOdometer(payload?.items || [])
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

  const filtered = useMemo(() => items.filter((item) => {
    return trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
  }), [items, trackerFilter])

  // Fusionner kilométrage live avec les données de vidange
  const truckOdometerMap = useMemo(() => {
    const map = {}
    liveOdometer.forEach((entry) => {
      map[String(entry.trackerId)] = entry
    })
    return map
  }, [liveOdometer])

  // Calculer le kilométrage restant avant prochaine vidange
  const withOdometer = useMemo(() => {
    return enrichedTrackers.map((tracker) => {
      const live = truckOdometerMap[String(tracker.id)]
      const lastChange = items.find((item) => String(item.trackerId) === String(tracker.id))
      const liveOdo = live?.odometer ?? null
      const nextChangeKm = lastChange?.nextChangeKm || 0
      const remainingKm = liveOdo != null && nextChangeKm > 0 ? nextChangeKm - liveOdo : null
      const isUrgent = remainingKm != null && remainingKm <= 500
      const isWarning = remainingKm != null && remainingKm > 500 && remainingKm <= 2000
      return {
        tracker,
        live,
        lastChange,
        liveOdo,
        nextChangeKm: nextChangeKm || null,
        remainingKm,
        isUrgent,
        isWarning,
      }
    })
  }, [enrichedTrackers, truckOdometerMap, items])

  const onTruckChange = (value) => {
    const tracker = enrichedTrackers.find((item) => String(item.id) === String(value))
    // Pré-remplir le kilométrage depuis le live
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

  // Statistiques
  const urgentCount = withOdometer.filter((row) => row.isUrgent).length
  const warningCount = withOdometer.filter((row) => row.isWarning).length

  return (
    <PageStack className="ops-page-stack">
      <section className="panel panel-large delivery-hero-panel">
        <SectionHeader title="Suivi vidange" right={<div className="mission-hero-badge">Maintenance</div>} />
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card"><span>Total vidanges</span><strong>{items.length}</strong><small>enregistrées</small></div>
          <div className="mission-highlight-card"><span>Véhicules suivis</span><strong>{new Set(items.map((item) => item.trackerId)).size}</strong><small>avec historique</small></div>
          <div className="mission-highlight-card"><span>⚠️ Urgent</span><strong style={{ color: urgentCount > 0 ? '#ef4444' : undefined }}>{urgentCount}</strong><small>moins de 500 km</small></div>
          <div className="mission-highlight-card"><span>🟡 Attention</span><strong style={{ color: warningCount > 0 ? '#f59e0b' : undefined }}>{warningCount}</strong><small>500-2000 km</small></div>
        </div>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <SectionHeader
          title="Kilométrage live et échéances"
          description="Données temps réel Fleeti. La prochaine vidange est calculée depuis le dernier enregistrement."
          right={<button type="button" className="ghost-btn small-btn" onClick={reloadOdometer} disabled={odometerLoading}>{odometerLoading ? 'Actualisation…' : 'Actualiser'}</button>}
        />
        <div className="reports-table-wrap live-fuel-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Camion</th>
                <th>Kilométrage live</th>
                <th>Prochaine vidange</th>
                <th>Km restants</th>
                <th>Statut</th>
                <th>Dernière vidange</th>
              </tr>
            </thead>
            <tbody>
              {withOdometer.map((row) => (
                <tr key={`odo-${row.tracker.id}`}>
                  <td><strong>{row.tracker.label}</strong></td>
                  <td>{row.liveOdo != null ? `${Number(row.liveOdo).toLocaleString('fr-FR')} km` : 'N/A'}</td>
                  <td>{row.nextChangeKm ? `${Number(row.nextChangeKm).toLocaleString('fr-FR')} km` : '-'}</td>
                  <td style={{ color: row.isUrgent ? '#ef4444' : row.isWarning ? '#f59e0b' : undefined }}>
                    {row.remainingKm != null ? `${Number(row.remainingKm).toLocaleString('fr-FR')} km` : '-'}
                  </td>
                  <td>
                    {row.isUrgent ? <span className="status-badge badge-danger">⚠️ Vidange urgente</span>
                      : row.isWarning ? <span className="status-badge badge-warning">🟡 À prévoir</span>
                      : row.liveOdo != null ? <span className="status-badge badge-ok">✅ OK</span>
                      : <span className="status-badge">—</span>}
                  </td>
                  <td>{row.lastChange ? new Date(row.lastChange.date).toLocaleDateString('fr-FR') : 'Aucune'}</td>
                </tr>
              ))}
              {withOdometer.length === 0 && (
                <tr><td colSpan={6} className="table-empty-cell">Aucun véhicule trouvé.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-large delivery-form-panel">
        <SectionHeader title="Nouvelle vidange" />
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <label className="field-stack">
            <span>Camion</span>
            <select aria-label="Camion" value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required>
              <option value="">Sélection Camion</option>
              {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span>Date de la vidange</span>
            <StableDatePicker
              value={form.date ? new Date(form.date) : null}
              onChange={(value) => setForm((c) => ({ ...c, date: value ? value.toISOString().slice(0, 10) : '' }))}
              placeholder="Date de la vidange"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <label className="field-stack">
            <span>Kilométrage au moment de la vidange</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                step="1"
                min="0"
                value={form.odometerKm}
                onChange={(e) => setForm((c) => ({ ...c, odometerKm: e.target.value }))}
                placeholder="Kilométrage"
                required
                style={{ flex: 1 }}
              />
              {form.trackerId && truckOdometerMap[String(form.trackerId)]?.odometer != null && (
                <button type="button" className="ghost-btn small-btn" onClick={() => setForm((c) => ({ ...c, odometerKm: String(truckOdometerMap[String(form.trackerId)].odometer) }))} title="Utiliser le kilométrage live">
                  <Gauge size={14} /> Live
                </button>
              )}
            </div>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
          <label className="field-stack" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={form.filterChanged} onChange={(e) => setForm((c) => ({ ...c, filterChanged: e.target.checked }))} />
            <span>Filtre à huile changé</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label className="field-stack">
              <span>Prochaine vidange (km)</span>
              <input type="number" step="500" min="0" value={form.nextChangeKm} onChange={(e) => setForm((c) => ({ ...c, nextChangeKm: e.target.value }))} placeholder="ex: 150000" />
            </label>
            <label className="field-stack">
              <span>Prochaine vidange (date)</span>
              <StableDatePicker
                value={form.nextChangeDate ? new Date(form.nextChangeDate) : null}
                onChange={(value) => setForm((c) => ({ ...c, nextChangeDate: value ? value.toISOString().slice(0, 10) : '' }))}
                placeholder="Date estimée"
                clearable
                className="filter-control modern-date-input"
              />
            </label>
          </div>
          <label className="field-stack">
            <span>Notes</span>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Observations..." />
          </label>
          <button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer la vidange'}</button>
        </form>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <SectionHeader title="Historique des vidanges" />
        <div className="filters filter-row ops-filter-row">
          <label className="field-stack">
            <span>Camion</span>
            <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
              <option value="all">Tous les camions</option>
              {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
        </div>
        {loading ? <LoadingBanner message="Chargement…" /> : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Camion</th>
                  <th>Date</th>
                  <th>Kilométrage</th>
                  <th>Type d'huile</th>
                  <th>Qté (L)</th>
                  <th>Filtre</th>
                  <th>Prochaine (km)</th>
                  <th>Prochaine (date)</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.truckLabel || '-'}</strong></td>
                    <td>{item.date ? new Date(item.date).toLocaleDateString('fr-FR') : '-'}</td>
                    <td>{item.odometerKm ? `${Number(item.odometerKm).toLocaleString('fr-FR')} km` : '-'}</td>
                    <td>{item.oilType || '-'}</td>
                    <td>{item.oilQuantityL ? `${item.oilQuantityL} L` : '-'}</td>
                    <td>{item.filterChanged ? '✅' : '❌'}</td>
                    <td>{item.nextChangeKm ? `${Number(item.nextChangeKm).toLocaleString('fr-FR')} km` : '-'}</td>
                    <td>{item.nextChangeDate ? new Date(item.nextChangeDate).toLocaleDateString('fr-FR') : '-'}</td>
                    <td style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.notes}>{item.notes || '-'}</td>
                    <td>
                      <button type="button" className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label="Supprimer"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={10} className="table-empty-cell">Aucune vidange enregistrée.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageStack>
  )
}
