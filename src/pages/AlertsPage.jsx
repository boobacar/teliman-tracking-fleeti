import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export function AlertsPage({ importantEvents }) {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('all')

  const types = useMemo(() => ['all', ...new Set(importantEvents.map((event) => event.event))], [importantEvents])
  const filtered = useMemo(() => importantEvents.filter((event) => typeFilter === 'all' || event.event === typeFilter), [importantEvents, typeFilter])

  return <section className="panel panel-large"><div className="panel-header"><div><h3>Centre d’alertes</h3><p>Événements critiques et lecture rapide</p></div></div><div className="filters filter-row">{types.map((type) => <button key={type} className={`chip ${typeFilter === type ? 'selected' : ''}`} onClick={() => setTypeFilter(type)}>{type}</button>)}</div><div className="events-table">{filtered.slice(0, 30).map((event) => <button key={`${event.tracker_id}-${event.time}-${event.event}`} className="event-row event-button" onClick={() => navigate(`/tracker/${event.tracker_id}`)}><div><strong>{event.label || event.extra?.tracker_label}</strong></div><div>{event.event}</div><div>{event.chauffeur || event.extra?.employee_full_name || 'N/A'}</div><div>{event.message}</div><div>{event.address}</div><div>{new Date(event.time).toLocaleString()}</div></button>)}</div></section>
}
