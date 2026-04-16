import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

export function AlertsPage({ importantEvents }) {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [truckFilter, setTruckFilter] = useState('all')

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
          <button key={type} className={`chip ${typeFilter === type ? 'selected' : ''}`} onClick={() => setTypeFilter(type)}>
            {type === 'all' ? 'Toutes' : getAlertTypeLabel(type)}
          </button>
        ))}
      </div>

      <div className="filters filter-row">
        {['all', 'high', 'medium', 'normal'].map((level) => (
          <button key={level} className={`chip ${priorityFilter === level ? 'selected' : ''}`} onClick={() => setPriorityFilter(level)}>
            {getPriorityLabel(level)}
          </button>
        ))}
      </div>

      <div className="filters filter-row" style={{ marginTop: -6 }}>
        {truckTabs.map((truck) => (
          <button
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
                  <button
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
    </section>
  )
}
