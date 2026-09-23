import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Plus, RefreshCw, Trash2, UserPlus, Power } from 'lucide-react'
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
  loadVehicles,
  updateAlertRecipient,
  updateAlertSubscription,
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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [routing, zones, master, vehicles] = await Promise.all([
        loadAlertRouting(),
        loadGeofences().catch(() => ({ geofences: [] })),
        loadMasterData().catch(() => ({})),
        loadVehicles().catch(() => ({ vehicles: [] })),
      ])
      setState({
        recipients: routing?.recipients || [],
        subscriptions: routing?.subscriptions || [],
        categories: routing?.categories || [],
        groups: routing?.groups || [],
      })
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
    // La portée fait partie de la clé d'unicité : on remplace la ligne.
    guard(async () => {
      await deleteAlertSubscription(existing.id)
      await createAlertSubscription({ recipientId: recipient.id, category: category.key, scopeType, scopeValue })
    })
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

      <section className="panel panel-large">
        <h2><BellRing size={20} /> À savoir</h2>
        <ul className="muted">
          <li>Les contacts clients saisis dans <strong>Données → clientPhones</strong> continuent de recevoir les bornes de leurs missions : ce réglage s’ajoute, il ne les remplace pas.</li>
          <li>Un destinataire désactivé ne reçoit plus rien, quelles que soient ses cases cochées.</li>
          <li>Les rapports quotidiens/hebdomadaires listés ici désignent leurs destinataires : la génération du rapport sera branchée à l’étape suivante.</li>
        </ul>
      </section>
    </PageStack>
  )
}

export default AlertRoutingPage
