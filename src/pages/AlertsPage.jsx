import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Shield, Activity } from 'lucide-react'
import { loadRulesDetail } from '../lib/fleeti'

function getPriority(eventType) {
  if (eventType === 'speedup') return 'high'
  if (eventType === 'fuel_level_leap') return 'medium'
  return 'normal'
}

function getAlertTypeLabel(eventType) {
  if (eventType === 'speedup') return 'Excès de vitesse'
  if (eventType === 'fuel_level_leap') return 'Variation carburant'
  if (eventType === 'excessive_parking') return 'Stationnement prolongé'
  return String(eventType || 'Alerte')
}

function getPriorityLabel(level) {
  if (level === 'high') return 'Critique'
  if (level === 'medium') return 'Surveillance'
  if (level === 'normal') return 'Standard'
  return 'Toutes'
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
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [truckFilter, setTruckFilter] = useState('all')
  const [rules, setRules] = useState([])
  const [rulesLoading, setRulesLoading] = useState(false)

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
    return () => { cancelled = true }
  }, [])

  const types = useMemo(() => ['all', ...new Set(importantEvents.map((event) => event.event))], [importantEvents])

  const truckTabs = useMemo(() => {
    const map = new Map()
    importantEvents.forEach((event) => {
      const trackerId = String(event.tracker_id || event.trackerId || 'unknown')
      const truckLabel = event.label || event.extra?.tracker_label || `Camion ${trackerId}`
      if (!map.has(trackerId)) map.set(trackerId, truckLabel)
    })
    return [{ id: 'all', label: 'Tous les camions' }, ...Array.from(map.entries()).map(([id, label]) => ({ id, label }))]
  }, [importantEvents])

  const filtered = useMemo(
    () =>
      importantEvents.filter((event) => {
        const trackerId = String(event.tracker_id || event.trackerId || 'unknown')
        const matchesTruck = truckFilter === 'all' || trackerId === truckFilter
        const matchesType = typeFilter === 'all' || event.event === typeFilter
        const priority = getPriority(event.event)
        const matchesPriority = priorityFilter === 'all' || priority === priorityFilter
        return matchesTruck && matchesType && matchesPriority
      }),
    [importantEvents, truckFilter, typeFilter, priorityFilter],
  )

  const groupedByTruck = useMemo(() => {
    const groups = new Map()

    filtered.forEach((event) => {
      const trackerId = String(event.tracker_id || event.trackerId || 'unknown')
      const truckLabel = event.label || event.extra?.tracker_label || `Camion ${trackerId}`
      const key = `${trackerId}::${truckLabel}`

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          trackerId,
          truckLabel,
          events: [],
        })
      }

      groups.get(key).events.push(event)
    })

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        events: group.events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
      }))
      .sort((a, b) => b.events.length - a.events.length)
  }, [filtered])

  const rulesStats = useMemo(() => {
    const active = rules.filter((r) => r.status !== 'suspended').length
    const suspended = rules.filter((r) => r.status === 'suspended').length
    const types = new Set(rules.map((r) => r.type || r.rule_type || '')).size
    return { active, suspended, types }
  }, [rules])

  return (
    <section className="panel panel-large">
      <div className="panel-header">
        <div>
          <h3>Centre d’alertes</h3>
          <p>Événements critiques groupés par camion</p>
        </div>
      </div>

      <div className="filters filter-row">
        {types.map((type) => (
          <button type="button" key={type} className={`chip ${typeFilter === type ? 'selected' : ''}`} onClick={() => setTypeFilter(type)}>
            {type === 'all' ? 'Toutes' : getAlertTypeLabel(type)}
          </button>
        ))}
      </div>

      <div className="filters filter-row">
        {['all', 'high', 'medium', 'normal'].map((level) => (
          <button type="button" key={level} className={`chip ${priorityFilter === level ? 'selected' : ''}`} onClick={() => setPriorityFilter(level)}>
            {getPriorityLabel(level)}
          </button>
        ))}
      </div>

      <div className="filters filter-row" style={{ marginTop: -6 }}>
        {truckTabs.map((truck) => (
          <button type="button"
            key={truck.id}
            className={`chip ${truckFilter === truck.id ? 'selected' : ''}`}
            onClick={() => setTruckFilter(truck.id)}
            title={truck.label}
          >
            {truck.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {groupedByTruck.slice(0, 20).map((group) => (
          <div key={group.key} className="panel" style={{ padding: 12, borderRadius: 14 }}>
            <div className="panel-header" style={{ marginBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>{group.truckLabel}</h3>
                <p style={{ margin: 0 }}>{group.events.length} alertes</p>
              </div>
            </div>

            <div className="events-table">
              {group.events.slice(0, 10).map((event) => {
                const priority = getPriority(event.event)
                return (
                  <button type="button"
                    key={`${event.tracker_id}-${event.time}-${event.event}`}
                    className={`event-row event-button priority-${priority}`}
                    onClick={() => navigate(`/tracker/${event.tracker_id}`)}
                  >
                    <div className="event-type-cell"><strong>{getAlertTypeLabel(event.event)}</strong></div>
                    <div className="event-driver-cell">{event.chauffeur || event.extra?.employee_full_name || 'N/A'}</div>
                    <div>{event.message || getAlertTypeLabel(event.event)}</div>
                    <div>{event.address}</div>
                    <div>{new Date(event.time).toLocaleString()}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Règles d'alertes Fleeti */}
      <section className="panel panel-large delivery-table-panel" style={{ marginTop: 14 }}>
        <div className="panel-header">
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={18} style={{ color: '#f59e0b' }} />
              Règles d'alertes Fleeti
            </h3>
            <p>Configuration des règles d'alertes automatiques</p>
          </div>
        </div>

        {/* Mini KPIs */}
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

        {/* Tableau des règles */}
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Nom de la règle</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Trackers concernés</th>
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
      </section>
    </section>
  )
}
