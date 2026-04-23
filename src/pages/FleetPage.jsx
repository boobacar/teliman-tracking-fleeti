import { useState } from 'react'
import { DriversPage } from './DriversPage'
import { TrackersPage } from './TrackersPage'

export function FleetPage({ filteredTrackers, setSelectedTrackerId }) {
  const [mode, setMode] = useState('trackers')

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Flotte</h3>
            <p>Vue unifiée camions + chauffeurs</p>
          </div>
        </div>
        <div className="filters filter-row">
          <button type="button" className={`chip ${mode === 'trackers' ? 'selected' : ''}`} onClick={() => setMode('trackers')}>Par camion</button>
          <button type="button" className={`chip ${mode === 'drivers' ? 'selected' : ''}`} onClick={() => setMode('drivers')}>Par chauffeur</button>
        </div>
      </section>

      {mode === 'trackers'
        ? <TrackersPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />
        : <DriversPage filteredTrackers={filteredTrackers} />}
    </div>
  )
}
