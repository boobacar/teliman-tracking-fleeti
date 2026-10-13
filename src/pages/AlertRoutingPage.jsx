import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Clock, Eye, Plus, RefreshCw, Trash2, UserPlus, Power } from 'lucide-react'
import { EmptyBanner, ErrorBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import {
  createAlertRecipient,
  createAlertSubscription,
  deleteAlertRecipient,
  deleteAlertSubscription,
  loadAlertRouting,
  loadGeofences,
  loadMasterData,
  loadReportPreview,
  loadReportSchedules,
  loadVehicles,
  updateAlertRecipient,
  updateAlertSubscription,
  updateReportSchedule,
} from '../lib/fleeti'

// Page « Alertes & Rapports » — contrôle de QUI REÇOIT QUOI.
//
// Règle affichée à l'opérateur : tant qu'un destinataire n'a aucune case cochée, il
// garde le comportement historique (interne : zones + flotte ; client : bornes de ses
// missions). Dès qu'une case est cochée, il ne reçoit PLUS QUE les cases cochées.
// La logique d'envoi vit côté serveur (src/backend/alertRouting.js) : cette page ne
// fait que la configurer.

const EMPTY_RECIPIENT = { name: '', phone: '', scope: 'internal', clientName: '' }

const SCOPE_LABELS = {
  zone: { all: 'Toutes les zones', key: 'zone' },
  client: { all: 'Tous les clients', key: 'client' },
  truck: { all: 'Tous les camions', key: 'truck' },
}

function scopeOptions(category, { geofences, clients, trucks }) {
  const source = category?.scopeSource
  if (source === 'zone') return geofences.map((zone) => ({ value: String(zone.id), label: zone.name }))
  if (source === 'client') return clients.map((client) => ({ value: client, label: client }))
  if (source === 'truck') return trucks.map((truck) => ({ value: truck, label: truck }))
  return []
}

export function AlertRoutingPage() {
  const [state, setState] = useState({ recipients: [], subscriptions: [], categories: [], groups: [] })
  const [geofences, setGeofences] = useState([])
  const [clients, setClients] = useState([])
  const [trucks, setTrucks] = useState([])
  const [form, setForm] = useState(EMPTY_RECIPIENT)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  // Rapports programmés : heure d'envoi par type + aperçu du texte réel
  const [reports, setReports] = useState([])
  const [reportDrafts, setReportDrafts] = useState({})
  const [reportRecipientsCount, setReportRecipientsCount] = useState(0)
  const [reportBusy, setReportBusy] = useState('')
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [routing, zones, master, vehicles, schedules] = await Promise.all([
        loadAlertRouting(),
        loadGeofences().catch(() => ({ geofences: [] })),
        loadMasterData().catch(() => ({})),
        loadVehicles().catch(() => ({ vehicles: [] })),
        loadReportSchedules().catch(() => ({ schedules: [], recipients: [] })),
      ])
      setState({
        recipients: routing?.recipients || [],
        subscriptions: routing?.subscriptions || [],
        categories: routing?.categories || [],
        groups: routing?.groups || [],
      })
      setReports(schedules?.schedules || [])
      setReportRecipientsCount((schedules?.recipients || []).length)
      setGeofences(zones?.geofences || [])
      const clientNames = (master?.clients || master?.masterData?.clients || []).slice?.() || []
      setClients(clientNames)
      const vehicleList = (vehicles?.vehicles || []).map((vehicle) => vehicle.reg_number || vehicle.label || vehicle.name).filter(Boolean)
      setTrucks(Array.from(new Set(vehicleList)).sort())
    } catch (loadError) {
      setError(loadError?.message || 'Chargement du routage impossible.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Rapports programmés ────────────────────────────────────────────────────
  const two = (value) => String(Number(value ?? 0)).padStart(2, '0')
  const timeValueOf = (report) => reportDrafts[report.reportKey] ?? `${two(report.hour)}:${two(report.minute)}`

  const saveReportSchedule = async (reportKey, payload) => {
    setReportBusy(reportKey)
    setError('')
    setInfo('')
    try {
      const response = await updateReportSchedule(reportKey, payload)
      const saved = response?.schedule
      if (saved) {
        setReports((current) => current.map((report) => (report.reportKey === reportKey ? { ...report, ...saved } : report)))
        setInfo(`${saved.label} : envoi ${saved.scheduleLabel}.`)
      }
    } catch (saveError) {
      setError(saveError?.message || 'Enregistrement de l’heure impossible.')
    } finally {
      setReportBusy('')
    }
  }

  const showPreview = async (reportKey) => {
    setReportBusy(reportKey)
    setError('')
    try {
      const response = await loadReportPreview(reportKey)
      setPreview({ reportKey, ...response })
    } catch (previewError) {
      setError(previewError?.message || 'Aperçu indisponible.')
    } finally {
      setReportBusy('')
    }
  }

  const subscriptionByKey = useMemo(() => {
    const map = new Map()
    for (const subscription of state.subscriptions) {
      map.set(`${subscription.recipientId}:${subscription.category}`, subscription)
    }
    return map
  }, [state.subscriptions])

  async function guard(action, successMessage = '') {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await action()
      if (successMessage) setInfo(successMessage)
      await load()
    } catch (actionError) {
      setError(actionError?.message || 'Opération impossible.')
    } finally {
      setBusy(false)
    }
  }

  function addRecipient(event) {
    event.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) return
    guard(() => createAlertRecipient({
      name: form.name.trim(),
      phone: form.phone.trim(),
      scope: form.scope,
      clientName: form.scope === 'client' ? form.clientName.trim() : '',
      active: true,
    }), `Destinataire « ${form.name.trim()} » ajouté.`).then(() => setForm(EMPTY_RECIPIENT))
  }

  // Coche / décoche une catégorie pour un destinataire (portée « tout » par défaut).
  function toggleCategory(recipient, category) {
    const existing = subscriptionByKey.get(`${recipient.id}:${category.key}`)
    if (existing) {
      guard(() => deleteAlertSubscription(existing.id), `« ${category.label} » retiré à ${recipient.name}.`)
      return
    }
    guard(() => createAlertSubscription({ recipientId: recipient.id, category: category.key, scopeType: 'all' }), `« ${category.label} » activé pour ${recipient.name}.`)
  }

  function changeScope(recipient, category, scopeType, scopeValue) {
    const existing = subscriptionByKey.get(`${recipient.id}:${category.key}`)
    if (!existing) {
      guard(() => createAlertSubscription({ recipientId: recipient.id, category: category.key, scopeType, scopeValue }))
      return
    }
    // Mise à jour en place : la règle ne disparaît jamais, même si la nouvelle portée
    // était refusée par le serveur (une suppression suivie d'une création laisserait
    // un trou si la seconde étape échouait).
    guard(() => updateAlertSubscription(existing.id, { scopeType, scopeValue }))
  }

  return (
    <PageStack>
      <SectionHeader
        title="Alertes & Rapports"
        description="Choisissez, destinataire par destinataire, ce que chacun reçoit sur WhatsApp. Sans case cochée, le destinataire garde le réglage par défaut."
        right={(
          <button type="button" className="ghost-btn" onClick={() => load()} disabled={loading || busy}>
            <RefreshCw size={18} />
            Rafraîchir
          </button>
        )}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {info ? <EmptyBanner message={info} /> : null}
      {loading ? <LoadingBanner message="Chargement du routage des alertes…" /> : null}

      <section className="panel panel-large">
        <h2><UserPlus size={20} /> Ajouter un destinataire</h2>
        <form className="delivery-form delivery-form-premium" onSubmit={addRecipient}>
          <div className="field-stack">
            <label htmlFor="recipient-name">Nom</label>
            <input id="recipient-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Directeur, coordination…" />
          </div>
          <div className="field-stack">
            <label htmlFor="recipient-phone">Numéro WhatsApp</label>
            <input id="recipient-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+221 77 000 00 00" />
          </div>
          <div className="field-stack">
            <label htmlFor="recipient-scope">Profil</label>
            <select id="recipient-scope" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })}>
              <option value="internal">Interne (Teliman)</option>
              <option value="client">Client</option>
            </select>
          </div>
          {form.scope === 'client' ? (
            <div className="field-stack">
              <label htmlFor="recipient-client">Client</label>
              <input id="recipient-client" list="alert-routing-clients" value={form.clientName} onChange={(event) => setForm({ ...form, clientName: event.target.value })} placeholder="LAFARGE" />
              <datalist id="alert-routing-clients">
                {clients.map((client) => <option key={client} value={client} />)}
              </datalist>
            </div>
          ) : null}
          <button type="submit" className="primary-btn" disabled={busy || !form.name.trim() || !form.phone.trim()}>
            <Plus size={18} />
            Ajouter
          </button>
        </form>
      </section>

      {!loading && !state.recipients.length ? (
        <EmptyBanner message="Aucun destinataire pour l'instant : ajoutez-en un ci-dessus, puis cochez ce qu'il doit recevoir." />
      ) : null}

      {state.recipients.map((recipient) => {
        const custom = recipient.routing?.mode === 'custom'
        return (
          <section className="panel panel-large" key={recipient.id}>
            <div className="alert-routing-header">
              <div>
                <h2><BellRing size={20} /> {recipient.name || 'Sans nom'}</h2>
                <p className="muted">
                  {recipient.phone} · {recipient.scope === 'client' ? `Client ${recipient.clientName || '—'}` : 'Interne'}
                  {' · '}
                  <strong>{custom ? `${recipient.routing?.categories?.length || 0} réglage(s) personnalisé(s)` : 'Réglage par défaut'}</strong>
                </p>
              </div>
              <div className="alert-routing-actions">
                <button
                  type="button"
                  className="ghost-btn icon-btn"
                  title={recipient.active ? 'Désactiver ce destinataire' : 'Activer ce destinataire'}
                  onClick={() => guard(() => updateAlertRecipient(recipient.id, { active: !recipient.active }), recipient.active ? `${recipient.name} désactivé.` : `${recipient.name} activé.`)}
                  disabled={busy}
                >
                  <Power size={22} />
                </button>
                <button
                  type="button"
                  className="ghost-btn icon-btn"
                  title="Supprimer ce destinataire"
                  onClick={() => guard(() => deleteAlertRecipient(recipient.id), `${recipient.name} supprimé.`)}
                  disabled={busy}
                >
                  <Trash2 size={22} />
                </button>
              </div>
            </div>

            {!custom ? (
              <p className="muted">
                Par défaut, ce destinataire reçoit : {(recipient.routing?.categories || []).map((category) => category.label).join(', ') || '—'}.
                Cochez une ligne ci-dessous pour passer en contrôle total (il ne recevra plus que ce qui est coché).
              </p>
            ) : null}

            {state.groups.map((group) => {
              const categories = state.categories.filter((category) => category.group === group.key)
              if (!categories.length) return null
              return (
                <div className="alert-routing-group" key={group.key}>
                  <h3>{group.label}</h3>
                  <div className="alert-routing-grid">
                    {categories.map((category) => {
                      const current = subscriptionByKey.get(`${recipient.id}:${category.key}`)
                      const checked = Boolean(current)
                      const supportsScope = (category.scopes || []).length > 1
                      const sourceLabel = SCOPE_LABELS[category.scopeSource]
                      return (
                        <div className={`alert-routing-item ${checked ? 'is-on' : ''}`} key={category.key}>
                          <label className="alert-routing-toggle">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              onChange={() => toggleCategory(recipient, category)}
                            />
                            <span>{category.label}</span>
                          </label>
                          {checked && supportsScope && sourceLabel ? (
                            <select
                              aria-label={`Portée de ${category.label}`}
                              value={current.scopeType === 'all' ? '' : current.scopeValue}
                              disabled={busy}
                              onChange={(event) => {
                                const value = event.target.value
                                if (!value) changeScope(recipient, category, 'all', '')
                                else changeScope(recipient, category, sourceLabel.key, value)
                              }}
                            >
                              <option value="">{sourceLabel.all}</option>
                              {scopeOptions(category, { geofences, clients, trucks }).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}

      <section className="panel panel-large report-schedule-panel">
        <h2><Clock size={20} /> Heure d’envoi des rapports</h2>
        <p className="muted">
          Chaque type de rapport a sa propre heure : modifier le rapport quotidien ne touche pas l’hebdomadaire.
          Les numéros qui reçoivent un rapport sont ceux cochés pour sa catégorie dans le tableau ci-dessus
          {' '}({reportRecipientsCount} destinataire{reportRecipientsCount > 1 ? 's' : ''} pour le rapport quotidien).
        </p>
        <div className="report-schedule-grid">
          {reports.map((report) => (
            <article key={report.reportKey} className="report-schedule-card">
              <header>
                <div>
                  <strong>{report.label}</strong>
                  <small>{report.description}</small>
                </div>
                <label className="delivery-active-switch">
                  <span>
                    <strong>Actif</strong>
                    <small>{report.enabled ? report.scheduleLabel : 'désactivé'}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={report.enabled !== false}
                    disabled={reportBusy === report.reportKey}
                    onChange={(event) => saveReportSchedule(report.reportKey, { enabled: event.target.checked })}
                  />
                </label>
              </header>
              <div className="report-schedule-controls">
                <label className="field-stack">
                  <span>Heure d’envoi</span>
                  <input
                    type="time"
                    value={timeValueOf(report)}
                    disabled={reportBusy === report.reportKey}
                    onChange={(event) => setReportDrafts((current) => ({ ...current, [report.reportKey]: event.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={reportBusy === report.reportKey || !reportDrafts[report.reportKey]}
                  onClick={() => {
                    const [hour, minute] = String(reportDrafts[report.reportKey] || '').split(':')
                    return saveReportSchedule(report.reportKey, { hour: Number(hour), minute: Number(minute) })
                  }}
                >
                  Enregistrer l’heure
                </button>
                <button type="button" className="ghost-btn" disabled={reportBusy === report.reportKey} onClick={() => showPreview(report.reportKey)}>
                  <Eye size={18} /> Voir le contenu
                </button>
              </div>
            </article>
          ))}
          {!reports.length && <EmptyBanner message="Heures d’envoi indisponibles." />}
        </div>
        {preview && (
          <div className="report-preview">
            <div className="report-preview-head">
              <strong>Aperçu — {reports.find((report) => report.reportKey === preview.reportKey)?.label || preview.reportKey}</strong>
              <button type="button" className="ghost-btn" onClick={() => setPreview(null)}>Fermer</button>
            </div>
            <pre>{preview.text}</pre>
            <small className="muted">
              {preview.stats ? `${preview.stats.activeTrucks ?? preview.stats.trucks ?? 0} camion(s) · ${preview.stats.missions ?? 0} mission(s) · ${preview.text?.length ?? 0} caractères` : null}
              {preview.notes?.length ? ` · ${preview.notes.join(' · ')}` : ''}
            </small>
          </div>
        )}
      </section>

      <section className="panel panel-large">
        <h2><BellRing size={20} /> À savoir</h2>
        <ul className="muted">
          <li>Les contacts clients saisis dans <strong>Données → clientPhones</strong> continuent de recevoir les bornes de leurs missions : ce réglage s’ajoute, il ne les remplace pas.</li>
          <li>Un destinataire désactivé ne reçoit plus rien, quelles que soient ses cases cochées.</li>
          <li>Les rapports partent à l’heure choisie ci-dessus, avec les données réellement enregistrées (missions, passages de zone, kilométrage et temps de conduite Fleeti, bons carburant).</li>
        </ul>
      </section>
    </PageStack>
  )
}

export default AlertRoutingPage
