import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function AlertsPage({ importantEvents }) {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const types = useMemo(() => ['all', ...new Set(importantEvents.map((event) => event.event))], [importantEvents])
  const filtered = useMemo(() => importantEvents.filter((event) => {
    const matchesType = typeFilter === 'all' || event.event === typeFilter
    const priority = event.event === 'speedup' ? 'high' : event.event === 'fuel_level_leap' ? 'medium' : 'normal'
    const matchesPriority = priorityFilter === 'all' || priority === priorityFilter
    return matchesType && matchesPriority
  }), [importantEvents, typeFilter, priorityFilter])

  return <section className="panel panel-large"><div className="panel-header"><div><h3>Centre d’alertes</h3><p>Événements critiques et lecture rapide</p></div></div><div className="filters filter-row">{types.map((type) => <button key={type} className={`chip ${typeFilter === type ? 'selected' : ''}`} onClick={() => setTypeFilter(type)}>{type}</button>)}</div><div className="filters filter-row">{['all', 'high', 'medium', 'normal'].map((level) => <button key={level} className={`chip ${priorityFilter === level ? 'selected' : ''}`} onClick={() => setPriorityFilter(level)}>{level}</button>)}</div><div className="events-table">{filtered.slice(0, 30).map((event) => { const priority = event.event === 'speedup' ? 'high' : event.event === 'fuel_level_leap' ? 'medium' : 'normal'; return <button key={`${event.tracker_id}-${event.time}-${event.event}`} className={`event-row event-button priority-${priority}`} onClick={() => navigate(`/tracker/${event.tracker_id}`)}><div><strong>{event.label || event.extra?.tracker_label}</strong></div><div>{event.event}</div><div>{event.chauffeur || event.extra?.employee_full_name || 'N/A'}</div><div>{event.message}</div><div>{event.address}</div><div>{new Date(event.time).toLocaleString()}</div></button>})}</div></section>
}
