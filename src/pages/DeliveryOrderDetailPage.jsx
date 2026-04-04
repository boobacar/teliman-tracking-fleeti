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
      <div className="mission-highlight-grid"><div className="mission-highlight-card"><span>Mission</span><strong>{order.reference}</strong><small>{order.client}</small></div><div className="mission-highlight-card"><span>Destination</span><strong>{order.destination}</strong><small>{order.goods || '-'}</small></div><div className="mission-highlight-card"><span>Statut</span><strong>{order.active ? 'Actif' : order.status}</strong><small>{order.quantity || '-'}</small></div></div>
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

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Édition complète du bon</h3><p>Modifier toutes les informations de mission</p></div></div>
      <div className="delivery-form">
        <input value={order.reference || ''} onChange={(e) => updateField('reference', e.target.value)} disabled={saving} placeholder="Référence" />
        <input value={order.client || ''} onChange={(e) => updateField('client', e.target.value)} disabled={saving} placeholder="Client" />
        <input value={order.loadingPoint || ''} onChange={(e) => updateField('loadingPoint', e.target.value)} disabled={saving} placeholder="Point de chargement" />
        <input value={order.destination || ''} onChange={(e) => updateField('destination', e.target.value)} disabled={saving} placeholder="Destination" />
        <input value={order.goods || ''} onChange={(e) => updateField('goods', e.target.value)} disabled={saving} placeholder="Marchandise" />
        <input value={order.quantity || ''} onChange={(e) => updateField('quantity', e.target.value)} disabled={saving} placeholder="Quantité / tonnage" />
        <input type="datetime-local" value={order.date ? new Date(order.date).toISOString().slice(0, 16) : ''} onChange={(e) => updateField('date', e.target.value)} disabled={saving} />
      </div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Workflow mission</h3><p>Faire évoluer la mission avec des statuts plus métier</p></div></div>
      <div className="filters filter-row">
        {['Prévu', 'Validé', 'En chargement', 'En route', 'Arrivé site', 'Déchargement', 'Livré', 'Annulé'].map((status) => <button key={status} className={`chip ${order.status === status ? 'selected' : ''}`} onClick={() => updateMany({ status, active: status !== 'Livré' && status !== 'Annulé', completedAt: status === 'Livré' ? new Date().toISOString() : null })}>{status}</button>)}
      </div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Preuve de livraison</h3><p>Suivi simple de la POD</p></div></div>
      <div className="delivery-form">
        <select value={order.proofStatus || 'En attente'} onChange={(e) => updateField('proofStatus', e.target.value)} disabled={saving}>
          <option>En attente</option>
          <option>Reçue</option>
          <option>Validée</option>
        </select>
        <textarea className="delivery-notes-box" value={order.proofNote || ''} onChange={(e) => updateField('proofNote', e.target.value)} rows={4} placeholder="Commentaire sur la preuve de livraison" disabled={saving} />
      </div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Timeline mission</h3><p>Étapes principales du bon</p></div></div>
      <div className="timeline-list">
        <div className="timeline-row"><div className="timeline-icon">1</div><div><strong>Bon créé</strong><p>{order.date ? new Date(order.date).toLocaleString() : '-'}</p><span>Mission enregistrée dans la plateforme</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">2</div><div><strong>Statut actuel</strong><p>{order.active ? 'Actif' : order.status}</p><span>{order.destination}</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">3</div><div><strong>Preuve de livraison</strong><p>{order.proofStatus || 'En attente'}</p><span>{order.proofNote || 'Aucun commentaire'}</span></div></div>
        {order.completedAt && <div className="timeline-row"><div className="timeline-icon">4</div><div><strong>Mission terminée</strong><p>{new Date(order.completedAt).toLocaleString()}</p><span>Bon marqué livré</span></div></div>}
      </div>
    </section>

    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel">
        <div className="panel-header"><div><h3>Mise à jour rapide</h3><p>Actions importantes</p></div></div>
        <div className="delivery-form">
          <select defaultValue={order.status} onChange={(e) => updateField('status', e.target.value)} disabled={saving}>
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
