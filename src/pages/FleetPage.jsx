import { useState } from 'react'
import { PageStack, SectionHeader } from '../components/UIPrimitives'
import { DriversPage } from './DriversPage'
import { TrackersPage } from './TrackersPage'

export function FleetPage({ filteredTrackers, setSelectedTrackerId }) {
  const [mode, setMode] = useState('trackers')

  return (
    <PageStack className="ops-page-stack">
      <section className="panel panel-large delivery-hero-panel">
        <SectionHeader title="Flotte" description="Vue unifiée camions + chauffeurs" />
        <div className="filters filter-row">
          <button type="button" className={`chip ${mode === 'trackers' ? 'selected' : ''}`} onClick={() => setMode('trackers')}>Par camion</button>
          <button type="button" className={`chip ${mode === 'drivers' ? 'selected' : ''}`} onClick={() => setMode('drivers')}>Par chauffeur</button>
        </div>
      </section>

      {mode === 'trackers'
        ? <TrackersPage filteredTrackers={filteredTrackers} setSelectedTrackerId={setSelectedTrackerId} />
        : <DriversPage filteredTrackers={filteredTrackers} />}
    </PageStack>
  )
}
