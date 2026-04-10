import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DatePicker from 'react-datepicker'
import { fr } from 'date-fns/locale'
import { Camera, Trash2 } from 'lucide-react'
import 'react-datepicker/dist/react-datepicker.css'
import { createDeliveryOrder, deleteDeliveryOrder, loadDeliveryOrders, loadDeliveryOrdersSummary, loadMasterData, updateDeliveryOrder } from '../lib/fleeti'

function formatFrenchQuantity(value, digits = 3) {
  const normalized = Number(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(normalized)) return value || '-'
  return normalized.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error("Impossible de lire l'image"))
    reader.readAsDataURL(file)
  })
}

function exportDeliveryOrdersCsv(rows = []) {
  const headers = ['Référence', 'Camion', 'Chauffeur', 'Client', 'Destination', 'Marchandise', 'Quantité', 'Statut', 'Départ', 'Arrivée', 'Date', 'Photo']
  const csvRows = rows.map((item) => [
    item.reference || '',
    item.truckLabel || '',
    item.driver || '',
    item.client || '',
    item.destination || '',
    item.goods || '',
    item.quantity || '',
    item.active ? 'Actif' : (item.status || ''),
    item.departureDateTime ? new Date(item.departureDateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    item.arrivalDateTime ? new Date(item.arrivalDateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    item.date ? new Date(item.date).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    item.proofPhotoDataUrl ? 'Oui' : 'Non',
  ])

  const csv = [headers, ...csvRows]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';'))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `bons-livraison-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

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
  departureDateTime: '',
  arrivalDateTime: '',
  active: true,
}

export function DeliveryOrdersPage({ deliveryOrders, deliveryOrdersSummary, enrichedTrackers, refreshData, setDeliveryOrders, setDeliveryOrdersSummary, masterData = { clients: [], goods: [], destinations: [] }, setMasterData }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(null)
  const [pageLoading, setPageLoading] = useState(false)

  const trackerOptions = useMemo(() => enrichedTrackers.map((tracker) => ({
    id: tracker.id,
    label: tracker.label,
    driver: tracker.employeeName,
  })), [enrichedTrackers])

  useEffect(() => {
    let cancelled = false

    async function loadPageData() {
      if (!setDeliveryOrders || !setDeliveryOrdersSummary || !setMasterData) return
      setPageLoading(true)
      try {
        const [ordersPayload, ordersSummaryPayload, masterDataPayload] = await Promise.all([
          loadDeliveryOrders(),
          loadDeliveryOrdersSummary(),
          loadMasterData(),
        ])
        if (cancelled) return
        setDeliveryOrders(ordersPayload.items ?? [])
        setDeliveryOrdersSummary(ordersSummaryPayload)
        setMasterData(masterDataPayload)
      } finally {
        if (!cancelled) setPageLoading(false)
      }
    }

    loadPageData()
    return () => {
      cancelled = true
    }
  }, [setDeliveryOrders, setDeliveryOrdersSummary, setMasterData])

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
      if (setDeliveryOrders && setDeliveryOrdersSummary && setMasterData) {
        const [ordersPayload, ordersSummaryPayload, masterDataPayload] = await Promise.all([
          loadDeliveryOrders(),
          loadDeliveryOrdersSummary(),
          loadMasterData(),
        ])
        setDeliveryOrders(ordersPayload.items ?? [])
        setDeliveryOrdersSummary(ordersSummaryPayload)
        setMasterData(masterDataPayload)
      } else {
        await refreshData()
      }
    } finally {
      setSaving(false)
    }
  }

  const markDelivered = async (item) => {
    await updateDeliveryOrder(item.id, { status: 'Livré', active: false })
    if (setDeliveryOrders && setDeliveryOrdersSummary) {
      const [ordersPayload, ordersSummaryPayload] = await Promise.all([
        loadDeliveryOrders(),
        loadDeliveryOrdersSummary(),
      ])
      setDeliveryOrders(ordersPayload.items ?? [])
      setDeliveryOrdersSummary(ordersSummaryPayload)
    } else {
      await refreshData()
    }
  }

  const removeOrder = async (item) => {
    await deleteDeliveryOrder(item.id)
    if (setDeliveryOrders && setDeliveryOrdersSummary) {
      const [ordersPayload, ordersSummaryPayload] = await Promise.all([
        loadDeliveryOrders(),
        loadDeliveryOrdersSummary(),
      ])
      setDeliveryOrders(ordersPayload.items ?? [])
      setDeliveryOrdersSummary(ordersSummaryPayload)
    } else {
      await refreshData()
    }
  }

  const uploadProofPhoto = async (item, file) => {
    if (!file) return
    setSaving(true)
    try {
      const proofPhotoDataUrl = await fileToDataUrl(file)
      await updateDeliveryOrder(item.id, {
        proofPhotoDataUrl,
        proofStatus: item.proofStatus === 'En attente' ? 'Reçue' : (item.proofStatus || 'Reçue'),
      })
      if (setDeliveryOrders && setDeliveryOrdersSummary) {
        const [ordersPayload, ordersSummaryPayload] = await Promise.all([
          loadDeliveryOrders(),
          loadDeliveryOrdersSummary(),
        ])
        setDeliveryOrders(ordersPayload.items ?? [])
        setDeliveryOrdersSummary(ordersSummaryPayload)
      } else {
        await refreshData()
      }
    } finally {
      setSaving(false)
    }
  }

  const filteredOrders = deliveryOrders.filter((item) => {
    const statusOk = statusFilter === 'all' ? true : statusFilter === 'active' ? item.active : item.status === statusFilter
    const trackerOk = trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
    const clientOk = clientFilter === 'all' ? true : item.client === clientFilter
    const itemDate = String(item.date || '').slice(0, 10)
    const selectedDateKey = dateFilter ? dateFilter.toISOString().slice(0, 10) : ''
    const dateOk = !selectedDateKey ? true : itemDate === selectedDateKey
    return statusOk && trackerOk && clientOk && dateOk
  })

  const groupedByTracker = enrichedTrackers
    .map((tracker) => ({ tracker, orders: deliveryOrders.filter((item) => Number(item.trackerId) === Number(tracker.id)) }))
    .filter((group) => group.orders.length > 0)

  const missionStats = {
    total: deliveryOrdersSummary?.total || 0,
    active: deliveryOrders.filter((item) => item.active).length,
    delivered: deliveryOrders.filter((item) => item.status === 'Livré').length,
    planned: deliveryOrders.filter((item) => item.status === 'Prévu').length,
  }

  const topTruckOrders = Object.entries(deliveryOrdersSummary?.byTruck || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const topClients = Object.entries(deliveryOrders.reduce((acc, item) => {
    acc[item.client] = (acc[item.client] || 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const pendingProofs = deliveryOrders.filter((item) => item.proofStatus === 'En attente').slice(0, 3)

  return <div style={{ display: 'grid', gap: 20 }}>
    {pageLoading && <div className="info-banner">Chargement des bons de livraison…</div>}
    <section className="panel panel-large delivery-hero-panel">
      <div className="panel-header"><div><h3>Centre de missions & bons de livraison</h3></div><div className="mission-hero-badge">BL Ops</div></div>
      <div className="mission-highlight-grid">
        <div className="mission-highlight-card"><span>Total bons</span><strong>{missionStats.total}</strong><small>missions enregistrées</small></div>
        <div className="mission-highlight-card"><span>Actifs</span><strong>{missionStats.active}</strong><small>en cours</small></div>
        <div className="mission-highlight-card"><span>Livrés</span><strong>{missionStats.delivered}</strong><small>terminés</small></div>
      </div>
    </section>

    <section className="panel sticky-subnav-panel delivery-subnav">
      <div className="filters">
        <a className="chip selected" href="#bl-form">Nouveau bon</a>
        <a className="chip" href="#bl-table">Historique</a>
        <a className="chip" href="#bl-insights">Insights</a>
        <a className="chip" href="#bl-trucks">Par camion</a>
      </div>
    </section>

    <section id="bl-form" className="dashboard-grid premium-grid phase2-grid">
      <section className="panel panel-large delivery-form-panel">
        <div className="panel-header"><div><h3>Nouveau bon de livraison</h3></div></div>
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <select value={form.trackerId} onChange={(e) => handleTrackerChange(e.target.value)} required>
            <option value="">Sélectionner un camion</option>
            {trackerOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label} — {tracker.driver}</option>)}
          </select>
          <input placeholder="Référence BL" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required />
          <select value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required>
            <option value="">Sélectionner un client</option>
            {(masterData.clients || []).map((client) => <option key={client} value={client}>{client}</option>)}
          </select>
          <select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} required>
            <option value="">Sélectionner une destination</option>
            {(masterData.destinations || []).map((destination) => <option key={destination} value={destination}>{destination}</option>)}
          </select>
          <select value={form.goods} onChange={(e) => setForm({ ...form, goods: e.target.value })}>
            <option value="">Sélectionner une marchandise</option>
            {(masterData.goods || []).map((goods) => <option key={goods} value={goods}>{goods}</option>)}
          </select>
          <input placeholder="Quantité / tonnage" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <label className="field-stack"><span>Départ</span><input type="datetime-local" value={form.departureDateTime} onChange={(e) => setForm({ ...form, departureDateTime: e.target.value })} /></label>
          <label className="field-stack"><span>Arrivée</span><input type="datetime-local" value={form.arrivalDateTime} onChange={(e) => setForm({ ...form, arrivalDateTime: e.target.value })} /></label>
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

      <section className="panel compact-side-panel">
        <div className="panel-header"><div><h3>Missions prioritaires</h3></div></div>
        <div className="driver-ranking">{deliveryOrders.slice(0, 5).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference || '#'}</strong><div><span>{item.truckLabel}</span><small>{item.client}</small></div><div><span>{item.active ? 'Actif' : item.status}</span><small>{item.destination}</small></div></div>)}</div>
      </section>
    </section>

    <section id="bl-table" className="panel panel-large delivery-table-panel">
      <div className="panel-header"><div><h3>Historique des bons</h3></div></div>
      <div className="filters filter-row">
        <button className={`chip ${statusFilter === 'all' ? 'selected' : ''}`} onClick={() => setStatusFilter('all')}>Tous</button>
        <button className={`chip ${statusFilter === 'active' ? 'selected' : ''}`} onClick={() => setStatusFilter('active')}>Actifs</button>
        <button className={`chip ${statusFilter === 'Prévu' ? 'selected' : ''}`} onClick={() => setStatusFilter('Prévu')}>Prévu</button>
        <button className={`chip ${statusFilter === 'En cours' ? 'selected' : ''}`} onClick={() => setStatusFilter('En cours')}>En cours</button>
        <button className={`chip ${statusFilter === 'Livré' ? 'selected' : ''}`} onClick={() => setStatusFilter('Livré')}>Livré</button>
      </div>
      <div className="filters filter-row">
        <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
          <option value="all">Tous les camions</option>
          {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
        </select>
        <select className="filter-control" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="all">Tous les clients</option>
          {[...new Set(deliveryOrders.map((item) => item.client).filter(Boolean))].map((client) => <option key={client} value={client}>{client}</option>)}
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
        <button className="ghost-btn small-btn" onClick={() => { setStatusFilter('all'); setTrackerFilter('all'); setClientFilter('all'); setDateFilter(null) }}>Réinitialiser filtres</button>
        <button className="ghost-btn small-btn" onClick={() => exportDeliveryOrdersCsv(filteredOrders)}>Exporter CSV</button>
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
              <th>Départ</th>
              <th>Arrivée</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((item) => {
              const statusLabel = item.active ? 'Actif' : item.status
              const statusClass = item.active ? 'status-live' : item.status === 'Livré' ? 'status-success' : item.status === 'En cours' || item.status === 'En chargement' ? 'status-warn' : 'status-neutral'
              const pickerId = `proof-photo-${item.id}`
              return (
                <tr key={item.id} className={item.active ? 'active-order-row clickable-row' : 'clickable-row'} onClick={() => window.location.assign(`/delivery-order/${item.id}`)}>
                  <td><Link className={`link-row order-ref ${item.active ? 'active-ref' : ''}`} to={`/delivery-order/${item.id}`} onClick={(e) => e.stopPropagation()}>{item.reference}</Link></td>
                  <td><Link className="link-row" to={`/tracker/${item.trackerId}`} onClick={(e) => e.stopPropagation()}>{item.truckLabel}</Link></td>
                  <td>{item.driver}</td>
                  <td>{item.client}</td>
                  <td>{item.destination}</td>
                  <td>{item.goods}</td>
                  <td>{formatFrenchQuantity(item.quantity)}</td>
                  <td><span className={`status-chip ${statusClass}`}>{statusLabel}</span></td>
                  <td>{item.departureDateTime ? new Date(item.departureDateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td>{item.arrivalDateTime ? new Date(item.arrivalDateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td>{item.date ? new Date(item.date).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                  <td>
                    <div className="table-actions">
                      <button className="ghost-btn small-btn icon-btn" title="Marquer livré" aria-label="Marquer livré" onClick={(e) => { e.stopPropagation(); markDelivered(item) }}>
                        ✅
                      </button>
                      <button
                        className="ghost-btn small-btn icon-btn"
                        title="Ajouter une photo"
                        aria-label="Ajouter une photo"
                        onClick={(e) => {
                          e.stopPropagation()
                          const input = document.getElementById(pickerId)
                          input?.click()
                        }}
                      >
                        <Camera size={15} />
                      </button>
                      <input
                        id={pickerId}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation()
                          const file = e.target.files?.[0]
                          await uploadProofPhoto(item, file)
                          e.target.value = ''
                        }}
                      />
                      <button className="ghost-btn small-btn danger-btn icon-btn" onClick={(e) => { e.stopPropagation(); removeOrder(item) }} aria-label="Supprimer"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section id="bl-insights" className="dashboard-grid premium-grid phase2-grid">
      <section className="panel">
        <div className="panel-header"><div><h3>Insights opérationnels</h3></div></div>
        <div className="driver-ranking"><div className="driver-rank-row static-row"><strong>{missionStats.planned}</strong><div><span>Prévu</span><small>à lancer</small></div></div><div className="driver-rank-row static-row"><strong>{deliveryOrdersSummary?.active || 0}</strong><div><span>Actifs</span><small>suivi terrain</small></div></div><div className="driver-rank-row static-row"><strong>{deliveryOrdersSummary?.delivered || 0}</strong><div><span>Livrés</span><small>clôturés</small></div></div></div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h3>Top clients & preuves</h3></div></div>
        <div className="driver-ranking">{topClients.map(([client, count], index) => <div key={client} className="driver-rank-row static-row"><strong>#{index + 1}</strong><div><span>{client}</span><small>fréquence</small></div><div><span>{count}</span><small>bons</small></div></div>)}{pendingProofs.map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference}</strong><div><span>{item.truckLabel}</span><small>{item.client}</small></div><div><span>{item.proofStatus || 'En attente'}</span><small>{item.destination}</small></div></div>)}</div>
      </section>
    </section>

    <section id="bl-trucks" className="panel panel-large delivery-history-panel">
      <div className="panel-header"><div><h3>Historique par camion</h3></div></div>
      <div className="driver-ranking">{groupedByTracker.map((group) => <div key={group.tracker.id} className="tracker-history-card"><div className="panel-header"><div><h3 style={{ fontSize: 18 }}>{group.tracker.label}</h3><p>{group.tracker.employeeName}</p></div><Link className="ghost-btn small-btn" to={`/tracker/${group.tracker.id}`}>Voir tracker</Link></div><div className="driver-ranking">{group.orders.slice(0, 4).map((item) => <div key={item.id} className="driver-rank-row static-row"><strong>{item.reference}</strong><div><span>{item.client}</span><small>{item.destination}</small></div><div><span>{item.active ? 'Actif' : item.status}</span><small>{item.date ? new Date(item.date).toLocaleDateString() : '-'}</small></div></div>)}</div></div>)}</div>
    </section>
  </div>
}
