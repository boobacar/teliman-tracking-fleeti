import { useMemo, useState } from 'react'

export function TrackersPage({ filteredTrackers, setSelectedTrackerId }) {
  const [sortKey, setSortKey] = useState('events')

  const sortedTrackers = useMemo(() => {
    const items = [...filteredTrackers]
    if (sortKey === 'mileage') return items.sort((a, b) => b.latestDayMileage - a.latestDayMileage)
    if (sortKey === 'speed') return items.sort((a, b) => (b.state.gps?.speed ?? 0) - (a.state.gps?.speed ?? 0))
    return items.sort((a, b) => (b.events?.length || 0) - (a.events?.length || 0))
  }, [filteredTrackers, sortKey])

  return <section className="panel panel-large"><div className="panel-header"><div><h3>Trackers</h3><p>Inventaire exploitable avec lecture enrichie</p></div></div><div className="filters filter-row"><button className={`chip ${sortKey === 'events' ? 'selected' : ''}`} onClick={() => setSortKey('events')}>Tri alertes</button><button className={`chip ${sortKey === 'mileage' ? 'selected' : ''}`} onClick={() => setSortKey('mileage')}>Tri km</button><button className={`chip ${sortKey === 'speed' ? 'selected' : ''}`} onClick={() => setSortKey('speed')}>Tri vitesse</button></div><div className="tracker-table tracker-table-phase2">{sortedTrackers.map((tracker) => <button key={tracker.id} className="tracker-table-row tracker-table-row-rich" onClick={() => setSelectedTrackerId(tracker.id)}><div><strong>{tracker.label}</strong><small>{tracker.model}</small></div><div>{tracker.employeeName}</div><div>{tracker.state.connection_status}</div><div>{tracker.state.gps?.speed ?? 0} km/h</div><div>{tracker.latestDayMileage} km</div><div>{tracker.events.length} alertes</div><div>{tracker.eventCounts.speedup || 0} excès vitesse</div></button>)}</div></section>
}
