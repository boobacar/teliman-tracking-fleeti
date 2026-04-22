import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Camera, Save, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { StableDatePicker } from '../components/StableDatePicker'
import { deleteFuelVoucher, loadFuelVoucher, loadMasterData, resolveMediaUrl, updateFuelVoucher } from '../lib/fleeti'

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

export function FuelVoucherDetailPage({ enrichedTrackers = [] }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(null)
  const [form, setForm] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      try {
        const [voucher, masterData] = await Promise.all([
          loadFuelVoucher(id),
          loadMasterData().catch(() => ({ suppliers: [] })),
        ])
        if (cancelled) return
        setItem(voucher)
        setSuppliers(masterData?.suppliers || [])
        if (voucher) {
          setForm({
            trackerId: String(voucher.trackerId || ''),
            truckLabel: voucher.truckLabel || '',
            driver: voucher.driver || '',
            voucherNumber: voucher.voucherNumber || '',
            supplier: voucher.supplier || '',
            dateTime: voucher.dateTime || '',
            quantityLiters: String(voucher.quantityLiters ?? ''),
            unitPrice: String(voucher.unitPrice ?? ''),
          })
        }
      } catch {
        if (!cancelled) setItem(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => { cancelled = true }
  }, [id])

  const proofPhotos = useMemo(() => {
    if (!item) return []
    const list = Array.isArray(item.proofPhotoDataUrls)
      ? item.proofPhotoDataUrls
      : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
    return list.filter(Boolean)
  }, [item])

  const amount = useMemo(() => Number((toNumber(form?.quantityLiters) * toNumber(form?.unitPrice)).toFixed(2)), [form?.quantityLiters, form?.unitPrice])

  const onTruckChange = (trackerId) => {
    const tracker = enrichedTrackers.find((entry) => String(entry.id) === String(trackerId))
    setForm((current) => ({
      ...current,
      trackerId,
      truckLabel: tracker?.label || current?.truckLabel || '',
      driver: tracker?.employeeName || current?.driver || '',
    }))
  }

  const refreshItem = async () => {
    const latest = await loadFuelVoucher(id)
    setItem(latest)
    if (latest) {
      setForm({
        trackerId: String(latest.trackerId || ''),
        truckLabel: latest.truckLabel || '',
        driver: latest.driver || '',
        voucherNumber: latest.voucherNumber || '',
        supplier: latest.supplier || '',
        dateTime: latest.dateTime || '',
        quantityLiters: String(latest.quantityLiters ?? ''),
        unitPrice: String(latest.unitPrice ?? ''),
      })
    }
  }

  const saveForm = async () => {
    if (!item || !form) return
    setSaving(true)
    try {
      await updateFuelVoucher(item.id, {
        trackerId: Number(form.trackerId),
        truckLabel: form.truckLabel,
        driver: form.driver,
        voucherNumber: form.voucherNumber,
        supplier: form.supplier,
        dateTime: form.dateTime,
        quantityLiters: toNumber(form.quantityLiters),
        unitPrice: toNumber(form.unitPrice),
      })
      await refreshItem()
    } finally {
      setSaving(false)
    }
  }

  const uploadPhotos = async (files = []) => {
    if (!item || files.length === 0) return
    setSaving(true)
    try {
      const nextPhotos = [...proofPhotos]
      for (const file of files.slice(0, 10)) {
        const dataUrl = await fileToDataUrl(file)
        nextPhotos.push(dataUrl)
      }
      const normalized = nextPhotos.filter(Boolean).slice(0, 10)
      await updateFuelVoucher(item.id, {
        proofPhotoDataUrls: normalized,
        proofPhotoDataUrl: normalized[0] || '',
      })
      await refreshItem()
    } finally {
      setSaving(false)
    }
  }

  const removePhotoAt = async (index) => {
    if (!item) return
    setSaving(true)
    try {
      const nextPhotos = proofPhotos.filter((_, i) => i !== index)
      await updateFuelVoucher(item.id, {
        proofPhotoDataUrls: nextPhotos,
        proofPhotoDataUrl: nextPhotos[0] || '',
      })
      await refreshItem()
      setLightboxOpen('')
    } finally {
      setSaving(false)
    }
  }

  const removeVoucher = async () => {
    if (!item) return
    setSaving(true)
    try {
      await deleteFuelVoucher(item.id)
      navigate('/fuel-vouchers')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <section className="panel"><div className="panel-header"><div><h3>Détail du bon carburant</h3><p>Chargement...</p></div></div></section>
  }

  if (!item || !form) {
    return <section className="panel"><div className="panel-header"><div><h3>Détail du bon carburant</h3><p>Bon introuvable</p></div></div></section>
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large mission-hero-card">
        <div className="panel-header">
          <div>
            <h3>Détail bon carburant {item.voucherNumber || ''}</h3>
            <p>{item.truckLabel || '-'} — {item.driver || '-'}</p>
          </div>
          <div className="table-actions">
            <button className="ghost-btn small-btn" onClick={() => navigate('/fuel-vouchers')}><ArrowLeft size={16} /> Retour</button>
            <button className="primary-btn" onClick={saveForm} disabled={saving}><Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
        </div>
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card"><span>Fournisseur</span><strong>{item.supplier || '-'}</strong><small>Bon #{item.voucherNumber || '-'}</small></div>
          <div className="mission-highlight-card"><span>Quantité</span><strong>{Number(item.quantityLiters || 0).toLocaleString('fr-FR')} L</strong><small>{Number(item.unitPrice || 0).toLocaleString('fr-FR')} FCFA / L</small></div>
          <div className="mission-highlight-card"><span>Montant</span><strong>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</strong><small>{item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR') : '-'}</small></div>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div><h3>Photos du bon carburant</h3><p>Photo(s) uploadée(s)</p></div>
          <label className="ghost-btn small-btn" style={{ cursor: 'pointer' }}>
            <Camera size={15} /> Ajouter photo(s)
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async (e) => { const files = Array.from(e.target.files || []); await uploadPhotos(files); e.target.value = '' }} />
          </label>
        </div>

        {proofPhotos.length > 0 ? (
          <div className="proof-photos-grid">
            {proofPhotos.map((photo, index) => (
              <div key={`${photo.slice(0, 32)}-${index}`} className="proof-photo-card">
                <button className="ghost-btn small-btn danger-btn icon-btn proof-photo-delete-btn" onClick={() => removePhotoAt(index)} disabled={saving} aria-label="Supprimer photo"><Trash2 size={15} /></button>
                <button className="ghost-btn" style={{ width: 'fit-content', padding: 0, border: 'none', background: 'transparent' }} onClick={() => setLightboxOpen(resolveMediaUrl(photo))}>
                  <img src={resolveMediaUrl(photo)} alt={`Photo bon carburant ${item.voucherNumber} ${index + 1}`} style={{ width: 220, maxWidth: '100%', borderRadius: 14, border: '1px solid rgba(148,163,184,.35)', objectFit: 'cover' }} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#94a3b8' }}>Aucune photo uploadée pour ce bon.</p>
        )}
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Informations du bon</h3><p>Modification directe</p></div></div>
        <div className="delivery-form delivery-form-premium compact-detail-form">
          <input value={form.voucherNumber} onChange={(e) => setForm((current) => ({ ...current, voucherNumber: e.target.value }))} placeholder="Numéro bon" disabled={saving} />
          <label className="field-stack">
            <span>Date et heure</span>
            <StableDatePicker
              value={form.dateTime ? new Date(form.dateTime) : null}
              onChange={(value) => setForm((current) => ({ ...current, dateTime: value ? value.toISOString() : '' }))}
              withTime
              placeholder="Choisir date et heure"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <select value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} disabled={saving}>
            <option value="">Sélection Camion</option>
            {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
          </select>
          <input value={form.driver} onChange={(e) => setForm((current) => ({ ...current, driver: e.target.value }))} placeholder="Chauffeur" disabled={saving} />
          <select value={form.supplier} onChange={(e) => setForm((current) => ({ ...current, supplier: e.target.value }))} disabled={saving}>
            <option value="">Fournisseur</option>
            {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
          <label className="field-stack"><span>Quantité (L)</span><input type="number" step="0.001" min="0" value={form.quantityLiters} onChange={(e) => setForm((current) => ({ ...current, quantityLiters: e.target.value }))} disabled={saving} /></label>
          <label className="field-stack"><span>Prix unitaire par litre</span><input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm((current) => ({ ...current, unitPrice: e.target.value }))} disabled={saving} /></label>
          <label className="field-stack"><span>Montant total</span><input value={Number.isFinite(amount) ? amount.toLocaleString('fr-FR') : '0'} readOnly /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="ghost-btn danger-btn" onClick={removeVoucher} disabled={saving}><Trash2 size={15} /> Supprimer le bon</button>
            <button className="primary-btn" onClick={saveForm} disabled={saving}><Save size={16} /> {saving ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
        </div>
      </section>

      {lightboxOpen && (
        <div className="photo-lightbox" onClick={() => setLightboxOpen('')}>
          <img src={lightboxOpen} alt={`Photo ${item.voucherNumber}`} className="photo-lightbox-image" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
