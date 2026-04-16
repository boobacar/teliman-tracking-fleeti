import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Printer, Trash2 } from 'lucide-react'
import { StableDatePicker } from '../components/StableDatePicker'
import { fr } from 'date-fns/locale'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteDeliveryOrder, loadDeliveryOrder, resolveMediaUrl, updateDeliveryOrder } from '../lib/fleeti'
import { printDeliveryOrder } from '../lib/printDeliveryOrder'

function formatFrenchQuantity(value, digits = 3) {
  const normalized = Number(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(normalized)) return value || '-'
  return normalized.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function DeliveryOrderDetailPage({ deliveryOrders, refreshData }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const listOrder = useMemo(() => deliveryOrders.find((item) => String(item.id) === String(id)), [deliveryOrders, id])
  const [fallbackOrder, setFallbackOrder] = useState(null)
  const order = listOrder || fallbackOrder
  const [saving, setSaving] = useState(false)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [form, setForm] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState('')

  useEffect(() => {
    let cancelled = false

    async function ensureOrder() {
      if (listOrder) {
        setFallbackOrder(null)
        return
      }

      setLoadingOrder(true)
      try {
        const payload = await loadDeliveryOrder(id)
        if (!cancelled) setFallbackOrder(payload)
      } catch {
        if (!cancelled) setFallbackOrder(null)
      } finally {
        if (!cancelled) setLoadingOrder(false)
      }
    }

    ensureOrder()
    return () => {
      cancelled = true
    }
  }, [id, listOrder])

  useEffect(() => {
    if (order) {
      setForm({
        reference: order.reference || '',
        client: order.client || '',
        loadingPoint: order.loadingPoint || '',
        destination: order.destination || '',
        goods: order.goods || '',
        quantity: order.quantity || '',
        departureDateTime: order.departureDateTime || '',
        arrivalDateTime: order.arrivalDateTime || '',
        date: order.date || '',
        notes: order.notes || '',
      })
    }
  }, [order])

  if (!order && loadingOrder) {
    return <section className="panel"><div className="panel-header"><div><h3>Bon de livraison</h3><p>Chargement du bon...</p></div></div></section>
  }

  if (!order) {
    return <section className="panel"><div className="panel-header"><div><h3>Bon de livraison</h3><p>Bon introuvable</p></div></div></section>
  }

  const proofPhotos = Array.isArray(order.proofPhotoDataUrls)
    ? order.proofPhotoDataUrls
    : (order.proofPhotoDataUrl ? [order.proofPhotoDataUrl] : [])

  const updateField = async (field, value) => {
    setSaving(true)
    try {
      await updateDeliveryOrder(order.id, { [field]: value })
      await refreshData()
      const refreshed = await loadDeliveryOrder(order.id).catch(() => null)
      if (refreshed) setFallbackOrder(refreshed)
    } finally {
      setSaving(false)
    }
  }

  const updateMany = async (payload) => {
    setSaving(true)
    try {
      await updateDeliveryOrder(order.id, payload)
      await refreshData()
      const refreshed = await loadDeliveryOrder(order.id).catch(() => null)
      if (refreshed) setFallbackOrder(refreshed)
    } finally {
      setSaving(false)
    }
  }

  const saveForm = async () => {
    if (!form) return
    setSaving(true)
    try {
      await updateDeliveryOrder(order.id, {
        reference: form.reference,
        client: form.client,
        loadingPoint: form.loadingPoint,
        destination: form.destination,
        goods: form.goods,
        quantity: form.quantity,
        departureDateTime: form.departureDateTime || null,
        arrivalDateTime: form.arrivalDateTime || null,
        date: form.date || null,
        notes: form.notes,
      })
      await refreshData()
      const refreshed = await loadDeliveryOrder(order.id).catch(() => null)
      if (refreshed) setFallbackOrder(refreshed)
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

  const removePhotoAt = async (index) => {
    setSaving(true)
    try {
      const nextPhotos = proofPhotos.filter((_, i) => i !== index)
      await updateDeliveryOrder(order.id, {
        proofPhotoDataUrls: nextPhotos,
        proofPhotoDataUrl: nextPhotos[0] || '',
        proofStatus: nextPhotos.length ? (order.proofStatus || 'Reçue') : 'En attente',
      })
      await refreshData()
      const refreshed = await loadDeliveryOrder(order.id).catch(() => null)
      if (refreshed) setFallbackOrder(refreshed)
    } finally {
      setSaving(false)
      setLightboxOpen('')
    }
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large mission-hero-card">
      <div className="panel-header"><div><h3>Détail du bon {order.reference}</h3><p>{order.truckLabel} — {order.driver}</p></div><div className="table-actions"><button className="ghost-btn small-btn" onClick={() => printDeliveryOrder(order)}><Printer size={16} /> Imprimer</button><button className="ghost-btn small-btn" onClick={() => navigate('/delivery-orders')}><ArrowLeft size={16} /> Retour</button></div></div>
      <div className="mission-highlight-grid compact-mission-grid"><div className="mission-highlight-card"><span>Client</span><strong>{order.client}</strong><small>{order.reference}</small></div><div className="mission-highlight-card"><span>Destination</span><strong>{order.destination}</strong><small>{order.goods || '-'}</small></div><div className="mission-highlight-card"><span>Statut</span><strong>{order.active ? 'Actif' : order.status}</strong><small>{formatFrenchQuantity(order.quantity)}</small></div></div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Photos du bon de livraison</h3><p>Preuves rattachées à cette mission</p></div></div>
      {proofPhotos.length > 0 ? (
        <div className="proof-photos-grid">
          {proofPhotos.map((photo, index) => (
            <div key={`${photo.slice(0, 32)}-${index}`} className="proof-photo-card">
              <button className="ghost-btn small-btn danger-btn icon-btn proof-photo-delete-btn" onClick={() => removePhotoAt(index)} disabled={saving} aria-label="Supprimer photo"><Trash2 size={15} /></button>
              <button className="ghost-btn" style={{ width: 'fit-content', padding: 0, border: 'none', background: 'transparent' }} onClick={() => setLightboxOpen(resolveMediaUrl(photo))}>
                <img src={resolveMediaUrl(photo)} alt={`Preuve ${order.reference} ${index + 1}`} style={{ width: 220, maxWidth: '100%', borderRadius: 14, border: '1px solid rgba(148,163,184,.35)', objectFit: 'cover' }} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: '#94a3b8' }}>Aucune photo uploadée pour ce bon.</p>
      )}
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
          <input value={form?.reference || ''} onChange={(e) => setForm((current) => ({ ...current, reference: e.target.value }))} disabled={saving} placeholder="Référence" />
          <input value={form?.client || ''} onChange={(e) => setForm((current) => ({ ...current, client: e.target.value }))} disabled={saving} placeholder="Client" />
          <input value={form?.loadingPoint || ''} onChange={(e) => setForm((current) => ({ ...current, loadingPoint: e.target.value }))} disabled={saving} placeholder="Point de chargement" />
          <input value={form?.destination || ''} onChange={(e) => setForm((current) => ({ ...current, destination: e.target.value }))} disabled={saving} placeholder="Destination" />
          <input value={form?.goods || ''} onChange={(e) => setForm((current) => ({ ...current, goods: e.target.value }))} disabled={saving} placeholder="Marchandise" />
          <input value={form?.quantity || ''} onChange={(e) => setForm((current) => ({ ...current, quantity: e.target.value }))} disabled={saving} placeholder="Quantité / tonnage" />
          <label className="field-stack">
            <span>Départ</span>
            <StableDatePicker
              value={form?.departureDateTime ? new Date(form.departureDateTime) : null}
              onChange={(value) => setForm((current) => ({ ...current, departureDateTime: value ? value.toISOString() : '' }))}
              withTime
              placeholder="Choisir date et heure"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <label className="field-stack">
            <span>Arrivée</span>
            <StableDatePicker
              value={form?.arrivalDateTime ? new Date(form.arrivalDateTime) : null}
              onChange={(value) => setForm((current) => ({ ...current, arrivalDateTime: value ? value.toISOString() : '' }))}
              withTime
              placeholder="Choisir date et heure"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <label className="field-stack">
            <span>Date déchargement</span>
            <StableDatePicker
              value={form?.date ? new Date(form.date) : null}
              onChange={(value) => setForm((current) => ({ ...current, date: value ? value.toISOString() : '' }))}
              withTime
              placeholder="Choisir date et heure"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <textarea className="delivery-notes-box" value={form?.notes || ''} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} rows={5} disabled={saving} placeholder="Notes mission" />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="primary-btn" onClick={saveForm} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
        </div>
      </section>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Timeline mission</h3><p>Lecture compacte des étapes</p></div></div>
      <div className="timeline-list">
        <div className="timeline-row"><div className="timeline-icon">1</div><div><strong>Création</strong><p>{order.date ? new Date(order.date).toLocaleString() : '-'}</p><span>Mission enregistrée</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">2</div><div><strong>Départ mission</strong><p>{order.departureDateTime ? new Date(order.departureDateTime).toLocaleString() : '-'}</p><span>{order.loadingPoint || 'Départ non renseigné'}</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">3</div><div><strong>Arrivée mission</strong><p>{order.arrivalDateTime ? new Date(order.arrivalDateTime).toLocaleString() : '-'}</p><span>{order.destination}</span></div></div>
        <div className="timeline-row"><div className="timeline-icon">4</div><div><strong>Preuve de livraison</strong><p>{order.proofStatus || 'En attente'}</p><span>{proofPhotos.length ? `${proofPhotos.length} photo(s) disponible(s)` : (order.proofNote || 'Aucun commentaire')}</span></div></div>
        {order.completedAt && <div className="timeline-row"><div className="timeline-icon">5</div><div><strong>Fin mission</strong><p>{new Date(order.completedAt).toLocaleString()}</p><span>Bon livré</span></div></div>}
      </div>
    </section>

    {lightboxOpen && (
      <div className="photo-lightbox" onClick={() => setLightboxOpen('')}>
        <img src={lightboxOpen} alt={`Photo ${order.reference}`} className="photo-lightbox-image" onClick={(e) => e.stopPropagation()} />
      </div>
    )}
  </div>
}
