import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, CheckCheck, Clock, History, Loader2, RotateCcw, Shield, Activity, User } from 'lucide-react'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { loadAlerts, loadRulesDetail, resetAlertAction, updateAlertAction } from '../lib/fleeti'
import { Pagination } from '../components/Pagination'

function getAlertTypeLabel(eventType) {
  const map = {
    speedup: 'Excès de vitesse',
    fuel_level_leap: 'Variation carburant',
    excessive_parking: 'Stationnement prolongé',
    crash_alarm: 'Accident',
    geofence_enter: 'Entrée en zone',
    geofence_exit: 'Sortie de zone',
  }
  return map[eventType] || String(eventType || 'Alerte').replace(/_/g, ' ')
}

const STATUS_LABELS = {
  new: 'Nouvelle',
  acknowledged: 'Reconnue',
  processing: 'En traitement',
  resolved: 'Résolue',
}

const PRIORITY_LABELS = {
  low: 'Basse',
  normal: 'Standard',
  medium: 'Surveillance',
  high: 'Critique',
  critical: 'Critique +',
}

function getRuleTypeLabel(ruleType) {
  const map = {
    speedup: 'Excès de vitesse',
    excessive_parking: 'Stationnement',
    fuel_level_leap: 'Carburant',
    crash_alarm: 'Accident',
  }
  return map[ruleType] || String(ruleType || 'Inconnu').replace(/_/g, ' ')
}

export function AlertsPage({ importantEvents }) {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [truckFilter, setTruckFilter] = useState('all')
  const [alertPage, setAlertPage] = useState(1)
  const [expandedKey, setExpandedKey] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  const [actionError, setActionError] = useState('')
  const [rules, setRules] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)

  async function refreshAlerts() {
    setLoading(true)
    try {
      const data = await loadAlerts()
      setAlerts(data?.alerts || [])
    } catch {
      // Repli sur les événements déjà chargés par l'application
      setAlerts((importantEvents || []).map((event) => ({ ...event, key: `${event.tracker_id}-${event.time}-${event.event}`, status: 'new' })))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadRules() {
      setRulesLoading(true)
      try {
        const data = await loadRulesDetail()
        if (!cancelled) setRules(data?.rules || data?.items || [])
      } catch {
        // silent
      } finally {
        if (!cancelled) setRulesLoading(false)
      }
    }
    loadRules()
    void refreshAlerts()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const types = useMemo(() => ['all', ...new Set(alerts.map((alert) => alert.event))], [alerts])

  const truckTabs = useMemo(() => {
    const map = new Map()
    alerts.forEach((alert) => {
      const trackerId = String(alert.tracker_id || alert.trackerId || 'unknown')
      const truckLabel = alert.label || alert.extra?.tracker_label || `Camion ${trackerId}`
      if (!map.has(trackerId)) map.set(trackerId, truckLabel)
    })
    return [{ id: 'all', label: 'Tous les camions' }, ...Array.from(map.entries()).map(([id, label]) => ({ id, label }))]
  }, [alerts])

  const statusCounts = useMemo(() => {
    const counts = { new: 0, acknowledged: 0, processing: 0, resolved: 0 }
    alerts.forEach((alert) => { counts[alert.status] = (counts[alert.status] || 0) + 1 })
    return counts
  }, [alerts])

  const filtered = useMemo(
    () => alerts.filter((alert) => {
      const trackerId = String(alert.tracker_id || alert.trackerId || 'unknown')
      const matchesTruck = truckFilter === 'all' || trackerId === truckFilter
      const matchesType = typeFilter === 'all' || alert.event === typeFilter
      const matchesPriority = priorityFilter === 'all' || alert.effectivePriority === priorityFilter
      const matchesStatus = statusFilter === 'all' || alert.status === statusFilter
      return matchesTruck && matchesType && matchesPriority && matchesStatus
    }),
    [alerts, truckFilter, typeFilter, priorityFilter, statusFilter],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      const order = { new: 0, acknowledged: 1, processing: 2, resolved: 3 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9)
        || new Date(b.time || 0) - new Date(a.time || 0)
    }),
    [filtered],
  )

  const alertTotalPages = Math.max(1, Math.ceil(sorted.length / 8))
  const safeAlertPage = Math.min(alertPage, alertTotalPages)
  const visibleAlerts = sorted.slice((safeAlertPage - 1) * 8, safeAlertPage * 8)

  function toggleExpand(alert) {
    setExpandedKey((prev) => (prev === alert.key ? null : alert.key))
    if (drafts[alert.key] === undefined) {
      setDrafts((prev) => ({
        ...prev,
        [alert.key]: { status: alert.status, priority: alert.effectivePriority, assignedTo: alert.assignedTo || '', comment: alert.comment || '' },
      }))
    }
  }

  function updateDraft(key, field, value) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  async function saveAlert(alert) {
    const draft = drafts[alert.key]
    if (!draft) return
    setSavingKey(alert.key)
    setActionError('')
    try {
      await updateAlertAction(alert.key, {
        status: draft.status,
        priority: draft.priority,
        assignedTo: draft.assignedTo,
        comment: draft.comment,
      })
      await refreshAlerts()
    } catch (error) {
      setActionError(error?.message || 'Enregistrement impossible.')
    } finally {
      setSavingKey(null)
    }
  }

  async function quickStatus(alert, status) {
    setSavingKey(alert.key)
    setActionError('')
    try {
      await updateAlertAction(alert.key, { status })
      await refreshAlerts()
    } catch (error) {
      setActionError(error?.message || 'Action impossible.')
    } finally {
      setSavingKey(null)
    }
  }

  async function resetAlert(alert) {
    setSavingKey(alert.key)
    setActionError('')
    try {
      await resetAlertAction(alert.key)
      await refreshAlerts()
    } catch (error) {
      setActionError(error?.message || 'Réinitialisation impossible.')
    } finally {
      setSavingKey(null)
    }
  }

  const rulesStats = useMemo(() => {
    const active = rules.filter((r) => r.status !== 'suspended').length
    const suspended = rules.filter((r) => r.status === 'suspended').length
    const types = new Set(rules.map((r) => r.type || r.rule_type || '')).size
    return { active, suspended, types }
  }, [rules])

  return (
    <PageStack className="ops-page-stack">
      <h1 className="visually-hidden">Centre d’alertes</h1>
      <section className="panel panel-large delivery-hero-panel">
        <SectionHeader
          title="Centre d'alertes"
          description="Cycle de vie : nouvelle → reconnue → en traitement → résolue"
        />

        {actionError && <div className="error-banner" role="alert">{actionError}</div>}

        <div className="filters filter-row">
          {[{ id: 'all', label: `Toutes (${alerts.length})` }, ...Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label: `${label} (${statusCounts[id] || 0})` }))].map((item) => (
            <button type="button" key={item.id} aria-pressed={statusFilter === item.id} className={`chip ${statusFilter === item.id ? 'selected' : ''}`} onClick={() => { setStatusFilter(item.id); setAlertPage(1) }}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="filters filter-row">
          {types.map((type) => (
            <button type="button" key={type} aria-pressed={typeFilter === type} className={`chip ${typeFilter === type ? 'selected' : ''}`} onClick={() => { setTypeFilter(type); setAlertPage(1) }}>
              {type === 'all' ? 'Toutes' : getAlertTypeLabel(type)}
            </button>
          ))}
        </div>

        <div className="filters filter-row">
          {['all', 'high', 'medium', 'normal'].map((level) => (
            <button type="button" key={level} aria-pressed={priorityFilter === level} className={`chip ${priorityFilter === level ? 'selected' : ''}`} onClick={() => { setPriorityFilter(level); setAlertPage(1) }}>
              {level === 'all' ? 'Toutes priorités' : PRIORITY_LABELS[level] || level}
            </button>
          ))}
        </div>

        <div className="filters filter-row">
          {truckTabs.map((truck) => (
            <button type="button"
              key={truck.id}
              aria-pressed={truckFilter === truck.id}
              className={`chip ${truckFilter === truck.id ? 'selected' : ''}`}
              onClick={() => { setTruckFilter(truck.id); setAlertPage(1) }}
              title={truck.label}
            >
              {truck.label}
            </button>
          ))}
        </div>

        {loading && <p className="loading-banner">Chargement des alertes…</p>}
        {!loading && visibleAlerts.length === 0 && <div className="empty-banner">Aucune alerte pour ces filtres.</div>}

        <div style={{ display: 'grid', gap: 14 }}>
          {visibleAlerts.map((alert) => {
            const expanded = expandedKey === alert.key
            const draft = drafts[alert.key]
            const trackerId = String(alert.tracker_id || alert.trackerId || 'unknown')
            const truckLabel = alert.label || alert.extra?.tracker_label || `Camion ${trackerId}`
            return (
              <article key={alert.key} className={`panel alert-lifecycle-card status-${alert.status} ${alert.escalated ? 'escalated' : ''}`}>
                <div className="alert-card-main" role="button" tabIndex={0} onClick={() => toggleExpand(alert)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleExpand(alert) }}>
                  <div className="alert-status-badge"><span className={`status-dot status-${alert.status}`}></span><strong>{STATUS_LABELS[alert.status] || alert.status}</strong>{alert.escalated && <em className="alert-escalated-badge" title="Non traitée depuis plus de 24 h">⚠ Escaladée</em>}</div>
                  <div className="alert-type-cell"><strong>{getAlertTypeLabel(alert.event)}</strong><small>{alert.message || ''}</small></div>
                  <div className="alert-driver-cell"><strong>{truckLabel}</strong><small>{alert.chauffeur || alert.extra?.employee_full_name || 'N/A'}</small></div>
                  <div className="alert-priority-cell"><span className={`priority-chip priority-${alert.effectivePriority}`}>{PRIORITY_LABELS[alert.effectivePriority] || alert.effectivePriority}</span></div>
                  <div className="alert-time-cell">{new Date(alert.time || 0).toLocaleString()}</div>
                </div>

                {expanded && draft && (
                  <div className="alert-action-panel">
                    <div className="alert-action-row">
                      <label className="alert-action-field">
                        <span>Statut</span>
                        <select value={draft.status} onChange={(event) => updateDraft(alert.key, 'status', event.target.value)} aria-label="Statut de l'alerte">
                          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="alert-action-field">
                        <span>Priorité</span>
                        <select value={draft.priority} onChange={(event) => updateDraft(alert.key, 'priority', event.target.value)} aria-label="Priorité de l'alerte">
                          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="alert-action-field">
                        <span><User size={12} aria-hidden="true" /> Responsable</span>
                        <input value={draft.assignedTo} onChange={(event) => updateDraft(alert.key, 'assignedTo', event.target.value)} placeholder="Qui traite ?" aria-label="Responsable assigné" />
                      </label>
                    </div>
                    <label className="alert-action-field alert-comment-field">
                      <span>Commentaire d'exploitation</span>
                      <textarea value={draft.comment} onChange={(event) => updateDraft(alert.key, 'comment', event.target.value)} placeholder="Contexte, décision prise…" rows={2} aria-label="Commentaire d'exploitation" />
                    </label>
                    <div className="alert-action-buttons">
                      <button type="button" className="ghost-btn" onClick={() => quickStatus(alert, 'acknowledged')} disabled={savingKey === alert.key}><CheckCheck size={15} />Reconnaître</button>
                      <button type="button" className="ghost-btn" onClick={() => quickStatus(alert, 'processing')} disabled={savingKey === alert.key}><Clock size={15} />Prendre en charge</button>
                      <button type="button" className="ghost-btn" onClick={() => quickStatus(alert, 'resolved')} disabled={savingKey === alert.key}><CheckCircle size={15} />Résoudre</button>
                      <button type="button" className="ghost-btn primary-btn" onClick={() => saveAlert(alert)} disabled={savingKey === alert.key}>{savingKey === alert.key ? <Loader2 size={15} className="spin" /> : <Shield size={15} />}Enregistrer</button>
                      {alert.status !== 'new' && <button type="button" className="ghost-btn" onClick={() => resetAlert(alert)} disabled={savingKey === alert.key} title="Revenir à « Nouvelle »"><RotateCcw size={15} />Réinitialiser</button>}
                    </div>
                    <div className="alert-meta-row">
                      <button type="button" className="ghost-btn small-btn" onClick={() => navigate(`/tracker/${trackerId}`)}><Activity size={14} />Fiche camion</button>
                      {alert.acknowledgedAt && <span>Prise en charge : {new Date(alert.acknowledgedAt).toLocaleString()}</span>}
                      {alert.resolvedAt && <span>Résolue : {new Date(alert.resolvedAt).toLocaleString()}</span>}
                    </div>
                    {alert.actionHistory?.length > 0 && (
                      <div className="alert-history">
                        <h4><History size={13} aria-hidden="true" /> Historique des actions</h4>
                        <ul>{alert.actionHistory.slice(-5).map((entry, index) => (
                          <li key={index}><span>{new Date(entry.at).toLocaleString()}</span>{entry.changes}</li>
                        ))}</ul>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
        <Pagination page={safeAlertPage} totalPages={alertTotalPages} total={sorted.length} onPageChange={setAlertPage} />
      </section>

      {/* Règles d'alertes Fleeti */}
      <section className="panel panel-large delivery-table-panel">
        <SectionHeader
          title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Shield size={18} style={{ color: '#f59e0b' }} />Règles d'alertes Fleeti</span>}
          description="Configuration des règles d'alertes automatiques"
        />

        <div className="mission-highlight-grid compact-mission-grid" style={{ marginBottom: 14 }}>
          <div className="mission-highlight-card">
            <span><CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#22c55e' }} />Actives</span>
            <strong style={{ color: '#22c55e' }}>{rulesStats.active}</strong>
            <small>règles actives</small>
          </div>
          <div className="mission-highlight-card">
            <span><AlertTriangle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#f59e0b' }} />Suspendues</span>
            <strong style={{ color: rulesStats.suspended > 0 ? '#f59e0b' : undefined }}>{rulesStats.suspended}</strong>
            <small>règles suspendues</small>
          </div>
          <div className="mission-highlight-card">
            <span><Activity size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: '#3b82f6' }} />Types</span>
            <strong>{rulesStats.types}</strong>
            <small>types d'alertes</small>
          </div>
          <div className="mission-highlight-card">
            <span><Shield size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Total</span>
            <strong>{rules.length}</strong>
            <small>règles configurées</small>
          </div>
        </div>

        <div className="reports-table-wrap">
          <table className="reports-table">
            <caption>Règles d’alertes Fleeti</caption>
            <thead>
              <tr>
                <th scope="col">Nom de la règle</th>
                <th scope="col">Type</th>
                <th scope="col">Statut</th>
                <th scope="col">Trackers concernés</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const ruleType = rule.type || rule.rule_type || ''
                const ruleName = rule.name || rule.label || `Règle ${i + 1}`
                const isActive = rule.status !== 'suspended'
                const trackers = rule.trackers || rule.tracker_ids || []
                const trackerList = Array.isArray(trackers) ? trackers.join(', ') : String(trackers || 'Tous')
                return (
                  <tr key={rule.id || i}>
                    <td><strong>{ruleName}</strong></td>
                    <td>{getRuleTypeLabel(ruleType)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: isActive ? '#22c55e' : '#f59e0b' }}>
                        {isActive ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                        {isActive ? 'Actif' : 'Suspendu'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={trackerList}>
                      {trackerList || 'Tous'}
                    </td>
                  </tr>
                )
              })}
              {rules.length === 0 && (
                <tr><td colSpan={4} className="table-empty-cell">Chargement des règles…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-alert-rules-list" aria-label="Règles d'alertes Fleeti">
          {rules.map((rule, i) => {
            const ruleType = rule.type || rule.rule_type || ''
            const ruleName = rule.name || rule.label || `Règle ${i + 1}`
            const isActive = rule.status !== 'suspended'
            const trackers = rule.trackers || rule.tracker_ids || []
            const trackerList = Array.isArray(trackers) ? trackers.join(', ') : String(trackers || 'Tous')
            return (
              <article className="mobile-data-card" key={`mobile-rule-${rule.id || i}`}>
                <header><strong>{ruleName}</strong><span>{isActive ? 'Actif' : 'Suspendu'}</span></header>
                <dl>
                  <div><dt>Type</dt><dd>{getRuleTypeLabel(ruleType)}</dd></div>
                  <div><dt>Trackers</dt><dd>{trackerList || 'Tous'}</dd></div>
                </dl>
              </article>
            )
          })}
          {rulesLoading && <p className="loading-banner">Chargement des règles…</p>}
          {!rulesLoading && rules.length === 0 && <p className="empty-banner">Aucune règle configurée.</p>}
        </div>
      </section>
    </PageStack>
  )
}
