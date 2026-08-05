import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Bell, BellOff, CirclePlus, MapPin, Phone, Plus, Save, Trash2, X } from 'lucide-react'
import { ErrorBanner, EmptyBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { useAccessibleConfirm } from '../components/ConfirmDialog.jsx'
import {
  createAlertRecipient,
  createGeofence,
  deleteAlertRecipient,
  deleteGeofence,
  loadAlertRecipients,
  loadGeofenceEvents,
  loadGeofences,
  updateAlertRecipient,
  updateGeofence,
} from '../lib/fleeti'

const GEOFENCE_TYPES = [
  { value: 'depot', label: 'Dépôt' },
  { value: 'carriere', label: 'Carrière / Mine' },
  { value: 'chantier', label: 'Chantier' },
  { value: 'client', label: 'Site client' },
  { value: 'interdite', label: 'Zone interdite' },
  { value: 'autre', label: 'Autre' },
]

const TYPE_LABELS = Object.fromEntries(GEOFENCE_TYPES.map((item) => [item.value, item.label]))

const GEOFENCE_COLORS = ['#946239', '#22c55e', '#f59e0b', '#38bdf8', '#ef4444', '#a855f7']

const EMPTY_FORM = {
  id: null,
  name: '',
  type: 'client',
  lat: '',
  lng: '',
  radiusMeters: 1500,
  color: '#946239',
  active: true,
}

function formatDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function MapClickCapture({ onPick, enabled }) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) })
    },
  })
  return null
}

function createZoneCenterIcon(color, selected) {
  return L.divIcon({
    className: 'geofence-center-icon-wrap',
    html: `<div class="geofence-center-icon ${selected ? 'selected' : ''}" style="background:${color}"></div>`,
    iconSize: selected ? [22, 22] : [18, 18],
    iconAnchor: selected ? [11, 11] : [9, 9],
  })
}

function GeofenceMap({ geofences, selectedId, dragDraft, onSelect, onPick, pickEnabled, onDragStart, onDrag, onDragEnd }) {
  const mapRef = useRef(null)
  // Cache d'icônes par (couleur, sélection) : références stables, sinon react-leaflet
  // appelle setIcon() à chaque rendu et remplace l'élément pendant le glissement.
  const iconCacheRef = useRef(new Map())

  // Positions mémoïsées : références stables par zone. Sans cela, react-leaflet v5
  // (updateMarker compare props.position !== prevProps.position) appelle setLatLng()
  // à chaque rendu et le marqueur est re-collé à son ancienne position pendant le drag.
  const positionByZoneId = useMemo(() => {
    const map = {}
    for (const zone of geofences) map[zone.id] = [zone.lat, zone.lng]
    return map
  }, [geofences])

  const zones = useMemo(() => geofences.map((zone) => {
    const selected = zone.id === selectedId
    const fillColor = selected ? '#22d3ee' : (zone.color || '#946239')
    const iconKey = `${fillColor}|${selected ? '1' : '0'}`
    let icon = iconCacheRef.current.get(iconKey)
    if (!icon) {
      icon = createZoneCenterIcon(fillColor, selected)
      iconCacheRef.current.set(iconKey, icon)
    }
    return { ...zone, selected, fillColor, icon }
  }), [geofences, selectedId])

  useEffect(() => {
    if (selectedId) {
      const zone = geofences.find((item) => item.id === selectedId)
      if (zone && mapRef.current) {
        mapRef.current.flyTo([zone.lat, zone.lng], Math.max(mapRef.current.getZoom(), 10), { duration: 0.6 })
      }
    }
  }, [selectedId, geofences])

  return (
    <MapContainer
      ref={mapRef}
      center={[7.5, -5.5]}
      zoom={7}
      scrollWheelZoom
      className="geofence-admin-map"
    >
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapClickCapture onPick={onPick} enabled={pickEnabled} />
      {zones.map((zone) => {
        const isDraft = dragDraft?.id === zone.id
        const center = isDraft ? [dragDraft.lat, dragDraft.lng] : positionByZoneId[zone.id]
        return (
          <div key={zone.id}>
            <Circle
              center={center}
              radius={Number(zone.radiusMeters) || 1000}
              pathOptions={{
                color: zone.fillColor,
                weight: zone.selected ? 3 : 2,
                fillColor: zone.fillColor,
                fillOpacity: zone.active ? 0.22 : 0.08,
                dashArray: zone.active ? null : '6 6',
              }}
              eventHandlers={{ click: () => onSelect(zone) }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                <strong>{zone.name}</strong>
                <br />
                {TYPE_LABELS[zone.type] || zone.type}
                {zone.active ? '' : ' (inactive)'}
                <br />
                Rayon: {Number(zone.radiusMeters).toLocaleString('fr-FR')} m
              </Tooltip>
            </Circle>
            <Marker
              position={positionByZoneId[zone.id]}
              icon={zone.icon}
              draggable
              zIndexOffset={zone.selected ? 1000 : 500}
              eventHandlers={{
                click: () => onSelect(zone),
                dragstart: () => onDragStart(zone),
                drag: (event) => onDrag(zone.id, event.target.getLatLng()),
                dragend: (event) => onDragEnd(zone, event.target.getLatLng()),
              }}
            >
              <Tooltip direction="top" offset={[0, -14]} opacity={1}>
                {zone.name} — glisser pour déplacer
              </Tooltip>
            </Marker>
          </div>
        )
      })}
    </MapContainer>
  )
}

export function GeofencesPage() {
  const { confirm, confirmationDialog } = useAccessibleConfirm()
  const [geofences, setGeofences] = useState([])
  const [recipients, setRecipients] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [pickEnabled, setPickEnabled] = useState(false)
  const [dragDraft, setDragDraft] = useState(null) // { id, lat, lng } pendant un glissement

  const [recipientForm, setRecipientForm] = useState({ name: '', phone: '', active: true })
  const [recipientSaving, setRecipientSaving] = useState(false)

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [geofencePayload, recipientPayload, eventsPayload] = await Promise.all([
        loadGeofences(),
        loadAlertRecipients(),
        loadGeofenceEvents(50),
      ])
      setGeofences(geofencePayload.geofences || [])
      setRecipients(recipientPayload.recipients || [])
      setEvents(eventsPayload.events || [])
    } catch (err) {
      setError(err.message || 'Impossible de charger les géofences.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeCount = useMemo(() => geofences.filter((zone) => zone.active).length, [geofences])
  const activeRecipientCount = useMemo(() => recipients.filter((recipient) => recipient.active).length, [recipients])

  function startCreate() {
    setForm(EMPTY_FORM)
    setPickEnabled(true)
    setSuccess('')
  }

  function startEdit(zone) {
    setForm({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: zone.radiusMeters,
      color: zone.color || '#946239',
      active: zone.active,
    })
    setPickEnabled(false)
    setSuccess('')
  }

  function handleMapPick({ lat, lng }) {
    setForm((previous) => ({ ...previous, lat, lng }))
    setPickEnabled(false)
  }

  function handleDragStart() {
    // Ne PAS toucher au formulaire ici : un changement de sélection recréerait
    // l'icône (setIcon) et casserait le glissement en cours.
    setPickEnabled(false)
  }

  function handleDrag(zoneId, latlng) {
    setDragDraft({ id: zoneId, lat: Number(latlng.lat.toFixed(6)), lng: Number(latlng.lng.toFixed(6)) })
  }

  async function handleDragEnd(zone, latlng) {
    const lat = Number(latlng.lat.toFixed(6))
    const lng = Number(latlng.lng.toFixed(6))
    setDragDraft(null)
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateGeofence(zone.id, { lat, lng })
      // Synchronise le formulaire uniquement si c'est la zone en cours d'édition
      setForm((previous) => (previous.id === zone.id ? { ...previous, lat, lng } : previous))
      setSuccess(`Zone « ${zone.name} » déplacée.`)
      await refresh()
    } catch (err) {
      setError(err.message || 'Déplacement impossible.')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveGeofence(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        name: form.name,
        type: form.type,
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusMeters: Number(form.radiusMeters),
        color: form.color,
        active: form.active,
      }
      if (form.id) {
        await updateGeofence(form.id, payload)
        setSuccess('Zone mise à jour.')
      } else {
        await createGeofence(payload)
        setSuccess('Zone créée.')
      }
      setForm(EMPTY_FORM)
      setPickEnabled(false)
      await refresh()
    } catch (err) {
      setError(err.message || 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteGeofence(zone) {
    const ok = await confirm({
      title: 'Supprimer la zone ?',
      message: `La géofence « ${zone.name} » sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
    })
    if (!ok) return
    setError('')
    setSuccess('')
    try {
      await deleteGeofence(zone.id)
      if (form.id === zone.id) setForm(EMPTY_FORM)
      await refresh()
      setSuccess('Zone supprimée.')
    } catch (err) {
      setError(err.message || 'Suppression impossible.')
    }
  }

  async function handleToggleRecipient(recipient) {
    setError('')
    try {
      await updateAlertRecipient(recipient.id, { active: !recipient.active })
      await refresh()
    } catch (err) {
      setError(err.message || 'Modification impossible.')
    }
  }

  async function handleAddRecipient(event) {
    event.preventDefault()
    setRecipientSaving(true)
    setError('')
    try {
      await createAlertRecipient({ ...recipientForm, active: recipientForm.active })
      setRecipientForm({ name: '', phone: '', active: true })
      await refresh()
      setSuccess('Numéro d’alerte ajouté.')
    } catch (err) {
      setError(err.message || 'Ajout impossible.')
    } finally {
      setRecipientSaving(false)
    }
  }

  async function handleDeleteRecipient(recipient) {
    const ok = await confirm({
      title: 'Retirer ce numéro ?',
      message: `« ${recipient.name} » (${recipient.phone}) ne recevra plus les alertes.`,
      confirmLabel: 'Retirer',
    })
    if (!ok) return
    setError('')
    try {
      await deleteAlertRecipient(recipient.id)
      await refresh()
      setSuccess('Numéro retiré.')
    } catch (err) {
      setError(err.message || 'Suppression impossible.')
    }
  }

  return (
    <PageStack>
      <SectionHeader
        headingLevel="h1"
        title="Géofences & Alertes"
        description="Zones métier, détection entrée / sortie et destinataires des notifications."
        right={
          <div className="ui-kpi-row">
            <div className="mini-kpi"><span>Zones actives</span><strong>{activeCount}</strong></div>
            <div className="mini-kpi"><span>Numéros d’alerte</span><strong>{activeRecipientCount}</strong></div>
            <div className="mini-kpi"><span>Événements récents</span><strong>{events.length}</strong></div>
          </div>
        }
      />

      <ErrorBanner message={error} />
      {success && <div className="info-banner" role="status">{success}</div>}
      {loading && <LoadingBanner message="Chargement des zones…" />}

      <section className="panel geofence-workspace">
        <div className="geofence-map-column">
          <div className="geofence-map-toolbar">
            <button type="button" className={`chip ${pickEnabled ? 'selected' : ''}`} onClick={() => { setPickEnabled((value) => !value) }} aria-pressed={pickEnabled}>
              <MapPin size={16} />
              {pickEnabled ? 'Cliquez sur la carte pour placer la zone' : 'Placer une zone sur la carte'}
            </button>
            <span className="geofence-map-hint"><MapPin size={14} /> Cliquez sur une zone pour la modifier · glissez le point central pour la déplacer</span>
          </div>
          <GeofenceMap
            geofences={geofences}
            selectedId={form.id}
            dragDraft={dragDraft}
            onSelect={startEdit}
            onPick={handleMapPick}
            pickEnabled={pickEnabled}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
          />
          {geofences.length === 0 && !loading && <EmptyBanner message="Aucune géofence configurée. Créez la première zone ci-contre." />}
        </div>

        <div className="geofence-form-column">
          <SectionHeader
            title={form.id ? 'Modifier la zone' : 'Nouvelle zone'}
            description={form.id ? `Zone sélectionnée : ${form.name}` : 'Définissez une zone et son rayon de détection.'}
            right={form.id ? <button type="button" className="ghost-btn" onClick={() => { setForm(EMPTY_FORM); setPickEnabled(false) }}><X size={18} />Annuler</button> : null}
          />
          <form className="delivery-form delivery-form-premium delivery-form-panel" onSubmit={handleSaveGeofence}>
            <label className="field-stack">
              <span>Nom de la zone</span>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ex. Carrière de Bouaké"
                required
              />
            </label>
            <label className="field-stack">
              <span>Type de zone</span>
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                {GEOFENCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <div className="field-stack geofence-coords-row">
              <label className="field-stack">
                <span>Latitude</span>
                <input type="number" step="0.000001" value={form.lat} onChange={(event) => setForm({ ...form, lat: event.target.value })} placeholder="7.688449" required />
              </label>
              <label className="field-stack">
                <span>Longitude</span>
                <input type="number" step="0.000001" value={form.lng} onChange={(event) => setForm({ ...form, lng: event.target.value })} placeholder="-5.148992" required />
              </label>
            </div>
            <label className="field-stack">
              <span>Rayon (mètres) — {form.radiusMeters ? `${Number(form.radiusMeters).toLocaleString('fr-FR')} m` : ''}</span>
              <input type="range" min="100" max="20000" step="100" value={Number(form.radiusMeters) || 1000} onChange={(event) => setForm({ ...form, radiusMeters: Number(event.target.value) })} />
            </label>
            <div className="field-stack">
              <span>Couleur</span>
              <div className="geofence-color-row">
                {GEOFENCE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Couleur ${color}`}
                    aria-pressed={form.color === color}
                    className={`geofence-color-swatch ${form.color === color ? 'selected' : ''}`}
                    style={{ background: color }}
                    onClick={() => setForm({ ...form, color })}
                  />
                ))}
              </div>
            </div>
            <label className="toggle-row geofence-active-row">
              <span><strong>Zone active</strong><small>La détection entrée / sortie est opérationnelle.</small></span>
              <input type="checkbox" role="switch" aria-checked={form.active} checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            </label>
            <div className="table-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                <Save size={18} />
                {saving ? 'Enregistrement…' : form.id ? 'Mettre à jour' : 'Créer la zone'}
              </button>
              {form.id && (
                <button type="button" className="ghost-btn" onClick={() => handleDeleteGeofence(form)}>
                  <Trash2 size={18} />
                  Supprimer
                </button>
              )}
            </div>
            {pickEnabled && <div className="info-banner" role="status">Cliquez sur la carte pour renseigner la position.</div>}
          </form>
        </div>
      </section>

      <section className="panel">
        <SectionHeader
          title="Numéros qui reçoivent les alertes"
          description="Ces numéros WhatsApp reçoivent les alertes de géofence (entrée / sortie de zone) et les alertes flotte."
          right={
            <form className="recipient-add-form" onSubmit={handleAddRecipient}>
              <input
                type="text"
                value={recipientForm.name}
                onChange={(event) => setRecipientForm({ ...recipientForm, name: event.target.value })}
                placeholder="Nom (ex. Responsable exploitation)"
                aria-label="Nom du destinataire"
                required
              />
              <input
                type="tel"
                value={recipientForm.phone}
                onChange={(event) => setRecipientForm({ ...recipientForm, phone: event.target.value })}
                placeholder="Numéro WhatsApp (+225…)"
                aria-label="Numéro WhatsApp"
                required
              />
              <button type="submit" className="primary-btn" disabled={recipientSaving}>
                <Plus size={18} />
                {recipientSaving ? 'Ajout…' : 'Ajouter'}
              </button>
            </form>
          }
        />
        {recipients.length === 0 && !loading && <EmptyBanner message="Aucun numéro configuré. Les alertes ne seront pas notifiées." />}
        {recipients.length > 0 && (
          <div className="recipient-table-wrap">
            <table className="ops-table recipient-table">
              <thead>
                <tr><th>Destinataire</th><th>Numéro WhatsApp</th><th>Actif</th><th><span className="visually-hidden">Actions</span></th></tr>
              </thead>
              <tbody>
                {recipients.map((recipient) => (
                  <tr key={recipient.id}>
                    <td><strong>{recipient.name}</strong></td>
                    <td><span className="recipient-phone"><Phone size={15} />{recipient.phone}</span></td>
                    <td>
                      <label className="toggle-row recipient-toggle">
                        <span>{recipient.active ? 'Actif' : 'Inactif'}</span>
                        <input type="checkbox" role="switch" aria-checked={recipient.active} checked={recipient.active} onChange={() => handleToggleRecipient(recipient)} />
                      </label>
                    </td>
                    <td className="table-actions-cell">
                      <button type="button" className="ghost-btn icon-btn" aria-label={`Retirer ${recipient.name}`} onClick={() => handleDeleteRecipient(recipient)}>
                        <Trash2 size={22} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="geofence-help-note">
          {recipients.length === 0
            ? <><BellOff size={15} /> Aucun destinataire : les événements sont enregistrés mais aucune notification WhatsApp n’est envoyée.</>
            : <><Bell size={15} /> Les notifications sont envoyées via la connexion WhatsApp active (page WhatsApp).</>}
        </p>
      </section>

      <section className="panel">
        <SectionHeader
          title="Derniers événements de zone"
          description="Entrées et sorties détectées automatiquement sur les positions live."
          right={<button type="button" className="ghost-btn" onClick={refresh}><CirclePlus size={18} />Actualiser</button>}
        />
        {events.length === 0 && !loading && <EmptyBanner message="Aucun événement pour l’instant. Les franchissements seront listés ici." />}
        {events.length > 0 && (
          <div className="geofence-events-table-wrap">
            <table className="ops-table">
              <thead>
                <tr><th>Heure</th><th>Zone</th><th>Camion</th><th>Événement</th><th>Position</th></tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td><strong>{event.geofenceName}</strong></td>
                    <td>{event.truckLabel}</td>
                    <td>
                      <span className={`geofence-event-chip ${event.eventType === 'enter' ? 'is-enter' : 'is-exit'}`}>
                        {event.eventType === 'enter' ? 'Entrée' : 'Sortie'}
                      </span>
                    </td>
                    <td><a className="view-link geofence-coord-link" href={`https://maps.google.com/?q=${event.lat},${event.lng}`} target="_blank" rel="noreferrer">{Number(event.lat).toFixed(5)}, {Number(event.lng).toFixed(5)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmationDialog}
    </PageStack>
  )
}

export default GeofencesPage
