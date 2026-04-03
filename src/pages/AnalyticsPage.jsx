import { Activity, AlertTriangle, Gauge, Route } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, Line } from 'recharts'

export function AnalyticsPage({ filteredTrackers, importantEvents }) {
  const mileageData = filteredTrackers.map((tracker) => ({ name: tracker.label, mileage: tracker.latestDayMileage }))
  const riskData = filteredTrackers.map((tracker) => ({ name: tracker.label, risk: tracker.riskScore }))
  const speedData = filteredTrackers.map((tracker) => ({ name: tracker.label, speed: tracker.state?.gps?.speed ?? 0 }))

  const summary = [
    { icon: <Route size={16} />, label: 'Km moyens', value: Math.round(mileageData.reduce((a, x) => a + x.mileage, 0) / Math.max(mileageData.length, 1)) },
    { icon: <AlertTriangle size={16} />, label: 'Alertes visibles', value: importantEvents.length },
    { icon: <Gauge size={16} />, label: 'Vitesse max', value: Math.max(...speedData.map((x) => x.speed), 0) },
    { icon: <Activity size={16} />, label: 'Risque max', value: Math.max(...riskData.map((x) => x.risk), 0) },
  ]

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="analytics-summary-grid">
        {summary.map((item) => <div key={item.label} className="analytics-summary-card"><div className="stat-icon">{item.icon}</div><div><span>{item.label}</span><strong>{item.value}</strong></div></div>)}
      </section>

      <section className="dashboard-grid premium-grid phase2-grid">
        <div className="panel panel-large">
          <div className="panel-header"><div><h3>Analyse kilométrique</h3><p>Répartition des unités par activité</p></div></div>
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

        <div className="panel">
          <div className="panel-header"><div><h3>Analyse risque</h3><p>Score de risque par tracker</p></div></div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={riskData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
              <XAxis dataKey="name" stroke="#8da2c0" />
              <YAxis stroke="#8da2c0" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
              <Line type="monotone" dataKey="risk" stroke="#f59e0b" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Analyse vitesse</h3><p>Snapshot live des unités en circulation</p></div></div>
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
        <div className="panel"><div className="panel-header"><div><h3>Top trackers</h3><p>Les plus actifs aujourd’hui</p></div></div><div className="driver-ranking">{mileageData.sort((a,b) => b.mileage - a.mileage).slice(0,5).map((item, index) => <div key={item.name} className="driver-rank-row"><strong>#{index + 1}</strong><div><span>{item.name}</span><small>Kilométrage</small></div><div><span>{item.mileage} km</span><small>activité</small></div></div>)}</div></div>
        <div className="panel"><div className="panel-header"><div><h3>Top risque</h3><p>Les plus sensibles</p></div></div><div className="driver-ranking">{riskData.sort((a,b) => b.risk - a.risk).slice(0,5).map((item, index) => <div key={item.name} className="driver-rank-row"><strong>#{index + 1}</strong><div><span>{item.name}</span><small>Score de risque</small></div><div><span>{item.risk}</span><small>priorité</small></div></div>)}</div></div>
      </section>
    </div>
  )
}
