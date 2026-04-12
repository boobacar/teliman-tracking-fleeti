import { useEffect, useMemo, useState } from 'react'
import DatePicker from 'react-datepicker'
import { fr } from 'date-fns/locale'
import { Camera, Pencil, Trash2 } from 'lucide-react'
import 'react-datepicker/dist/react-datepicker.css'
import { createFuelVoucher, deleteFuelVoucher, loadFuelVouchers, loadLiveFuelLevels, loadMasterData, updateFuelVoucher } from '../lib/fleeti'

const initialForm = {
  trackerId: '',
  truckLabel: '',
  driver: '',
  voucherNumber: '',
  supplier: '',
  dateTime: '',
  quantityLiters: '',
  unitPrice: '',
}

function toNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error("Impossible de lire l'image"))
    reader.readAsDataURL(file)
  })
}

function exportCsv(rows) {
  const headers = ['Camion', 'Numéro bon', 'Date', 'Quantité (L)', 'Prix/L', 'Montant', 'Photo']
  const csvRows = rows.map((item) => [
    item.truckLabel || '',
    item.voucherNumber || '',
    item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR') : '',
    item.quantityLiters || 0,
    item.unitPrice || 0,
    item.amount || 0,
    item.proofPhotoDataUrl ? 'Oui' : 'Non',
  ])
  const csv = [headers, ...csvRows]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';'))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bons-carburant-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function FuelVouchersPage({ enrichedTrackers = [] }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(null)
  const [liveFuel, setLiveFuel] = useState([])
  const [liveFuelLoading, setLiveFuelLoading] = useState(false)

  const amount = useMemo(() => Number((toNumber(form.quantityLiters) * toNumber(form.unitPrice)).toFixed(2)), [form.quantityLiters, form.unitPrice])

  const reload = async () => {
    const payload = await loadFuelVouchers()
    setItems(payload.items ?? [])
  }

  const reloadLiveFuel = async () => {
    setLiveFuelLoading(true)
    try {
      const payload = await loadLiveFuelLevels()
      setLiveFuel(payload?.items || [])
    } finally {
      setLiveFuelLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoading(true)
      try {
        const [payload, masterData, liveFuelPayload] = await Promise.all([
          loadFuelVouchers(),
          loadMasterData(),
          loadLiveFuelLevels().catch(() => ({ items: [] })),
        ])
        if (!cancelled) {
          setItems(payload.items ?? [])
          setSuppliers(masterData?.suppliers || [])
          setLiveFuel(liveFuelPayload?.items || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => items.filter((item) => {
    const trackerOk = trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
    const selectedDateKey = dateFilter ? dateFilter.toISOString().slice(0, 10) : ''
    const dateOk = !selectedDateKey ? true : String(item.dateTime || '').slice(0, 10) === selectedDateKey
    return trackerOk && dateOk
  }), [items, trackerFilter, dateFilter])

  const onTruckChange = (value) => {
    const tracker = enrichedTrackers.find((item) => String(item.id) === String(value))
    setForm((current) => ({
      ...current,
      trackerId: value,
      truckLabel: tracker?.label || '',
      driver: tracker?.employeeName || '',
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createFuelVoucher({
        ...form,
        quantityLiters: toNumber(form.quantityLiters),
        unitPrice: toNumber(form.unitPrice),
      })
      await reload()
      setForm(initialForm)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    await deleteFuelVoucher(item.id)
    await reload()
  }

  const edit = async (item) => {
    const quantityLiters = window.prompt('Nouvelle quantité (L)', String(item.quantityLiters || ''))
    if (quantityLiters === null) return
    const unitPrice = window.prompt('Nouveau prix unitaire', String(item.unitPrice || ''))
    if (unitPrice === null) return
    await updateFuelVoucher(item.id, { quantityLiters: toNumber(quantityLiters), unitPrice: toNumber(unitPrice) })
    await reload()
  }

  const uploadPhoto = async (item, file) => {
    if (!file) return
    const proofPhotoDataUrl = await fileToDataUrl(file)
    await updateFuelVoucher(item.id, { proofPhotoDataUrl })
    await reload()
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large delivery-hero-panel">
        <div className="panel-header"><div><h3>Centre des bons carburant</h3></div><div className="mission-hero-badge">Fuel Ops</div></div>
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card"><span>Total bons</span><strong>{items.length}</strong><small>bons carburant enregistrés</small></div>
          <div className="mission-highlight-card"><span>Total litres</span><strong>{items.reduce((acc, item) => acc + (Number(item.quantityLiters) || 0), 0).toLocaleString('fr-FR')}</strong><small>volume cumulé</small></div>
          <div className="mission-highlight-card"><span>Montant total</span><strong>{items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0).toLocaleString('fr-FR')} FCFA</strong><small>historique</small></div>
        </div>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <div className="panel-header">
          <div>
            <h3>Niveau carburant live par camion</h3>
            <p>Lecture instantanée Fleeti depuis les capteurs CAN publiés.</p>
          </div>
          <button className="ghost-btn small-btn" onClick={reloadLiveFuel} disabled={liveFuelLoading}>{liveFuelLoading ? 'Actualisation…' : 'Actualiser'}</button>
        </div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Camion</th><th>Carburant live</th>{/* <th>Source</th> */}<th>Mise à jour</th><th>Statut</th></tr></thead>
            <tbody>
              {liveFuel.map((item) => (
                <tr key={`fuel-live-${item.assetId || item.trackerId}`}>
                  <td>{item.truckLabel || '-'}</td>
                  <td>{item.fuelLevel != null ? `${Number(item.fuelLevel).toLocaleString('fr-FR')} ${item.fuelUnits || 'L'}` : 'N/A'}</td>
                  {/* <td>{item.fuelInputName || '-'}</td> */}
                  <td>{item.fuelUpdatedAt ? new Date(item.fuelUpdatedAt).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}</td>
                  <td>{item.isOnline ? 'En ligne' : 'Hors ligne'}</td>
                </tr>
              ))}
              {liveFuel.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>{liveFuelLoading ? 'Chargement…' : 'Aucune donnée carburant live disponible.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-large delivery-form-panel">
        <div className="panel-header"><div><h3>Nouveau bon de carburant</h3></div></div>
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <input value={form.voucherNumber} onChange={(e) => setForm((c) => ({ ...c, voucherNumber: e.target.value }))} placeholder="Numéro bon" required />
          <label className="field-stack">
            <span>Date et heure</span>
            <DatePicker
              selected={form.dateTime ? new Date(form.dateTime) : null}
              onChange={(value) => setForm((c) => ({ ...c, dateTime: value ? value.toISOString() : '' }))}
              showTimeSelect
              timeIntervals={5}
              dateFormat="dd/MM/yyyy HH:mm"
              locale={fr}
              placeholderText="Choisir date et heure"
              className="filter-control modern-date-input"
              popperClassName="modern-date-popper"
              required
            />
          </label>
          <select value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required>
            <option value="">Sélection Camion</option>
            {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
          </select>
          <select value={form.supplier} onChange={(e) => setForm((c) => ({ ...c, supplier: e.target.value }))} required>
            <option value="">Fournisseur</option>
            {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
          <label className="field-stack"><span>Quantité (L)</span><input type="number" step="0.001" min="0" value={form.quantityLiters} onChange={(e) => setForm((c) => ({ ...c, quantityLiters: e.target.value }))} required /></label>
          <label className="field-stack"><span>Prix unitaire par litre</span><input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm((c) => ({ ...c, unitPrice: e.target.value }))} required /></label>
          <label className="field-stack"><span>Montant total</span><input value={Number.isFinite(amount) ? amount.toLocaleString('fr-FR') : '0'} readOnly /></label>
          <button className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer le bon'}</button>
        </form>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <div className="panel-header"><div><h3>Historique bons carburant</h3></div></div>
        <div className="filters filter-row" style={{ marginBottom: 12 }}>
          <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
            <option value="all">Tous les camions</option>
            {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
          </select>
          <DatePicker
            selected={dateFilter}
            onChange={(value) => setDateFilter(value)}
            dateFormat="dd/MM/yyyy"
            locale={fr}
            placeholderText="Filtrer par date"
            isClearable
            className="filter-control modern-date-input"
            popperClassName="modern-date-popper"
          />
          <button className="ghost-btn small-btn" onClick={() => exportCsv(filtered)}>Exporter CSV</button>
        </div>
        {loading ? <div className="info-banner">Chargement…</div> : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>Camion</th><th>Numéro bon</th><th>Date</th><th>Quantité (L)</th><th>Prix/L</th><th>Montant</th><th>Photo</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map((item) => {
                  const pickerId = `fuel-photo-${item.id}`
                  return (
                    <tr key={item.id}>
                      <td>{item.truckLabel || '-'}</td>
                      <td>{item.voucherNumber || '-'}</td>
                      <td>{item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                      <td>{Number(item.quantityLiters || 0).toLocaleString('fr-FR')}</td>
                      <td>{Number(item.unitPrice || 0).toLocaleString('fr-FR')}</td>
                      <td>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</td>
                      <td>
                        {item.proofPhotoDataUrl ? <a className="link-row" href={item.proofPhotoDataUrl} target="_blank" rel="noreferrer">Voir</a> : '-'}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="ghost-btn small-btn icon-btn" onClick={() => edit(item)} title="Modifier" aria-label="Modifier"><Pencil size={15} /></button>
                          <button className="ghost-btn small-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter photo" aria-label="Ajouter photo"><Camera size={15} /></button>
                          <input id={pickerId} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} />
                          <button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label="Supprimer"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun bon carburant enregistré.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="mobile-voucher-list">
          {filtered.map((item) => {
            const pickerId = `fuel-photo-mobile-${item.id}`
            return (
              <article key={`mobile-fuel-${item.id}`} className="mobile-voucher-card">
                <div className="mobile-voucher-head">
                  <strong>{item.voucherNumber || '-'}</strong>
                  <span>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</span>
                </div>
                <p><b>Camion:</b> {item.truckLabel || '-'}</p>
                <p><b>Date:</b> {item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                <p><b>Quantité:</b> {Number(item.quantityLiters || 0).toLocaleString('fr-FR')} L</p>
                <p><b>Prix/L:</b> {Number(item.unitPrice || 0).toLocaleString('fr-FR')}</p>
                <div className="table-actions">
                  <button className="ghost-btn small-btn icon-btn" onClick={() => edit(item)} title="Modifier" aria-label="Modifier"><Pencil size={15} /></button>
                  <button className="ghost-btn small-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter photo" aria-label="Ajouter photo"><Camera size={15} /></button>
                  <input id={pickerId} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} />
                  <button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label="Supprimer"><Trash2 size={15} /></button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
