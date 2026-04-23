import { Activity, Car, Gauge, Wifi, ShieldAlert, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function StatCard({ icon, label, value, helper }) { return <div className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }

export function DashboardPage({ filteredTrackers, stats, connectionChart, priorityTrackers, topDrivers, executiveCards, offlineTrackers, anomalyTrackers, filter, setFilter }) {
  return <>
    <section className="stats-grid premium-stats phase2-stats mobile-cards-grid">
      <StatCard icon={<Car size={18} />} label="Trackers" value={stats.total} helper="base flotte" />
      <StatCard icon={<Wifi size={18} />} label="Actifs" value={stats.active} helper="connectés live" />
      <StatCard icon={<Activity size={18} />} label="En mouvement" value={stats.moving} helper="terrain roulant" />
      <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${stats.avgSpeed} km/h`} helper="instantané" />
    </section>
    <section className="executive-grid mobile-cards-grid">{executiveCards.map((card) => <div key={card.title} className="executive-card"><span>{card.title}</span><strong>{card.value}</strong><small>{card.helper}</small></div>)}</section>
    <section className="dashboard-grid premium-grid phase2-grid">
      <div className="panel panel-large"><div className="panel-header"><div><h3>Kilométrage du jour</h3><p>Classement des unités les plus actives</p></div></div><div className="filters filter-row dashboard-mileage-filters">{['all', 'active', 'idle', 'offline'].map((value) => <button type="button" key={value} className={`chip ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>{value}</button>)}</div><ResponsiveContainer width="100%" height={280}><BarChart data={filteredTrackers.map((t) => ({ name: t.label, mileage: t.latestDayMileage }))}><CartesianGrid strokeDasharray="3 3" stroke="#243042" /><XAxis dataKey="name" stroke="#8da2c0" /><YAxis stroke="#8da2c0" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /><Bar dataKey="mileage" fill="#3b82f6" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
      <div className="panel"><div className="panel-header"><div><h3>Répartition flotte</h3><p>Connectivité</p></div></div><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={connectionChart} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={4}>{connectionChart.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /></PieChart></ResponsiveContainer></div>
    </section>
    <section className="dashboard-grid premium-grid phase2-grid">
      <div className="panel panel-large"><div className="panel-header"><div><h3>Camions à surveiller en priorité</h3><p>Classement par nombre d’alertes détectées</p></div></div><div className="alerts-list">{priorityTrackers.slice(0, 5).map((tracker) => <div key={tracker.id} className="alert-row"><div className="alert-icon"><ShieldAlert size={16} /></div><div><strong>{tracker.label}</strong><p>{tracker.employeeName}</p><span>{tracker.events.length} événements · {tracker.eventCounts.speedup || 0} excès de vitesse</span></div></div>)}</div></div>
      <div className="panel"><div className="panel-header"><div><h3>Chauffeurs les plus actifs</h3><p>Classement par kilométrage du jour</p></div></div><div className="driver-ranking">{topDrivers.map((driver, index) => <div key={`${driver.name}-${index}`} className="driver-rank-row"><strong>#{index + 1}</strong><div><span>{driver.name}</span><small>{driver.tracker}</small></div><div><span>{driver.mileage} km</span><small>{driver.events} événements</small></div></div>)}</div></div>
    </section>
    <section className="dashboard-grid premium-grid phase2-grid">
      <div className="panel"><div className="panel-header"><div><h3>Unités offline</h3><p>À vérifier rapidement</p></div><Link className="ghost-btn" to="/trackers">Voir les trackers</Link></div><div className="alerts-list">{offlineTrackers.slice(0,5).map((tracker) => <Link key={tracker.id} className="alert-row link-row" to={`/tracker/${tracker.id}`}><div className="alert-icon"><AlertTriangle size={16} /></div><div><strong>{tracker.label}</strong><p>{tracker.employeeName}</p><span>Batterie {tracker.state?.battery_level ?? '-'}% · Dernière MàJ {tracker.state?.last_update ? new Date(tracker.state.last_update).toLocaleString() : '-'}</span></div></Link>)}</div></div>
      <div className="panel"><div className="panel-header"><div><h3>Anomalies terrain</h3><p>Unités avec signaux à surveiller</p></div><Link className="ghost-btn" to="/analytics">Voir analytics</Link></div><div className="alerts-list">{anomalyTrackers.slice(0,5).map((tracker) => <Link key={tracker.id} className="alert-row link-row" to={`/tracker/${tracker.id}`}><div className="alert-icon"><Activity size={16} /></div><div><strong>{tracker.label}</strong><p>{tracker.employeeName}</p><span>{tracker.events.length} événements détectés</span></div></Link>)}</div></div>
    </section>
  </>
}
