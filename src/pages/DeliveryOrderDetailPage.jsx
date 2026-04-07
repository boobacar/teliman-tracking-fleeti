import { useMemo, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteDeliveryOrder, updateDeliveryOrder } from '../lib/fleeti'
import { printDeliveryOrder } from '../lib/printDeliveryOrder'

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

  const updateMany = async (payload) => {
    setSaving(true)
    try {
      await updateDeliveryOrder(order.id, payload)
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
    <section className="panel panel-large mission-hero-card">
      <div className="panel-header"><div><h3>Détail du bon {order.reference}</h3><p>{order.truckLabel} — {order.driver}</p></div><div className="table-actions"><button className="ghost-btn small-btn" onClick={() => printDeliveryOrder(order)}><Printer size={16} /> Imprimer</button><button className="ghost-btn small-btn" onClick={() => navigate('/delivery-orders')}><ArrowLeft size={16} /> Retour</button></div></div>
      <div className="mission-highlight-grid compact-mission-grid"><div className="mission-highlight-card"><span>Client</span><strong>{order.client}</strong><small>{order.reference}</small></div><div className="mission-highlight-card"><span>Destination</span><strong>{order.destination}</strong><small>{order.goods || '-'}</small></div><div className="mission-highlight-card"><span>Statut</span><strong>{order.active ? 'Actif' : order.status}</strong><small>{order.quantity || '-'}</small></div></div>
    </section>

    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel compact-side-panel">
        <div className="panel-header"><div><h3>Pilotage mission</h3><p>Statut, activité, POD</p></div></div>
        <div className="delivery-form compact-pilot-form">
          <select value={order.status} onChange={(e) => updateMany({ status: e.target.value, active: e.target.value !== 'Livré' && e.target.value !== 'Annulé', completedAt: e.target.value === 'Livré' ? new Date().toISOString() : null })} disabled={saving}>
            <option>Prévu</option>
            <option>Validé</option>
            <option>En chargement</option>
            <option>En route</option>
            <option>Arrivé site</option>
            <option>Déchargement</option>
            <option>En cours</option>
            <option>Livré</option>
            <option>Annulé</option>
          </select>
          <label className="toggle-row"><input type="checkbox" checked={!!order.active} onChange={(e) => updateField('active', e.target.checked)} disabled={saving} />Bon actif</label>
          <select value={order.proofStatus || 'En attente'} onChange={(e) => updateField('proofStatus', e.target.value)} disabled={saving}>
            <option>En attente</option>
            <option>Reçue</option>
            <option>Validée</option>
          </select>
          <button className="ghost-btn danger-btn" onClick={remove} disabled={saving}>Supprimer le bon</button>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Informations mission</h3><p>Édition essentielle</p></div></div>
        <div className="delivery-form delivery-form-premium compact-detail-form">
          <input value={order.reference || ''} onChange={(e) => updateField('reference', e.target.value)} disabled={saving} placeholder="Référence" />
          <input value={order.client || ''} onChange={(e) => updateField('client', e.target.value)} disabled={saving} placeholder="Client" />
          <input value={order.loadingPoint || ''} onChange={(e) => updateField('loadingPoint', e.target.value)} disabled={saving} placeholder="Point de chargement" />
          <input value={order.destination || ''} onChange={(e) => updateField('destination', e.target.value)} disabled={saving} placeholder="Destination" />
          <input value={order.goods || ''} onChange={(e) => updateField('goods', e.target.value)} disabled={saving} placeholder="Marchandise" />
          <input value={order.quantity || ''} onChange={(e) => updateField('quantity', e.target.value)} disabled={saving} placeholder="Quantité / tonnage" />
          <label className="field-stack"><span>Départ</span><input type="datetime-local" value={order.departureDateTime ? new Date(order.departureDateTime).toISOString().slice(0, 16) : ''} onChange={(e) => updateField('departureDateTime', e.target.value)} disabled={saving} /></label>
          <label className="field-stack"><span>Arrivée</span><input type="datetime-local" value={order.arrivalDateTime ? new Date(order.arrivalDateTime).toISOString().slice(0, 16) : ''} onChange={(e) => updateField('arrivalDateTime', e.target.value)} disabled={saving} /></label>
          <label className="field-stack"><span>Créé le</span><input type="datetime-local" value={order.date ? new Date(order.date).toISOString().slice(0, 16) : ''} onChange={(e) => updateField('date', e.target.value)} disabled={saving} /></label>
          <textarea className="delivery-notes-box" value={order.notes || ''} onChange={(e) => updateField('notes', e.target.value)} rows={5} disabled={saving} placeholder="Notes mission" />
        </div>
      </section>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Timeline mission</h3><p>Lecture compacte des étapes</p></div></div>
      <div className="timeline-list">
        <div className="timeline-row"><div className="timeline-icon">1</div><div><strong>Création</strong><p>{order.date ? new Date(order.date).toLocaleString() : '-'}</p><span>Mission enregistrée</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">2</div><div><strong>Départ mission</strong><p>{order.departureDateTime ? new Date(order.departureDateTime).toLocaleString() : '-'}</p><span>{order.loadingPoint || 'Départ non renseigné'}</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">3</div><div><strong>Arrivée mission</strong><p>{order.arrivalDateTime ? new Date(order.arrivalDateTime).toLocaleString() : '-'}</p><span>{order.destination}</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">4</div><div><strong>Preuve de livraison</strong><p>{order.proofStatus || 'En attente'}</p><span>{order.proofNote || 'Aucun commentaire'}</span></div></div>
        {order.completedAt && <div className="timeline-row"><div className="timeline-icon">5</div><div><strong>Fin mission</strong><p>{new Date(order.completedAt).toLocaleString()}</p><span>Bon livré</span></div></div>}
      </div>
    </section>
  </div>
}
