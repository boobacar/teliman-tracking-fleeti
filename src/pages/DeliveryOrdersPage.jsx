import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { createDeliveryOrder, deleteDeliveryOrder, updateDeliveryOrder } from '../lib/fleeti'

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
  active: true,
}

export function DeliveryOrdersPage({ deliveryOrders, deliveryOrdersSummary, enrichedTrackers, refreshData }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [trackerFilter, setTrackerFilter] = useState('all')

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

  const markDelivered = async (item) => {
    await updateDeliveryOrder(item.id, { status: 'Livré', active: false })
    await refreshData()
  }

  const setActive = async (item) => {
    await updateDeliveryOrder(item.id, { active: true, status: item.status === 'Livré' ? 'En cours' : item.status })
    await refreshData()
  }

  const removeOrder = async (item) => {
    await deleteDeliveryOrder(item.id)
    await refreshData()
  }

  const filteredOrders = deliveryOrders.filter((item) => {
    const statusOk = statusFilter === 'all' ? true : statusFilter === 'active' ? item.active : item.status === statusFilter
    const trackerOk = trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
    return statusOk && trackerOk
  })

  const groupedByTracker = enrichedTrackers
    .map((tracker) => ({ tracker, orders: deliveryOrders.filter((item) => Number(item.trackerId) === Number(tracker.id)) }))
    .filter((group) => group.orders.length > 0)

  const missionStats = {
    active: deliveryOrders.filter((item) => item.active).length,
    delivered: deliveryOrders.filter((item) => item.status === 'Livré').length,
    planned: deliveryOrders.filter((item) => item.status === 'Prévu').length,
    loading: deliveryOrders.filter((item) => item.status === 'En chargement').length,
  }
  const topTruckOrders = Object.entries(deliveryOrdersSummary?.byTruck || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="stats-grid premium-stats phase2-stats">
      <div className="stat-card"><div><span>Bons actifs</span><strong>{missionStats.active}</strong><small>missions en cours</small></div></div>
      <div className="stat-card"><div><span>Livrés</span><strong>{missionStats.delivered}</strong><small>terminés</small></div></div>
      <div className="stat-card"><div><span>Prévu</span><strong>{missionStats.planned}</strong><small>à lancer</small></div></div>
      <div className="stat-card"><div><span>En chargement</span><strong>{missionStats.loading}</strong><small>préparation</small></div></div>
    </section>

    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel">
        <div className="panel-header"><div><h3>Résumé module BL</h3><p>Vue consolidée des missions</p></div></div>
        <div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{deliveryOrdersSummary?.total || 0}</strong><div><span>Total bons</span><small>enregistrés</small></div></div><div className="driver-rank-row static-row"><strong>{deliveryOrdersSummary?.active || 0}</strong><div><span>Bons actifs</span><small>en cours</small></div></div><div className="driver-rank-row static-row"><strong>{deliveryOrdersSummary?.delivered || 0}</strong><div><span>Livrés</span><small>terminés</small></div></div></div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h3>Camions les plus chargés</h3><p>Ceux avec le plus de bons</p></div></div>
        <div className="driver-ranking">{topTruckOrders.map(([truck, count], index) => <div key={truck} className="driver-rank-row static-row"><strong>#{index + 1}</strong><div><span>{truck}</span><small>bons enregistrés</small></div><div><span>{count}</span><small>missions</small></div></div>)}</div>
      </section>
    </section>
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
          <label className="toggle-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Bon actif</label>
          <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} />
          <button className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer le bon'}</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3>Historique rapide</h3><p>Derniers bons enregistrés</p></div></div>
        <div className="driver-ranking">{deliveryOrders.slice(0, 6).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference || '#'}</strong><div><span>{item.truckLabel}</span><small>{item.client}</small></div><div><span>{item.active ? 'Actif' : item.status}</span><small>{item.destination}</small></div></div>)}</div>
      </section>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Historique des bons de livraison</h3><p>Tous les bons créés dans la plateforme</p></div></div>
      <div className="filters filter-row">
        <button className={`chip ${statusFilter === 'all' ? 'selected' : ''}`} onClick={() => setStatusFilter('all')}>Tous</button>
        <button className={`chip ${statusFilter === 'active' ? 'selected' : ''}`} onClick={() => setStatusFilter('active')}>Actifs</button>
        <button className={`chip ${statusFilter === 'Prévu' ? 'selected' : ''}`} onClick={() => setStatusFilter('Prévu')}>Prévu</button>
        <button className={`chip ${statusFilter === 'En cours' ? 'selected' : ''}`} onClick={() => setStatusFilter('En cours')}>En cours</button>
        <button className={`chip ${statusFilter === 'Livré' ? 'selected' : ''}`} onClick={() => setStatusFilter('Livré')}>Livré</button>
      </div>
      <div className="filters filter-row">
        <select value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
          <option value="all">Tous les camions</option>
          {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
        </select>
      </div>
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((item) => { const statusLabel = item.active ? 'Actif' : item.status; const statusClass = item.active ? 'status-live' : item.status === 'Livré' ? 'status-success' : item.status === 'En cours' || item.status === 'En chargement' ? 'status-warn' : 'status-neutral'; return <tr key={item.id} className={item.active ? 'active-order-row' : ''}><td><Link className={`link-row order-ref ${item.active ? 'active-ref' : ''}`} to={`/delivery-order/${item.id}`}>{item.reference}</Link></td><td><Link className="link-row" to={`/tracker/${item.trackerId}`}>{item.truckLabel}</Link></td><td>{item.driver}</td><td>{item.client}</td><td>{item.destination}</td><td>{item.goods}</td><td>{item.quantity}</td><td><span className={`status-chip ${statusClass}`}>{statusLabel}</span></td><td>{item.date ? new Date(item.date).toLocaleString() : '-'}</td><td><div className="table-actions"><button className="ghost-btn small-btn" onClick={() => setActive(item)}>Activer</button><button className="ghost-btn small-btn" onClick={() => markDelivered(item)}>Livré</button><button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => removeOrder(item)} aria-label="Supprimer"><Trash2 size={16} /></button></div></td></tr>})}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Historique par camion</h3><p>Lecture camion par camion</p></div></div>
      <div className="driver-ranking">{groupedByTracker.map((group) => <div key={group.tracker.id} className="tracker-history-card"><div className="panel-header"><div><h3 style={{ fontSize: 18 }}>{group.tracker.label}</h3><p>{group.tracker.employeeName}</p></div><Link className="ghost-btn small-btn" to={`/tracker/${group.tracker.id}`}>Voir tracker</Link></div><div className="driver-ranking">{group.orders.slice(0, 4).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference}</strong><div><span>{item.client}</span><small>{item.destination}</small></div><div><span>{item.active ? 'Actif' : item.status}</span><small>{item.date ? new Date(item.date).toLocaleDateString() : '-'}</small></div></div>)}</div></div>)}</div>
    </section>
  </div>
}
