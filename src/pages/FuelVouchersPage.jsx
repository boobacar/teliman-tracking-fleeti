import { useEffect, useMemo, useState } from 'react'
import { createFuelVoucher, loadFuelVouchers } from '../lib/fleeti'

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

export function FuelVouchersPage({ enrichedTrackers = [] }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const amount = useMemo(() => Number((toNumber(form.quantityLiters) * toNumber(form.unitPrice)).toFixed(2)), [form.quantityLiters, form.unitPrice])

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
      const payload = await loadFuelVouchers()
      setItems(payload.items ?? [])
      setForm(initialForm)
    } finally {
      setSaving(false)
    }
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
        {loading ? <div className="info-banner">Chargement…</div> : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>Camion</th><th>Numéro bon</th><th>Date</th><th>Quantité (L)</th><th>Prix/L</th><th>Montant</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.truckLabel || '-'}</td>
                    <td>{item.voucherNumber || '-'}</td>
                    <td>{item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    <td>{Number(item.quantityLiters || 0).toLocaleString('fr-FR')}</td>
                    <td>{Number(item.unitPrice || 0).toLocaleString('fr-FR')}</td>
                    <td>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun bon carburant enregistré.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
