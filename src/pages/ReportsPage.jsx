import { useMemo } from 'react'

function downloadCsv(summary, rows) {
  const summaryLines = [
    ['KPI global', ''],
    ['Trajets total', summary?.trajetsTotal ?? 0],
    ['Distance totale (km)', summary?.distanceTotaleKm ?? 0],
    ['Temps de trajet total (h)', summary?.tempsTrajetTotalH ?? 0],
    ['Temps d’inactivité total (h)', summary?.tempsInactiviteTotalH ?? 0],
    ['Vitesse moyenne flotte (km/h)', summary?.vitesseMoyenneFlotte ?? 0],
    ['Vitesse max flotte (km/h)', summary?.vitesseMaxFlotte ?? 0],
    ['Carburant total capteurs (L)', summary?.carburantTotalL ?? 0],
    [],
    ['Immatriculation', 'Conducteur', 'Trajets', 'Distance (km)', 'Temps trajet (h)', 'Inactivité (h)', 'Vitesse moy (km/h)', 'Vitesse max (km/h)', 'Carburant (L)', 'Inactivité / Trajet'],
  ]

  const bodyLines = rows.map((row) => [
    row.immatriculation,
    row.conducteur,
    row.trajets,
    row.distanceKm,
    row.tempsTrajetH,
    row.inactiviteH,
    row.vitesseMoy,
    row.vitesseMax,
    row.carburantL,
    row.inactiviteParTrajet,
  ])

  const csv = [...summaryLines, ...bodyLines].map((line) => line.join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'rapport-flotte.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage({ reports }) {
  const rows = reports?.rows ?? []
  const summary = reports?.summary ?? {}

  const totalRow = useMemo(() => ({
    immatriculation: 'TOTAL',
    conducteur: '',
    trajets: summary.trajetsTotal ?? 0,
    distanceKm: summary.distanceTotaleKm ?? 0,
    tempsTrajetH: summary.tempsTrajetTotalH ?? 0,
    inactiviteH: summary.tempsInactiviteTotalH ?? 0,
    vitesseMoy: summary.vitesseMoyenneFlotte ?? 0,
    vitesseMax: summary.vitesseMaxFlotte ?? 0,
    carburantL: summary.carburantTotalL ?? 0,
    inactiviteParTrajet: 0,
  }), [summary])

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Rapports flotte</h3></div><button className="primary-btn" onClick={() => downloadCsv(summary, rows)}>Télécharger CSV</button></div>
      <div className="reports-summary-grid">
        <div className="overview-card"><span>Trajets total</span><strong>{summary.trajetsTotal ?? 0}</strong></div>
        <div className="overview-card"><span>Distance totale</span><strong>{summary.distanceTotaleKm ?? 0} km</strong></div>
        <div className="overview-card"><span>Temps trajet total</span><strong>{summary.tempsTrajetTotalH ?? 0} h</strong></div>
        <div className="overview-card"><span>Temps inactivité</span><strong>{summary.tempsInactiviteTotalH ?? 0} h</strong></div>
        <div className="overview-card"><span>Vitesse moyenne flotte</span><strong>{summary.vitesseMoyenneFlotte ?? 0} km/h</strong></div>
        <div className="overview-card"><span>Carburant total</span><strong>{summary.carburantTotalL ?? 'N/A'}</strong></div>
      </div>
    </section>

    <section className="panel panel-large">
      <div className="panel-header"><div><h3>Tableau détaillé</h3></div></div>
      <div className="reports-table-wrap">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Immatriculation</th>
              <th>Conducteur</th>
              <th>Trajets</th>
              <th>Distance (km)</th>
              <th>Temps trajet (h)</th>
              <th>Inactivité (h)</th>
              <th>Vitesse moy</th>
              <th>Vitesse max</th>
              <th>Carburant (L)</th>
              <th>Inactivité / Trajet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={row.immatriculation}><td>{row.immatriculation}</td><td>{row.conducteur}</td><td>{row.trajets}</td><td>{row.distanceKm}</td><td>{row.tempsTrajetH}</td><td>{row.inactiviteH}</td><td>{row.vitesseMoy}</td><td>{row.vitesseMax}</td><td>{row.carburantL}</td><td>{row.inactiviteParTrajet}</td></tr>)}
            <tr className="reports-total-row"><td>{totalRow.immatriculation}</td><td>{totalRow.conducteur}</td><td>{totalRow.trajets}</td><td>{totalRow.distanceKm}</td><td>{totalRow.tempsTrajetH}</td><td>{totalRow.inactiviteH}</td><td>{totalRow.vitesseMoy}</td><td>{totalRow.vitesseMax}</td><td>{totalRow.carburantL}</td><td>{totalRow.inactiviteParTrajet}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
}
