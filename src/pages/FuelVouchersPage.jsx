import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StableDatePicker } from '../components/StableDatePicker'
import { Banknote, Camera, Download, Droplets, Fuel, Plus, ReceiptText, Trash2, X } from 'lucide-react'
import { SkeletonTable } from '../components/Skeleton'
import { PageStack } from '../components/UIPrimitives'
import { Pagination } from '../components/Pagination'
import { createFuelVoucher, deleteFuelVoucher, loadFuelVouchers, loadLiveFuelLevels, loadMasterData, updateFuelVoucher } from '../lib/fleeti'
import { useAccessibleConfirm } from '../components/ConfirmDialog.jsx'

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

function formatFuelDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  const { confirm, confirmationDialog } = useAccessibleConfirm()

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
  const [showCreateForm, setShowCreateForm] = useState(false)
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
      setShowCreateForm(false)
      setError('')
    } catch (err) {
      setError(err?.message || 'Erreur lors de l\'enregistrement.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    if (!await confirm({ title: 'Supprimer le bon carburant ?', message: `Le bon ${item.voucherNumber || item.id} et ses preuves seront supprimés.`, confirmLabel: 'Supprimer' })) return
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

  const fuelStats = items.reduce((acc, item) => {
    acc.liters += toNumber(item.quantityLiters)
    acc.amount += toNumber(item.amount)
    return acc
  }, { liters: 0, amount: 0 })
  const averagePrice = fuelStats.liters > 0 ? fuelStats.amount / fuelStats.liters : 0
  const liveFuelCount = Array.isArray(liveFuel) ? liveFuel.length : (liveFuel?.items?.length || 0)
  const hasActiveFilters = trackerFilter !== 'all' || Boolean(dateFilter) || Boolean(searchQuery.trim())

  return (
    <PageStack className="ops-page-stack fuel-vouchers-page">
      <header className="panel panel-large delivery-command-header fuel-command-header">
        <div className="delivery-command-copy">
          <span className="delivery-command-eyebrow"><Fuel size={16} /> Exploitation</span>
          <h1>Bons carburant</h1>
          <p>Enregistrez les ravitaillements et contrôlez les dépenses carburant de la flotte.</p>
          {liveFuel !== null && <span className="fuel-live-indicator"><Droplets size={16} /> {liveFuelCount} niveau{liveFuelCount > 1 ? 'x' : ''} carburant en direct</span>}
        </div>
        <div className="delivery-command-actions">
          <button type="button" className="ghost-btn" onClick={() => exportCsv(filtered)}><Download size={20} /> Exporter</button>
          <button type="button" className="primary-btn" onClick={() => setShowCreateForm((visible) => !visible)} aria-expanded={showCreateForm} aria-controls="fuel-form">
            {showCreateForm ? <X size={20} /> : <Plus size={20} />}{showCreateForm ? 'Fermer' : 'Nouveau bon'}
          </button>
        </div>
      </header>

      <section className="delivery-kpi-grid fuel-kpi-grid" aria-label="Synthèse des bons carburant">
        <article className="delivery-kpi-card"><span className="delivery-kpi-icon"><ReceiptText size={22} /></span><div><small>Total bons</small><strong>{items.length}</strong><p>ravitaillements enregistrés</p></div></article>
        <article className="delivery-kpi-card fuel-kpi-card--volume"><span className="delivery-kpi-icon"><Droplets size={22} /></span><div><small>Volume total</small><strong>{fuelStats.liters.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} L</strong><p>litres distribués</p></div></article>
        <article className="delivery-kpi-card fuel-kpi-card--amount"><span className="delivery-kpi-icon"><Banknote size={22} /></span><div><small>Dépenses</small><strong>{fuelStats.amount.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</strong><p>FCFA cumulés</p></div></article>
        <article className="delivery-kpi-card fuel-kpi-card--price"><span className="delivery-kpi-icon"><Fuel size={22} /></span><div><small>Prix moyen / litre</small><strong>{averagePrice.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</strong><p>FCFA par litre</p></div></article>
      </section>

      {showCreateForm && (
        <section id="fuel-form" className="panel panel-large delivery-create-panel fuel-create-panel">
          <div className="delivery-create-heading">
            <div><span className="delivery-section-index">Nouveau</span><h2>Créer un bon carburant</h2><p>Renseignez le ravitaillement et son coût réel.</p></div>
            <button type="button" className="ghost-btn icon-btn" onClick={() => setShowCreateForm(false)} aria-label="Fermer le formulaire"><X size={22} /></button>
          </div>

          <form className="delivery-create-form fuel-create-form" onSubmit={submit}>
            <fieldset className="delivery-form-section">
              <legend>Identification</legend>
              <div className="delivery-form-grid">
                <label className="field-stack"><span>Numéro du bon *</span><input aria-label="Numéro de bon carburant" value={form.voucherNumber} onChange={(e) => setForm((c) => ({ ...c, voucherNumber: e.target.value }))} placeholder="Ex. CARB-00281" required /></label>
                <label className="field-stack"><span>Date et heure *</span><StableDatePicker value={form.dateTime ? new Date(form.dateTime) : null} onChange={(value) => setForm((c) => ({ ...c, dateTime: value ? value.toISOString() : '' }))} withTime placeholder="Date et heure du ravitaillement" clearable className="filter-control modern-date-input" /></label>
              </div>
            </fieldset>

            <fieldset className="delivery-form-section">
              <legend>Affectation</legend>
              <div className="delivery-form-grid">
                <label className="field-stack"><span>Camion *</span><select aria-label="Camion" value={form.trackerId} onChange={(e) => onTruckChange(e.target.value)} required><option value="">Sélectionner un camion</option>{enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label} — {tracker.employeeName || 'Sans chauffeur'}</option>)}</select></label>
                <label className="field-stack"><span>Fournisseur *</span><select aria-label="Fournisseur" value={form.supplier} onChange={(e) => setForm((c) => ({ ...c, supplier: e.target.value }))} required><option value="">Sélectionner un fournisseur</option>{suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}</select></label>
              </div>
            </fieldset>

            <fieldset className="delivery-form-section fuel-cost-section">
              <legend>Volume et coût</legend>
              <div className="fuel-cost-grid">
                <label className="field-stack"><span>Quantité *</span><div className="fuel-input-with-unit"><input aria-label="Quantité en litres" type="number" step="0.001" min="0" value={form.quantityLiters} onChange={(e) => setForm((c) => ({ ...c, quantityLiters: e.target.value }))} placeholder="0" required /><span>litres</span></div></label>
                <label className="field-stack"><span>Prix unitaire *</span><div className="fuel-input-with-unit"><input aria-label="Prix unitaire par litre" type="number" step="0.01" min="0" value={form.unitPrice} onChange={(e) => setForm((c) => ({ ...c, unitPrice: e.target.value }))} placeholder="0" required /><span>FCFA/L</span></div></label>
                <div className="fuel-amount-preview"><small>Montant calculé</small><strong>{amount.toLocaleString('fr-FR')} FCFA</strong><span>Quantité × prix unitaire</span></div>
              </div>
            </fieldset>

            {error && <div className="error-banner fuel-form-error" role="alert">{error}</div>}
            <div className="delivery-form-actions"><button type="button" className="ghost-btn" onClick={() => { setForm(initialForm); setError(''); setShowCreateForm(false) }}>Annuler</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le bon'}</button></div>
          </form>
        </section>
      )}

      <section className="panel panel-large delivery-workspace fuel-workspace">
        <div className="delivery-workspace-heading">
          <div><span className="delivery-section-index">Suivi</span><h2>Ravitaillements</h2><p>{filtered.length} bon{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}</p></div>
          <button type="button" className="ghost-btn delivery-reset-filters" disabled={!hasActiveFilters} onClick={() => { setTrackerFilter('all'); setDateFilter(null); setSearchQuery('') }}><X size={18} /> Réinitialiser</button>
        </div>

        <div className="fuel-filter-grid">
          <label className="field-stack fuel-search-field"><span>Recherche carburant</span><input aria-label="Recherche bons de carburant" className="filter-control" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Numéro, camion, chauffeur, fournisseur…" /></label>
          <label className="field-stack"><span>Camion</span><select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}><option value="all">Tous les camions</option>{enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}</select></label>
          <label className="field-stack"><span>Date du ravitaillement</span><StableDatePicker value={dateFilter} onChange={setDateFilter} placeholder="Toutes les dates" clearable className="filter-control modern-date-input" /></label>
        </div>

        {loading ? <SkeletonTable rows={4} cols={7} /> : <>
          <div className="reports-table-wrap fuel-desktop-table">
            <table className="reports-table fuel-operations-table">
              <caption>Historique des bons carburant</caption>
              <thead><tr><th scope="col">Bon</th><th scope="col">Affectation</th><th scope="col">Fournisseur</th><th scope="col">Volume & prix</th><th scope="col">Montant</th><th scope="col">Preuve</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {paginated.map((item) => {
                  const pickerId = `fuel-photo-${item.id}`
                  const photos = Array.isArray(item.proofPhotoDataUrls) ? item.proofPhotoDataUrls.filter(Boolean) : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
                  const driver = item.driver || enrichedTrackers.find((tracker) => String(tracker.id) === String(item.trackerId))?.employeeName || 'Chauffeur non renseigné'
                  return <tr key={item.id}>
                    <td><Link className="fuel-voucher-reference" to={`/fuel-voucher/${item.id}`}>{item.voucherNumber || `BON-${item.id}`}</Link><small>{formatFuelDate(item.dateTime)}</small></td>
                    <td><Link className="fuel-table-primary" to={`/tracker/${item.trackerId}`}>{item.truckLabel || 'Camion non renseigné'}</Link><small>{driver}</small></td>
                    <td><strong>{item.supplier || '—'}</strong></td>
                    <td><strong>{toNumber(item.quantityLiters).toLocaleString('fr-FR')} L</strong><small>{toNumber(item.unitPrice).toLocaleString('fr-FR')} FCFA/L</small></td>
                    <td><strong className="fuel-amount-cell">{toNumber(item.amount).toLocaleString('fr-FR')} FCFA</strong></td>
                    <td><span className={`delivery-proof-state ${photos.length ? 'has-proof' : 'missing-proof'}`}><Camera size={17} /> {photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'En attente'}</span></td>
                    <td><div className="table-actions"><button type="button" className="ghost-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter une photo" aria-label={`Ajouter une photo au bon ${item.voucherNumber || item.id}`}><Camera size={22} /></button><input id={pickerId} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} /><button type="button" className="ghost-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label={`Supprimer le bon ${item.voucherNumber || item.id}`}><Trash2 size={22} /></button></div></td>
                  </tr>
                })}
                {!paginated.length && <tr><td colSpan="7" className="delivery-empty-state"><ReceiptText size={28} /><strong>Aucun bon trouvé</strong><span>Modifiez les filtres ou créez un nouveau bon carburant.</span></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="mobile-voucher-list fuel-mobile-list">
            {paginated.map((item) => {
              const pickerId = `fuel-photo-mobile-${item.id}`
              const photos = Array.isArray(item.proofPhotoDataUrls) ? item.proofPhotoDataUrls.filter(Boolean) : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
              const driver = item.driver || enrichedTrackers.find((tracker) => String(tracker.id) === String(item.trackerId))?.employeeName || 'Chauffeur non renseigné'
              return <article key={`mobile-fuel-${item.id}`} className="mobile-voucher-card delivery-mobile-card fuel-mobile-card">
                <header className="mobile-voucher-head"><div><small>Bon carburant</small><strong><Link className="touch-link" to={`/fuel-voucher/${item.id}`}>{item.voucherNumber || `BON-${item.id}`}</Link></strong></div><span className="fuel-mobile-amount">{toNumber(item.amount).toLocaleString('fr-FR')} FCFA</span></header>
                <div className="delivery-mobile-route fuel-mobile-truck"><Fuel size={20} /><div><strong>{item.truckLabel || 'Camion non renseigné'}</strong><small>{driver}</small><span>{item.supplier || 'Fournisseur non renseigné'}</span></div></div>
                <dl className="delivery-mobile-details"><div><dt>Date</dt><dd>{formatFuelDate(item.dateTime)}</dd></div><div><dt>Quantité</dt><dd>{toNumber(item.quantityLiters).toLocaleString('fr-FR')} L</dd></div><div><dt>Prix unitaire</dt><dd>{toNumber(item.unitPrice).toLocaleString('fr-FR')} FCFA/L</dd></div><div><dt>Preuve</dt><dd className={photos.length ? 'has-proof' : 'missing-proof'}>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'En attente'}</dd></div></dl>
                <div className="table-actions"><button type="button" className="ghost-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter une photo" aria-label={`Ajouter une photo au bon ${item.voucherNumber || item.id}`}><Camera size={22} /></button><input id={pickerId} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; await uploadPhoto(item, file); e.target.value = '' }} /><button type="button" className="ghost-btn danger-btn icon-btn" onClick={() => remove(item)} title="Supprimer" aria-label={`Supprimer le bon ${item.voucherNumber || item.id}`}><Trash2 size={22} /></button></div>
              </article>
            })}
            {!paginated.length && <div className="delivery-mobile-empty"><ReceiptText size={26} /><strong>Aucun bon trouvé</strong></div>}
          </div>
        </>}

        <Pagination page={safePage} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </section>
      {confirmationDialog}
    </PageStack>
  )
}
