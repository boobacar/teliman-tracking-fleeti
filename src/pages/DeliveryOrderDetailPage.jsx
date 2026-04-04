import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteDeliveryOrder, updateDeliveryOrder } from '../lib/fleeti'

export function DeliveryOrderDetailPage({ deliveryOrders, refreshData }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const order = useMemo(() => deliveryOrders.find((item) => String(item.id) === String(id)), [deliveryOrders, id])
  const [saving, setSaving] = useState(false)

  if (!order) {
    return <section className="panel"><div className="panel-header"><div><h3>Bon de livraison</h3><p>Bon introuvable</p></div></div></section>
  }

  const updateField = async (field, value) => {
    setSaving(true)
    try {
      await updateDeliveryOrder(order.id, { [field]: value })
      await refreshData()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await deleteDeliveryOrder(order.id)
      await refreshData()
      navigate('/delivery-orders')
    } finally {
      setSaving(false)
    }
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Détail du bon {order.reference}</h3><p>{order.truckLabel} — {order.driver}</p></div><button className="ghost-btn small-btn" onClick={() => navigate('/delivery-orders')}><ArrowLeft size={16} /> Retour</button></div>
      <div className="tracker-overview-grid">
        <div className="overview-card"><span>Client</span><strong>{order.client}</strong></div>
        <div className="overview-card"><span>Destination</span><strong>{order.destination}</strong></div>
        <div className="overview-card"><span>Marchandise</span><strong>{order.goods || '-'}</strong></div>
        <div className="overview-card"><span>Quantité</span><strong>{order.quantity || '-'}</strong></div>
        <div className="overview-card"><span>Statut</span><strong>{order.active ? 'Actif' : order.status}</strong></div>
        <div className="overview-card"><span>Date</span><strong>{order.date ? new Date(order.date).toLocaleString() : '-'}</strong></div>
        <div className="overview-card"><span>Fin mission</span><strong>{order.completedAt ? new Date(order.completedAt).toLocaleString() : '-'}</strong></div>
      </div>
    </section>

    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel">
        <div className="panel-header"><div><h3>Mise à jour rapide</h3><p>Faire évoluer la mission</p></div></div>
        <div className="delivery-form">
          <select defaultValue={order.status} onChange={(e) => updateField('status', e.target.value)} disabled={saving}>
            <option>Prévu</option>
            <option>En chargement</option>
            <option>En cours</option>
            <option>Livré</option>
          </select>
          <label className="toggle-row"><input type="checkbox" checked={!!order.active} onChange={(e) => updateField('active', e.target.checked)} disabled={saving} />Bon actif</label>
          <button className="ghost-btn danger-btn" onClick={remove} disabled={saving}>Supprimer le bon</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3>Notes mission</h3><p>Informations complémentaires</p></div></div>
        <textarea className="delivery-notes-box" value={order.notes || ''} onChange={(e) => updateField('notes', e.target.value)} rows={8} disabled={saving} />
      </section>
    </section>
  </div>
}
