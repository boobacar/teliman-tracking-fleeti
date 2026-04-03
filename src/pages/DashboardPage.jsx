import { Activity, Car, Gauge, Wifi, ShieldAlert, AlertTriangle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function StatCard({ icon, label, value, helper }) { return <div className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></div> }

export function DashboardPage({ filteredTrackers, stats, connectionChart, riskRanking, topDrivers, executiveCards }) {
  return <>
    <section className="stats-grid premium-stats phase2-stats">
      <StatCard icon={<Car size={18} />} label="Trackers" value={stats.total} helper="base flotte" />
      <StatCard icon={<Wifi size={18} />} label="Actifs" value={stats.active} helper="connectés live" />
      <StatCard icon={<Activity size={18} />} label="En mouvement" value={stats.moving} helper="terrain roulant" />
      <StatCard icon={<Gauge size={18} />} label="Vitesse moyenne" value={`${stats.avgSpeed} km/h`} helper="instantané" />
    </section>
    <section className="executive-grid">{executiveCards.map((card) => <div key={card.title} className="executive-card"><span>{card.title}</span><strong>{card.value}</strong><small>{card.helper}</small></div>)}</section>
    <section className="dashboard-grid premium-grid phase2-grid">
      <div className="panel panel-large"><div className="panel-header"><div><h3>Kilométrage du jour</h3><p>Classement des unités les plus actives</p></div></div><ResponsiveContainer width="100%" height={280}><BarChart data={filteredTrackers.map((t) => ({ name: t.label, mileage: t.latestDayMileage }))}><CartesianGrid strokeDasharray="3 3" stroke="#243042" /><XAxis dataKey="name" stroke="#8da2c0" /><YAxis stroke="#8da2c0" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /><Bar dataKey="mileage" fill="#3b82f6" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer></div>
      <div className="panel"><div className="panel-header"><div><h3>Répartition flotte</h3><p>Connectivité</p></div></div><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={connectionChart} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={4}>{connectionChart.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} /></PieChart></ResponsiveContainer></div>
    </section>
    <section className="dashboard-grid premium-grid phase2-grid">
      <div className="panel panel-large"><div className="panel-header"><div><h3>Top risques</h3><p>Trackers à surveiller en priorité</p></div></div><div className="alerts-list">{riskRanking.slice(0, 5).map((tracker) => <div key={tracker.id} className="alert-row"><div className="alert-icon"><ShieldAlert size={16} /></div><div><strong>{tracker.label}</strong><p>{tracker.employeeName}</p><span>Risque {tracker.riskScore} · Speedups {tracker.eventCounts.speedup || 0}</span></div></div>)}</div></div>
      <div className="panel"><div className="panel-header"><div><h3>Top chauffeurs</h3><p>Lecture exploitant</p></div></div><div className="driver-ranking">{topDrivers.map((driver, index) => <div key={`${driver.name}-${index}`} className="driver-rank-row"><strong>#{index + 1}</strong><div><span>{driver.name}</span><small>{driver.tracker}</small></div><div><span>{driver.mileage} km</span><small>Risque {driver.risk}</small></div></div>)}</div></div>
    </section>
  </>
}
