import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StableDatePicker } from '../components/StableDatePicker'
import { Camera, Trash2 } from 'lucide-react'
import { EmptyBanner, LoadingBanner } from '../components/FeedbackBanners'
import { SkeletonTable } from '../components/Skeleton'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { Pagination } from '../components/Pagination'
import { createFuelVoucher, deleteFuelVoucher, loadFuelVouchers, loadLiveFuelLevels, loadMasterData, updateFuelVoucher } from '../lib/fleeti'

const initialForm = {
  trackerId: '',
  truckLabel: '',
  driver: '',
  voucherNumber: '',
  supplier: '',
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

function matchesFuelVoucherSearch(item = {}, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) return true
  const haystack = [
    item.voucherNumber,
    item.truckLabel,
    item.driver,
    item.supplier,
    item.quantityLiters,
    item.unitPrice,
    item.amount,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ')
  return haystack.includes(normalizedQuery)
}

function exportCsv(rows) {
  const headers = ['Camion', 'Numéro bon', 'Date', 'Quantité (L)', 'Prix/L', 'Montant', 'Photo']
  const csvRows = rows.map((item) => {
    const photos = Array.isArray(item.proofPhotoDataUrls)
      ? item.proofPhotoDataUrls
      : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
    return [
      item.truckLabel || '',
      item.voucherNumber || '',
      item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR') : '',
      item.quantityLiters || 0,
      item.unitPrice || 0,
      item.amount || 0,
      photos.length ? `Oui (${photos.length})` : 'Non',
    ]
  })
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
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(false)
  const [liveFuel, setLiveFuel] = useState(null)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 10

  const [error, setError] = useState('')

  const amount = useMemo(() => Number((toNumber(form.quantityLiters) * toNumber(form.unitPrice)).toFixed(2)), [form.quantityLiters, form.unitPrice])

  const reload = async () => {
    const payload = await loadFuelVouchers()
    setItems(payload.items ?? [])
  }

  useEffect(() => {
    let cancelled = false
    let liveCancelled = false
    async function loadData() {
      setLoading(true)
      try {
        const [payload, masterData] = await Promise.all([
          loadFuelVouchers(),
          loadMasterData(),
        ])
        if (!cancelled) {
          setItems(payload.items ?? [])
          setSuppliers(masterData?.suppliers || [])
          setLoading(false)
          // Charger le live fuel en arrière-plan sans bloquer le rendu
          loadLiveFuelLevels()
            .then((data) => {
              if (!cancelled && !liveCancelled) setLiveFuel(data)
            })
            .catch(() => { /* silencieux : le live fuel est optionnel */ })
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => { cancelled = true; liveCancelled = true }
  }, [])

  useEffect(() => { setPage(1) }, [trackerFilter, dateFilter, searchQuery])

  const filtered = useMemo(() => items.filter((item) => {
    const trackerOk = trackerFilter === 'all' ? true : String(item.trackerId) === String(trackerFilter)
    const selectedDateKey = dateFilter ? dateFilter.toISOString().slice(0, 10) : ''
    const dateOk = !selectedDateKey ? true : String(item.dateTime || '').slice(0, 10) === selectedDateKey
    const searchOk = matchesFuelVoucherSearch(item, searchQuery)
    return trackerOk && dateOk && searchOk
  }), [items, trackerFilter, dateFilter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

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
    setError('')
    // Validation locale
    if (!form.voucherNumber.trim()) return setError('Le numéro de bon est requis.')
    if (!form.trackerId) return setError('Veuillez sélectionner un camion.')
    if (!form.dateTime) return setError('Veuillez choisir une date.')
    if (!form.supplier) return setError('Veuillez sélectionner un fournisseur.')
    if (toNumber(form.quantityLiters) <= 0) return setError('La quantité doit être supérieure à 0.')
    if (toNumber(form.unitPrice) <= 0) return setError('Le prix unitaire doit être supérieur à 0.')

    setSaving(true)
    try {
      await createFuelVoucher({
        ...form,
        quantityLiters: toNumber(form.quantityLiters),
        unitPrice: toNumber(form.unitPrice),
      })
      await reload()
      setForm(initialForm)
      setError('')
    } catch (err) {
      setError(err?.message || 'Erreur lors de l\'enregistrement.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    await deleteFuelVoucher(item.id)
    await reload()
  }

  const uploadPhoto = async (item, file) => {
    if (!file) return
    const proofPhotoDataUrl = await fileToDataUrl(file)
    const currentPhotos = Array.isArray(item.proofPhotoDataUrls)
      ? item.proofPhotoDataUrls
      : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
    const nextPhotos = [...currentPhotos, proofPhotoDataUrl].filter(Boolean).slice(0, 10)
    await updateFuelVoucher(item.id, {
      proofPhotoDataUrls: nextPhotos,
      proofPhotoDataUrl: nextPhotos[0] || '',
    })
    await reload()
  }

  return (
    <PageStack className="ops-page-stack">
      <section className="panel panel-large delivery-hero-panel">
        <SectionHeader title="Centre des bons carburant" right={<div className="mission-hero-badge">Fuel Ops</div>} />
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card"><span>Total bons</span><strong>{items.length}</strong><small>bons carburant enregistrés</small></div>
          <div className="mission-highlight-card"><span>Total litres</span><strong>{items.reduce((acc, item) => acc + (Number(item.quantityLiters) || 0), 0).toLocaleString('fr-FR')}</strong><small>volume cumulé</small></div>
          <div className="mission-highlight-card"><span>Montant total</span><strong>{items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0).toLocaleString('fr-FR')} FCFA</strong><small>historique</small></div>
          {liveFuel && (
            <div className="mission-highlight-card"><span>Niveaux live</span><strong>{Array.isArray(liveFuel) ? liveFuel.length : (liveFuel?.items?.length || '—')}</strong><small>véhicules suivis en direct</small></div>
          )}
        </div>
      </section>

      <section className="panel panel-large delivery-form-panel">
        <SectionHeader title="Nouveau bon de carburant" />
        <form className="delivery-form delivery-form-premium" onSubmit={submit}>
          <label className="field-stack">
            <span>Numéro de bon carburant</span>
            <input aria-label="Numéro de bon carburant" value={form.voucherNumber} onChange={(e) => setForm((c) => ({ ...c, voucherNumber: e.target.value }))} placeholder="Numéro bon" required />
          </label>
          <label className="field-stack">
            <span>Date et heure</span>
            <StableDatePicker
              value={form.dateTime ? new Date(form.dateTime) : null}
              onChange={(value) => setForm((c) => ({ ...c, dateTime: value ? value.toISOString() : '' }))}
              withTime
              placeholder="Choisir date et heure"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <label className="field-stack">
            <span>Camion</span>
            <select aria-label="Camion" value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required>
              <option value="">Sélection Camion</option>
              {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span>Fournisseur</span>
            <select aria-label="Fournisseur" value={form.supplier} onChange={(e) => setForm((c) => ({ ...c, supplier: e.target.value }))} required>
              <option value="">Fournisseur</option>
              {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
            </select>
          </label>
          <label className="field-stack"><span>Quantité (L)</span><input type="number" step="0.001" min="0" value={form.quantityLiters} onChange={(e) => setForm((c) => ({ ...c, quantityLiters: e.target.value }))} required /></label>
          <label className="field-stack"><span>Prix unitaire par litre</span><input type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm((c) => ({ ...c, unitPrice: e.target.value }))} required /></label>
          <label className="field-stack"><span>Montant total</span><input value={Number.isFinite(amount) ? amount.toLocaleString('fr-FR') : '0'} readOnly /></label>
          {error && <div className="error-banner" style={{ marginBottom: 8 }}>{error}</div>}
          <button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer le bon'}</button>
        </form>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <SectionHeader title="Historique bons carburant" />
        <div className="filters filter-row ops-filter-row">
          <label className="field-stack">
            <span>Recherche carburant</span>
            <input
              aria-label="Recherche bons de carburant"
              className="filter-control"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Numéro, camion, chauffeur, fournisseur…"
            />
          </label>
          <label className="field-stack">
            <span>Camion</span>
            <select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}>
              <option value="all">Tous les camions</option>
              {enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}
            </select>
          </label>
          <label className="field-stack">
            <span>Date</span>
            <StableDatePicker
              value={dateFilter}
              onChange={(value) => setDateFilter(value)}
              placeholder="Filtrer par date"
              clearable
              className="filter-control modern-date-input"
            />
          </label>
          <div className="field-stack">
            <span>Export</span>
            <button type="button" className="ghost-btn small-btn" onClick={() => exportCsv(filtered)}>Exporter CSV</button>
          </div>
        </div>
        {loading ? <SkeletonTable rows={4} cols={7} /> : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead><tr><th>Camion</th><th>Numéro bon</th><th>Date</th><th>Quantité (L)</th><th>Montant</th><th>Photo</th><th>Actions</th></tr></thead>
              <tbody>
                {paginated.map((item) => {
                  const pickerId = `fuel-photo-${item.id}`
                  const hasPhoto = Array.isArray(item.proofPhotoDataUrls)
                    ? item.proofPhotoDataUrls.some(Boolean)
                    : Boolean(item.proofPhotoDataUrl)
                  return (
                    <tr
                      key={item.id}
                      className="clickable-row"
                      onClick={() => navigate(`/fuel-voucher/${item.id}`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') navigate(`/fuel-voucher/${item.id}`)
                      }}
                    >
                      <td>{item.truckLabel || '-'}</td>
                      <td>{item.voucherNumber || '-'}</td>
                      <td>{item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                      <td>{Number(item.quantityLiters || 0).toLocaleString('fr-FR')}</td>
                      <td>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</td>
                      <td>{hasPhoto ? 'Oui' : 'Non'}</td>
                      <td>
                        <div className="table-actions" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="ghost-btn small-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter photo" aria-label="Ajouter photo"><Camera size={15} /></button>
                          <input id={pickerId} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} />
                          <button type="button" className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label="Supprimer"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={7} className="table-empty-cell">Aucun bon carburant enregistré.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="mobile-voucher-list">
          {paginated.map((item) => {
            const pickerId = `fuel-photo-mobile-${item.id}`
            return (
              <article
                key={`mobile-fuel-${item.id}`}
                className="mobile-voucher-card"
                onClick={() => navigate(`/fuel-voucher/${item.id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') navigate(`/fuel-voucher/${item.id}`)
                }}
              >
                <div className="mobile-voucher-head">
                  <strong>{item.voucherNumber || '-'}</strong>
                  <span>{Number(item.amount || 0).toLocaleString('fr-FR')} FCFA</span>
                </div>
                <p><b>Camion:</b> {item.truckLabel || '-'}</p>
                <p><b>Date:</b> {item.dateTime ? new Date(item.dateTime).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                <p><b>Quantité:</b> {Number(item.quantityLiters || 0).toLocaleString('fr-FR')} L</p>
                <p><b>Prix/L:</b> {Number(item.unitPrice || 0).toLocaleString('fr-FR')}</p>
                <div className="table-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="ghost-btn small-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter photo" aria-label="Ajouter photo"><Camera size={15} /></button>
                  <input id={pickerId} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} />
                  <button type="button" className="ghost-btn small-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer"><Trash2 size={15} /></button>
                </div>
              </article>
            )
          })}
          {filtered.length === 0 && <EmptyBanner message="Aucun bon carburant enregistré." />}
        </div>
        <Pagination page={safePage} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </section>
    </PageStack>
  )
}
