export function DriversPage({ filteredTrackers }) {
  const rows = filteredTrackers

  return <section className="panel panel-large"><div className="panel-header"><div><h3>Chauffeurs</h3><p>Vue people + unité + activité</p></div></div><div className="tracker-table tracker-table-phase2">{rows.map((tracker) => <div key={tracker.id} className="tracker-table-row static-row tracker-table-row-rich"><div><strong>{tracker.employeeName}</strong><small>{tracker.employeePhone}</small></div><div>{tracker.label}</div><div>{tracker.latestDayMileage} km</div><div>{tracker.eventCounts.speedup || 0} excès vitesse</div><div>{tracker.eventCounts.excessive_parking || 0} arrêts prolongés</div><div>{tracker.events.length} alertes</div><div>{tracker.state.connection_status}</div></div>)}</div></section>
}
