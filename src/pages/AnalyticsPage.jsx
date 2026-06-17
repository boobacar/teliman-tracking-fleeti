import { Activity, AlertTriangle, Gauge, Route } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageStack, SectionHeader } from '../components/UIPrimitives'

export function AnalyticsPage({ filteredTrackers, importantEvents }) {
  const mileageData = filteredTrackers.map((tracker) => ({ name: tracker.label, mileage: tracker.latestDayMileage }))
  const alertCountData = filteredTrackers.map((tracker) => ({ name: tracker.label, alerts: tracker.events.length }))
  const speedData = filteredTrackers.map((tracker) => ({ name: tracker.label, speed: tracker.state?.gps?.speed ?? 0 }))
  const statusData = [
    { name: 'Active', value: filteredTrackers.filter((tracker) => tracker.state?.connection_status === 'active').length },
    { name: 'Idle', value: filteredTrackers.filter((tracker) => tracker.state?.connection_status === 'idle').length },
    { name: 'Offline', value: filteredTrackers.filter((tracker) => tracker.state?.connection_status === 'offline').length },
  ]
  const anomalyData = filteredTrackers
    .map((tracker) => ({ name: tracker.label, anomalies: tracker.events.length }))
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 5)

  const summary = [
    { icon: <Route size={16} />, label: 'Km moyens', value: Math.round(mileageData.reduce((a, x) => a + x.mileage, 0) / Math.max(mileageData.length, 1)) },
    { icon: <AlertTriangle size={16} />, label: 'Alertes visibles', value: importantEvents.length },
    { icon: <Gauge size={16} />, label: 'Vitesse max', value: Math.max(...speedData.map((x) => x.speed), 0) },
    { icon: <Activity size={16} />, label: 'Événements max', value: Math.max(...alertCountData.map((x) => x.alerts), 0) },
  ]

  return (
    <PageStack className="ops-page-stack">
      <SectionHeader title="Analyse de la flotte" description="Indicateurs clés et performances" />

      <section className="panel panel-large delivery-hero-panel">
        <div className="analytics-summary-grid">
          {summary.map((item) => <div key={item.label} className="analytics-summary-card"><div className="stat-icon">{item.icon}</div><div><span>{item.label}</span><strong>{item.value}</strong></div></div>)}
        </div>
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel panel-large">
          <SectionHeader title="Analyse kilométrique" description="Répartition des unités par activité" />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mileageData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
              <XAxis dataKey="name" stroke="#8da2c0" />
              <YAxis stroke="#8da2c0" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              <Bar dataKey="mileage" fill="#3b82f6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel panel-large">
          <SectionHeader title="Analyse alertes" description="Nombre d'événements par tracker" />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={alertCountData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
              <XAxis dataKey="name" stroke="#8da2c0" />
              <YAxis stroke="#8da2c0" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              <Bar dataKey="alerts" fill="#f59e0b" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel panel-large delivery-table-panel">
        <SectionHeader title="Analyse vitesse" description="Snapshot live des unités en circulation" />
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={speedData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
            <XAxis dataKey="name" stroke="#8da2c0" />
            <YAxis stroke="#8da2c0" />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
            <Bar dataKey="speed" fill="#22c55e" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel panel-large">
          <SectionHeader title="Top trackers" description="Les plus actifs aujourd'hui" />
          <div className="driver-ranking">{mileageData.sort((a,b) => b.mileage - a.mileage).slice(0,5).map((item, index) => <Link key={item.name} className="driver-rank-row link-row" to="/trackers"><strong>#{index + 1}</strong><div><span>{item.name}</span><small>Kilométrage</small></div><div><span>{item.mileage} km</span><small>activité</small></div></Link>)}</div>
        </div>
        <div className="panel panel-large">
          <SectionHeader title="Top alertes" description="Trackers avec le plus d'événements" />
          <div className="driver-ranking">{alertCountData.sort((a,b) => b.alerts - a.alerts).slice(0,5).map((item, index) => <Link key={item.name} className="driver-rank-row link-row" to="/trackers"><strong>#{index + 1}</strong><div><span>{item.name}</span><small>Événements détectés</small></div><div><span>{item.alerts}</span><small>priorité terrain</small></div></Link>)}</div>
        </div>
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel panel-large">
          <SectionHeader title="Répartition statuts" description="Vue synthétique de connectivité" />
          <div className="driver-ranking">{statusData.map((item) => <div key={item.name} className="driver-rank-row static-row"><strong>{item.value}</strong><div><span>{item.name}</span><small>statut flotte</small></div></div>)}</div>
        </div>
        <div className="panel panel-large">
          <SectionHeader title="Top anomalies" description="Unités avec le plus d'événements" />
          <div className="driver-ranking">{anomalyData.map((item, index) => <Link key={item.name} className="driver-rank-row link-row" to="/trackers"><strong>#{index + 1}</strong><div><span>{item.name}</span><small>événements</small></div><div><span>{item.anomalies}</span><small>activité anormale</small></div></Link>)}</div>
        </div>
      </section>
    </PageStack>
  )
}
