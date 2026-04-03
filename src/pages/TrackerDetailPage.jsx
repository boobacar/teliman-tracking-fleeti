import { AlertTriangle, Battery, Gauge, MapPin, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function TrackerDetailPage({ selectedTracker }) {
  if (!selectedTracker) return <section className="panel"><p>Aucune unité sélectionnée.</p></section>

  return <section className="panel panel-large"><div className="panel-header"><div><h3>Détail tracker avancé</h3><p>Vue approfondie de l’unité sélectionnée</p></div></div>
    <div className="tracker-detail-grid">
      <div className="detail-grid">
        <div className="detail-item"><div className="detail-icon"><Users size={16} /></div><div><span>Chauffeur</span><strong>{selectedTracker.employeeName}</strong></div></div>
        <div className="detail-item"><div className="detail-icon"><MapPin size={16} /></div><div><span>Position</span><strong>{`${selectedTracker.state?.gps?.location?.lat ?? '-'}, ${selectedTracker.state?.gps?.location?.lng ?? '-'}`}</strong></div></div>
        <div className="detail-item"><div className="detail-icon"><Battery size={16} /></div><div><span>Batterie</span><strong>{`${selectedTracker.state?.battery_level ?? '-'}%`}</strong></div></div>
        <div className="detail-item"><div className="detail-icon"><Gauge size={16} /></div><div><span>Vitesse</span><strong>{`${selectedTracker.state?.gps?.speed ?? 0} km/h`}</strong></div></div>
      </div>
      <div className="mini-chart-wrap">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={Object.entries(selectedTracker.mileage).map(([day, value]) => ({ day, mileage: value?.mileage ?? 0 }))}>
            <defs><linearGradient id="trackerDetailFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0.05} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#243042" />
            <XAxis dataKey="day" stroke="#8da2c0" /><YAxis stroke="#8da2c0" />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #243042', borderRadius: 12 }} />
            <Area type="monotone" dataKey="mileage" stroke="#60a5fa" fill="url(#trackerDetailFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>

    <div className="panel-header" style={{ marginTop: 24 }}><div><h3>Timeline d’événements</h3><p>Historique récent de l’unité</p></div></div>
    <div className="timeline-list">
      {selectedTracker.events.slice(0, 12).map((event) => (
        <div key={`${event.time}-${event.event}`} className="timeline-row">
          <div className="timeline-icon"><AlertTriangle size={14} /></div>
          <div>
            <strong>{event.message}</strong>
            <p>{event.address}</p>
            <span>{new Date(event.time).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  </section>
}
