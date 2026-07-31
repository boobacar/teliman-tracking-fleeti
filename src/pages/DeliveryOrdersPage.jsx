import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StableDatePicker } from '../components/StableDatePicker'
import { Camera, CheckCircle, ClipboardList, Download, PackageCheck, Plus, Trash2, Truck, X } from 'lucide-react'
import { createDeliveryOrder, deleteDeliveryOrder, loadDeliveryOrders, loadDeliveryOrdersSummary, loadMasterData, updateDeliveryOrder } from '../lib/fleeti'
import { Pagination } from '../components/Pagination'
import { SkeletonTable } from '../components/Skeleton'
import { PageStack } from '../components/UIPrimitives'
import { formatDeliveryQuantity } from '../lib/deliveryOrders.js'
import { useAccessibleConfirm } from '../components/ConfirmDialog.jsx'

async function fileToDataUrl(file) {
  const objectUrl = URL.createObjectURL(file)

  const canvasToBlob = (canvas, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Conversion image impossible'))
      resolve(blob)
    }, 'image/jpeg', quality)
  })

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Lecture image impossible'))
    reader.readAsDataURL(blob)
  })

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Format image non supporté'))
      image.src = objectUrl
    })

    // Compression orientée mobile/réseau : max 1280px puis dégradation progressive
    const maxSize = 1280
    const ratio = Math.min(1, maxSize / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * ratio))
    const height = Math.max(1, Math.round(img.height * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)

    // Cible conservative pour éviter erreurs proxy réseau mobile
    const maxBytes = 220 * 1024
    const qualities = [0.78, 0.68, 0.58, 0.5, 0.42, 0.35]

    let chosenBlob = null
    for (const q of qualities) {
      const blob = await canvasToBlob(canvas, q)
      chosenBlob = blob
      if (blob.size <= maxBytes) break
    }

    if (!chosenBlob) throw new Error('Compression image échouée')
    return await blobToDataUrl(chosenBlob)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
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

function matchesDeliveryOrderSearch(item = {}, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) return true
  const haystack = [
    item.reference,
    item.truckLabel,
    item.driver,
    item.client,
    item.destination,
    item.loadingPoint,
    item.goods,
    item.quantity,
    item.status,
    item.notes,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ')
  return haystack.includes(normalizedQuery)
}

function formatMissionDate(value, withTime = true) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('fr-FR', withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function DeliveryOrdersPage({ deliveryOrders, deliveryOrdersSummary, enrichedTrackers, refreshData, setDeliveryOrders, setDeliveryOrdersSummary, masterData = { clients: [], goods: [], destinations: [] }, setMasterData }) {
  const { confirm, confirmationDialog } = useAccessibleConfirm()
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState('')
  const [photoUploadNotice, setPhotoUploadNotice] = useState('')
  const [photoUploadProgress, setPhotoUploadProgress] = useState(0)
  const [page, setPage] = useState(1)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const PER_PAGE = 10


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

  // Reset page quand les filtres changent
  useEffect(() => {
    setPage(1)
  }, [statusFilter, trackerFilter, clientFilter, dateFilter, searchQuery])

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
    setError('')
    try {
      await createDeliveryOrder(form.status === 'Livré' ? { ...form, active: false } : form)
      setForm(initialForm)
      setShowCreateForm(false)
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
    } catch (err) {
      setError(err.message || 'Erreur lors de la création du bon de livraison.')
    } finally {
      setSaving(false)
    }
  }

  const markDelivered = async (item) => {
    if (!item.active || item.status === 'Livré') return
    if (!await confirm({ title: 'Clôturer le bon de livraison ?', message: `Le bon ${item.reference || item.id} sera marqué livré et désactivé.`, confirmLabel: 'Marquer livré' })) return
    setError('')
    try {
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
    } catch (err) {
      setError(err.message || 'Erreur lors du marquage livré.')
    }
  }

  const removeOrder = async (item) => {
    if (!await confirm({ title: 'Supprimer le bon de livraison ?', message: `Le bon ${item.reference || item.id} et ses preuves seront supprimés.`, confirmLabel: 'Supprimer' })) return
    setError('')
    try {
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
    } catch (err) {
      setError(err.message || 'Erreur lors de la suppression du bon.')
    }
  }

  const uploadProofPhotos = async (item, files) => {
    if (!files.length) return
    setSaving(true)
    setPhotoUploadProgress(8)
    const progressTimer = setInterval(() => {
      setPhotoUploadProgress((prev) => (prev >= 90 ? prev : prev + 7))
    }, 180)
    try {
      const newPhotos = await Promise.all(files.map(fileToDataUrl))
      const proofPhotoDataUrl = newPhotos.at(-1)
      const currentPhotos = Array.isArray(item.proofPhotoDataUrls)
        ? item.proofPhotoDataUrls
        : (item.proofPhotoDataUrl ? [item.proofPhotoDataUrl] : [])
      await updateDeliveryOrder(item.id, {
        proofPhotoDataUrl,
        proofPhotoDataUrls: [...currentPhotos, ...newPhotos].slice(0, 10),
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
      setPhotoUploadProgress(100)
      setPhotoUploadNotice({ kind: 'success', message: `${newPhotos.length} photo(s) uploadée(s) avec succès` })
      setTimeout(() => {
        setPhotoUploadNotice('')
        setPhotoUploadProgress(0)
      }, 1400)
    } catch (error) {
      setPhotoUploadNotice({ kind: 'error', message: `Upload photo échoué: ${error.message}` })
      setPhotoUploadProgress(0)
      setTimeout(() => setPhotoUploadNotice(''), 3500)
    } finally {
      clearInterval(progressTimer)
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
    const searchOk = matchesDeliveryOrderSearch(item, searchQuery)
    return statusOk && trackerOk && clientOk && dateOk && searchOk
  })
  const hasActiveFilters = statusFilter !== 'all' || trackerFilter !== 'all' || clientFilter !== 'all' || Boolean(dateFilter) || Boolean(searchQuery.trim())

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PER_PAGE))
  // Réinitialiser la page si elle dépasse après changement de filtre
  const safePage = Math.min(page, totalPages)
  const paginatedOrders = filteredOrders.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const missionStats = {
    total: deliveryOrdersSummary?.total || deliveryOrders.length,
    active: deliveryOrders.filter((item) => item.active).length,
    delivered: deliveryOrders.filter((item) => item.status === 'Livré').length,
    pendingProofs: deliveryOrders.filter((item) => item.proofStatus === 'En attente').length,
  }

  return <PageStack className="ops-page-stack delivery-orders-page">
    {pageLoading && <SkeletonTable rows={4} cols={7} />}
    {error && <div className="info-banner delivery-error-banner" role="alert">{error}</div>}

    <header className="panel panel-large delivery-command-header">
      <div className="delivery-command-copy">
        <span className="delivery-command-eyebrow"><ClipboardList size={16} /> Exploitation</span>
        <h1>Bons de livraison</h1>
        <p>Créez, suivez et clôturez les missions de livraison depuis une seule vue.</p>
      </div>
      <div className="delivery-command-actions">
        <button type="button" className="ghost-btn" onClick={() => exportDeliveryOrdersCsv(filteredOrders)}><Download size={20} /> Exporter</button>
        <button type="button" className="primary-btn" onClick={() => setShowCreateForm((visible) => !visible)} aria-expanded={showCreateForm} aria-controls="bl-form">
          {showCreateForm ? <X size={20} /> : <Plus size={20} />}{showCreateForm ? 'Fermer' : 'Nouveau bon'}
        </button>
      </div>
    </header>

    <section className="delivery-kpi-grid" aria-label="Synthèse des bons de livraison">
      <article className="delivery-kpi-card"><span className="delivery-kpi-icon"><ClipboardList size={22} /></span><div><small>Total</small><strong>{missionStats.total}</strong><p>bons enregistrés</p></div></article>
      <article className="delivery-kpi-card delivery-kpi-card--active"><span className="delivery-kpi-icon"><Truck size={22} /></span><div><small>Actifs</small><strong>{missionStats.active}</strong><p>missions à suivre</p></div></article>
      <article className="delivery-kpi-card delivery-kpi-card--success"><span className="delivery-kpi-icon"><PackageCheck size={22} /></span><div><small>Livrés</small><strong>{missionStats.delivered}</strong><p>missions clôturées</p></div></article>
      <article className="delivery-kpi-card delivery-kpi-card--warning"><span className="delivery-kpi-icon"><Camera size={22} /></span><div><small>Preuves attendues</small><strong>{missionStats.pendingProofs}</strong><p>photos à récupérer</p></div></article>
    </section>

    {showCreateForm && (
      <section id="bl-form" className="panel panel-large delivery-create-panel">
        <div className="delivery-create-heading">
          <div><span className="delivery-section-index">Nouveau</span><h2>Créer un bon de livraison</h2><p>Les champs marqués d’un astérisque sont obligatoires.</p></div>
          <button type="button" className="ghost-btn icon-btn" onClick={() => setShowCreateForm(false)} aria-label="Fermer le formulaire"><X size={22} /></button>
        </div>

        <form className="delivery-create-form" onSubmit={submit}>
          <fieldset className="delivery-form-section">
            <legend>Mission</legend>
            <div className="delivery-form-grid">
              <label className="field-stack"><span>Camion *</span><select aria-label="Camion" value={form.trackerId} onChange={(e) => handleTrackerChange(e.target.value)} required><option value="">Sélectionner un camion</option>{trackerOptions.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label} — {tracker.driver}</option>)}</select></label>
              <label className="field-stack"><span>Chauffeur</span><input aria-label="Chauffeur" placeholder="Nom du chauffeur" value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} /></label>
              <label className="field-stack"><span>Référence BL *</span><input aria-label="Référence BL" placeholder="Ex. BL-0001234" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} required pattern="^(?!.*\.(jpe?g|png|webp|heic|heif|gif|bmp|svg|tiff?)($|\s|[^a-z0-9])).+" title="La référence ne peut pas être un nom de fichier image. Ex: 0001234" /></label>
              <label className="field-stack"><span>Client *</span><select aria-label="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required><option value="">Sélectionner un client</option>{(masterData.clients || []).map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
            </div>
          </fieldset>

          <fieldset className="delivery-form-section">
            <legend>Trajet et chargement</legend>
            <div className="delivery-form-grid">
              <label className="field-stack"><span>Point de chargement</span><input aria-label="Point de chargement" placeholder="Lieu de départ" value={form.loadingPoint} onChange={(e) => setForm({ ...form, loadingPoint: e.target.value })} /></label>
              <label className="field-stack"><span>Destination *</span><select aria-label="Destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} required><option value="">Sélectionner une destination</option>{(masterData.destinations || []).map((destination) => <option key={destination} value={destination}>{destination}</option>)}</select></label>
              <label className="field-stack"><span>Marchandise</span><select aria-label="Marchandise" value={form.goods} onChange={(e) => setForm({ ...form, goods: e.target.value })}><option value="">Sélectionner une marchandise</option>{(masterData.goods || []).map((goods) => <option key={goods} value={goods}>{goods}</option>)}</select></label>
              <label className="field-stack"><span>Quantité / tonnage</span><input aria-label="Quantité ou tonnage" placeholder="Ex. 32 tonnes" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
            </div>
          </fieldset>

          <fieldset className="delivery-form-section">
            <legend>Planning</legend>
            <div className="delivery-form-grid delivery-form-grid--planning">
              <label className="field-stack"><span>Départ</span><StableDatePicker value={form.departureDateTime ? new Date(form.departureDateTime) : null} onChange={(value) => setForm({ ...form, departureDateTime: value ? value.toISOString() : '' })} withTime placeholder="Date et heure de départ" clearable className="filter-control modern-date-input" /></label>
              <label className="field-stack"><span>Arrivée prévue</span><StableDatePicker value={form.arrivalDateTime ? new Date(form.arrivalDateTime) : null} onChange={(value) => setForm({ ...form, arrivalDateTime: value ? value.toISOString() : '' })} withTime placeholder="Date et heure d’arrivée" clearable className="filter-control modern-date-input" /></label>
              <label className="field-stack"><span>Déchargement</span><StableDatePicker value={form.date ? new Date(form.date) : null} onChange={(value) => setForm({ ...form, date: value ? value.toISOString() : '' })} withTime placeholder="Date et heure de déchargement" clearable className="filter-control modern-date-input" /></label>
              <label className="field-stack"><span>Statut</span><select aria-label="Statut de mission" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value, active: e.target.value === 'Livré' ? false : form.active })}><option>Prévu</option><option>En chargement</option><option>En cours</option><option>Livré</option></select></label>
            </div>
            <label className="delivery-active-switch"><span><strong>Mission active</strong><small>Le bon apparaît dans les missions à suivre.</small></span><input type="checkbox" role="switch" checked={form.active} disabled={form.status === 'Livré'} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></label>
          </fieldset>

          <label className="field-stack delivery-notes-field"><span>Notes de mission</span><textarea aria-label="Notes de mission" placeholder="Consignes, contact sur place, contraintes de livraison…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></label>
          <div className="delivery-form-actions"><button type="button" className="ghost-btn" onClick={() => { setForm(initialForm); setShowCreateForm(false) }}>Annuler</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le bon'}</button></div>
        </form>
      </section>
    )}

    <section className="panel panel-large delivery-workspace">
      <div className="delivery-workspace-heading">
        <div><span className="delivery-section-index">Suivi</span><h2>Missions de livraison</h2><p>{filteredOrders.length} bon{filteredOrders.length > 1 ? 's' : ''} affiché{filteredOrders.length > 1 ? 's' : ''}</p></div>
        <button type="button" className="ghost-btn delivery-reset-filters" disabled={!hasActiveFilters} onClick={() => { setStatusFilter('all'); setTrackerFilter('all'); setClientFilter('all'); setDateFilter(null); setSearchQuery('') }}><X size={18} /> Réinitialiser</button>
      </div>
      <div className="delivery-status-tabs" aria-label="Filtrer par statut">
        {[['all', 'Tous'], ['active', 'Actifs'], ['Prévu', 'Prévus'], ['En chargement', 'En chargement'], ['En cours', 'En cours'], ['Livré', 'Livrés']].map(([value, label]) => <button key={value} type="button" className={`chip ${statusFilter === value ? 'selected' : ''}`} onClick={() => setStatusFilter(value)}>{label}</button>)}
      </div>
      <div className="delivery-filter-grid">
        <label className="field-stack delivery-search-field"><span>Recherche BL</span><input aria-label="Recherche bons de livraison" className="filter-control" type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Référence, camion, chauffeur, client…" /></label>
        <label className="field-stack"><span>Camion</span><select className="filter-control" value={trackerFilter} onChange={(e) => setTrackerFilter(e.target.value)}><option value="all">Tous les camions</option>{enrichedTrackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.label}</option>)}</select></label>
        <label className="field-stack"><span>Client</span><select className="filter-control" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}><option value="all">Tous les clients</option>{[...new Set(deliveryOrders.map((item) => item.client).filter(Boolean))].map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
        <label className="field-stack"><span>Date de déchargement</span><StableDatePicker value={dateFilter} onChange={setDateFilter} placeholder="Toutes les dates" clearable className="filter-control modern-date-input" /></label>
      </div>

      {photoUploadProgress > 0 && <div className="upload-progress-wrap" aria-label="Progression upload photo"><div className="upload-progress-bar" style={{ width: `${photoUploadProgress}%` }} /></div>}

      <div className="reports-table-wrap delivery-desktop-table">
        <table className="reports-table delivery-operations-table">
          <caption>Bons de livraison filtrés</caption>
          <thead><tr><th>Bon</th><th>Mission</th><th>Client & destination</th><th>Chargement</th><th>Date</th><th>Statut</th><th>Preuve</th><th>Actions</th></tr></thead>
          <tbody>
            {paginatedOrders.map((item) => {
              const statusLabel = item.status || (item.active ? 'En cours' : 'Prévu')
              const statusClass = statusLabel === 'Livré' ? 'status-success' : statusLabel === 'En cours' || statusLabel === 'En chargement' ? 'status-warn' : 'status-neutral'
              const pickerId = `proof-photo-${item.id}`
              const proofCount = Array.isArray(item.proofPhotoDataUrls) ? item.proofPhotoDataUrls.length : (item.proofPhotoDataUrl ? 1 : 0)
              return <tr key={item.id} className={item.active ? 'active-order-row' : ''}>
                <td><Link className="delivery-order-reference" to={`/delivery-order/${item.id}`}>{item.reference || `BL-${item.id}`}</Link></td>
                <td><Link className="delivery-table-primary" to={`/tracker/${item.trackerId}`}>{item.truckLabel || 'Camion non renseigné'}</Link><small>{item.driver || enrichedTrackers.find((t) => String(t.id) === String(item.trackerId))?.employeeName || 'Chauffeur non renseigné'}</small></td>
                <td><strong>{item.client || '—'}</strong><small>{item.loadingPoint ? `${item.loadingPoint} → ` : ''}{item.destination || '—'}</small></td>
                <td><strong>{item.goods || '—'}</strong><small>{formatDeliveryQuantity(item.quantity)}</small></td>
                <td><div className="delivery-date-stack"><span><b>D</b>{formatMissionDate(item.departureDateTime)}</span><span><b>A</b>{formatMissionDate(item.arrivalDateTime)}</span><span><b>DC</b>{formatMissionDate(item.date)}</span></div></td>
                <td><span className={`status-chip ${statusClass}`}>{statusLabel}</span>{item.active && <small className="delivery-active-label">Mission active</small>}</td>
                <td><span className={`delivery-proof-state ${proofCount ? 'has-proof' : 'missing-proof'}`}><Camera size={17} /> {proofCount ? `${proofCount} photo${proofCount > 1 ? 's' : ''}` : 'En attente'}</span></td>
                <td><div className="table-actions"><button type="button" className="ghost-btn icon-btn" title="Marquer livré" aria-label={`Marquer ${item.reference} livré`} disabled={saving || !item.active || item.status === 'Livré'} onClick={() => markDelivered(item)}><CheckCircle size={22} /></button><button type="button" className="ghost-btn icon-btn" title="Ajouter une photo" aria-label={`Ajouter une photo au bon ${item.reference}`} onClick={() => document.getElementById(pickerId)?.click()}><Camera size={22} /></button><input id={pickerId} type="file" accept="image/*" multiple hidden onChange={async (e) => { const files = Array.from(e.target.files || []); await uploadProofPhotos(item, files); e.target.value = '' }} /><button type="button" className="ghost-btn danger-btn icon-btn" onClick={() => removeOrder(item)} title="Supprimer" aria-label={`Supprimer le bon ${item.reference}`}><Trash2 size={22} /></button></div></td>
              </tr>
            })}
            {!paginatedOrders.length && <tr><td colSpan="8" className="delivery-empty-state"><ClipboardList size={28} /><strong>Aucun bon trouvé</strong><span>Modifiez les filtres ou créez un nouveau bon.</span></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mobile-voucher-list delivery-mobile-list">
        {paginatedOrders.map((item) => {
          const statusLabel = item.status || (item.active ? 'En cours' : 'Prévu')
          const pickerId = `proof-photo-mobile-${item.id}`
          const proofCount = Array.isArray(item.proofPhotoDataUrls) ? item.proofPhotoDataUrls.length : (item.proofPhotoDataUrl ? 1 : 0)
          return <article key={`mobile-${item.id}`} className="mobile-voucher-card delivery-mobile-card">
            <header className="mobile-voucher-head"><div><small>Bon de livraison</small><strong><Link className="touch-link" to={`/delivery-order/${item.id}`}>{item.reference || `BL-${item.id}`}</Link></strong></div><span className={`status-chip ${statusLabel === 'Livré' ? 'status-success' : statusLabel === 'Prévu' ? 'status-neutral' : 'status-warn'}`}>{statusLabel}</span></header>
            <div className="delivery-mobile-route"><Truck size={20} /><div><strong>{item.truckLabel || 'Camion non renseigné'}</strong><small>{item.driver || enrichedTrackers.find((t) => String(t.id) === String(item.trackerId))?.employeeName || 'Chauffeur non renseigné'}</small><span>{item.loadingPoint || 'Départ non renseigné'} → {item.destination || 'Destination non renseignée'}</span></div></div>
            <dl className="delivery-mobile-details"><div><dt>Client</dt><dd>{item.client || '—'}</dd></div><div><dt>Chargement</dt><dd>{item.goods || '—'} · {formatDeliveryQuantity(item.quantity)}</dd></div><div><dt>Déchargement</dt><dd>{formatMissionDate(item.date)}</dd></div><div><dt>Preuve</dt><dd className={proofCount ? 'has-proof' : 'missing-proof'}>{proofCount ? `${proofCount} photo${proofCount > 1 ? 's' : ''}` : 'En attente'}</dd></div></dl>
            <div className="table-actions"><button type="button" className="ghost-btn icon-btn" disabled={saving || !item.active || item.status === 'Livré'} onClick={() => markDelivered(item)} title="Marquer livré" aria-label={`Marquer ${item.reference} livré`}><CheckCircle size={22} /></button><button type="button" className="ghost-btn icon-btn" onClick={() => document.getElementById(pickerId)?.click()} title="Ajouter photo" aria-label={`Ajouter une photo au bon ${item.reference}`}><Camera size={22} /></button><input id={pickerId} type="file" accept="image/*" multiple hidden onChange={async (e) => { const files = Array.from(e.target.files || []); await uploadProofPhotos(item, files); e.target.value = '' }} /><button type="button" className="ghost-btn danger-btn icon-btn" onClick={() => removeOrder(item)} title="Supprimer" aria-label={`Supprimer le bon ${item.reference}`}><Trash2 size={22} /></button></div>
          </article>
        })}
        {!paginatedOrders.length && <div className="delivery-mobile-empty"><ClipboardList size={26} /><strong>Aucun bon trouvé</strong></div>}
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filteredOrders.length} onPageChange={setPage} />
    </section>

    {photoUploadNotice && <div className={`upload-toast ${photoUploadNotice.kind}`} role="status" aria-live="polite">{photoUploadNotice.message}</div>}
    {confirmationDialog}
  </PageStack>
}
