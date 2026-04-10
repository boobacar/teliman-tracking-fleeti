import { useEffect, useMemo, useState } from 'react'
import { Camera, Pencil, Trash2 } from 'lucide-react'
import { createFuelVoucher, deleteFuelVoucher, loadFuelVouchers, updateFuelVoucher } from '../lib/fleeti'

const initialForm = {
  trackerId: '',
  truckLabel: '',
  driver: '',
  voucherNumber: '',
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
  const [loading, setLoading] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')

  const amount = useMemo(() => Number((toNumber(form.quantityLiters) * toNumber(form.unitPrice)).toFixed(2)), [form.quantityLiters, form.unitPrice])

  const reload = async () => {
    const payload = await loadFuelVouchers()
    setItems(payload.items ?? [])
  }

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      setLoading(true)
      try {
        const payload = await loadFuelVouchers()
        if (!cancelled) setItems(payload.items ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => items.filter((item) => {
    const trackerOk = trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
    const dateOk = !dateFilter ? true : String(item.dateTime || '').slice(0, 10) === dateFilter
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

      <section className="panel panel-large delivery-form-panel">
        <div className="panel-header"><div><h3>Nouveau bon de carburant</h3></div></div>
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <select value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required>
            <option value="">Sélection Camion</option>
            {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
          </select>
          <input value={form.voucherNumber} onChange={(e) => setForm((c) => ({ ...c, voucherNumber: e.target.value }))} placeholder="Numéro bon" required />
          <label className="field-stack"><span>Date et heure</span><input type="datetime-local" value={form.dateTime} onChange={(e) => setForm((c) => ({ ...c, dateTime: e.target.value }))} required /></label>
          <input type="number" step="0.001" min="0" value={form.quantityLiters} onChange={(e) => setForm((c) => ({ ...c, quantityLiters: e.target.value }))} placeholder="Quantité (L)" required />
          <input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm((c) => ({ ...c, unitPrice: e.target.value }))} placeholder="Prix unitaire par litre" required />
          <input value={Number.isFinite(amount) ? amount.toLocaleString('fr-FR') : '0'} readOnly placeholder="Montant" />
          <button className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer le bon'}</button>
        </form>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <div className="panel-header"><div><h3>Historique bons carburant</h3></div></div>
        <div className="filters filter-row" style={{ marginBottom: 12 }}>
          <select value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
            <option value="all">Tous les camions</option>
            {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
          </select>
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
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
                          <input id={pickerId} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} />
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
      </section>
    </div>
  )
}
