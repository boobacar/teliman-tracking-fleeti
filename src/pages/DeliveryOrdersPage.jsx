import { useMemo, useState } from 'react'
import { createDeliveryOrder } from '../lib/fleeti'

const initialForm = {
  trackerId: '',
  truckLabel: '',
  driver: '',
  reference: '',
  client: '',
  loadingPoint: '',
  destination: '',
  goods: '',
  quantity: '',
  status: 'Prévu',
  date: '',
  notes: '',
}

export function DeliveryOrdersPage({ deliveryOrders, enrichedTrackers, refreshData }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)

  const trackerOptions = useMemo(() => enrichedTrackers.map((tracker) => ({
    id: tracker.id,
    label: tracker.label,
    driver: tracker.employeeName,
  })), [enrichedTrackers])

  const handleTrackerChange = (trackerId) => {
    const selected = trackerOptions.find((item) => String(item.id) === String(trackerId))
    setForm((current) => ({
      ...current,
      trackerId,
      truckLabel: selected?.label || '',
      driver: selected?.driver || '',
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createDeliveryOrder(form)
      setForm(initialForm)
      await refreshData()
    } finally {
      setSaving(false)
    }
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Nouveau bon de livraison</h3><p>Affecter une mission à un camion précis</p></div></div>
        <form className="delivery-form" onSubmit={submit}>
          <select value={form.trackerId} onChange={(e) => handleTrackerChange(e.target.value)} required>
            <option value="">Sélectionner un camion</option>
            {trackerOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label} — {tracker.driver}</option>)}
          </select>
          <input placeholder="Référence BL" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required />
          <input placeholder="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required />
          <input placeholder="Point de chargement" value={form.loadingPoint} onChange={(e) => setForm({ ...form, loadingPoint: e.target.value })} />
          <input placeholder="Destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} required />
          <input placeholder="Marchandise" value={form.goods} onChange={(e) => setForm({ ...form, goods: e.target.value })} />
          <input placeholder="Quantité / tonnage" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>Prévu</option>
            <option>En chargement</option>
            <option>En cours</option>
            <option>Livré</option>
          </select>
          <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} />
          <button className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer le bon'}</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3>Historique rapide</h3><p>Derniers bons enregistrés</p></div></div>
        <div className="driver-ranking">{deliveryOrders.slice(0, 6).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference || '#'}</strong><div><span>{item.truckLabel}</span><small>{item.client}</small></div><div><span>{item.status}</span><small>{item.destination}</small></div></div>)}</div>
      </section>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Historique des bons de livraison</h3><p>Tous les bons créés dans la plateforme</p></div></div>
      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Référence</th>
              <th>Camion</th>
              <th>Chauffeur</th>
              <th>Client</th>
              <th>Destination</th>
              <th>Marchandise</th>
              <th>Quantité</th>
              <th>Statut</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {deliveryOrders.map((item) => <tr key={item.id}><td>{item.reference}</td><td>{item.truckLabel}</td><td>{item.driver}</td><td>{item.client}</td><td>{item.destination}</td><td>{item.goods}</td><td>{item.quantity}</td><td>{item.status}</td><td>{item.date ? new Date(item.date).toLocaleString() : '-'}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div>
}
