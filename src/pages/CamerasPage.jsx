import { useEffect, useState } from 'react'
import { Camera, MapPin, Radio, Truck } from 'lucide-react'
import { loadCameras } from '../lib/fleeti'

export function CamerasPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError('')
      try {
        const payload = await loadCameras()
        if (!cancelled) setItems(payload.items || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Impossible de charger les caméras.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>Caméras par camion</h3><p>Vue consolidée des caméras associées aux camions de la flotte.</p></div></div>
      </section>

      {loading && <div className="info-banner">Chargement des caméras…</div>}
      {error && <div className="error-banner">{error}</div>}

      <section className="panel panel-large">
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Camion</th>
                <th>Caméra</th>
                <th>Statut</th>
                <th>Modèle</th>
                <th>IMEI</th>
                <th>Dernière remontée</th>
                <th>Position</th>
                <th>Live view</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.truckLabel}-${item.cameraAssetId || item.cameraGatewayId}`}>
                  <td><strong><Truck size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.truckLabel}</strong></td>
                  <td><Camera size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.cameraLabel || '-'}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: item.isOnline ? '#dcfce7' : '#fee2e2', color: item.isOnline ? '#166534' : '#991b1b', fontWeight: 600, fontSize: 12 }}>
                      <Radio size={12} />{item.isOnline ? 'En ligne' : 'Hors ligne'}
                    </span>
                  </td>
                  <td>{item.model || '-'}</td>
                  <td>{item.imei || '-'}</td>
                  <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('fr-FR') : '-'}</td>
                  <td>{item.location ? <><MapPin size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.location.lat?.toFixed(5)}, {item.location.lng?.toFixed(5)}</> : '-'}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: item.liveViewAvailable ? '#dcfce7' : '#fef3c7', color: item.liveViewAvailable ? '#166534' : '#92400e', fontWeight: 600, fontSize: 12 }}>
                      {item.liveViewAvailable ? 'Disponible' : 'Indisponible'}
                    </span>
                    {!item.liveViewAvailable && <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>{item.liveViewReason}</div>}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucune caméra trouvée.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
