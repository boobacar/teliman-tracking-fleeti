import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { addMasterDataItem, deleteMasterDataItem, loadMasterData } from '../lib/fleeti'

export function DataPage() {
  const [data, setData] = useState({ clients: [], goods: [] })
  const [clientValue, setClientValue] = useState('')
  const [goodsValue, setGoodsValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      setData(await loadMasterData())
    } catch (err) {
      setError(err.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function addItem(listName, value, reset) {
    if (!value.trim()) return
    await addMasterDataItem(listName, value.trim())
    reset('')
    await refresh()
  }

  async function removeItem(listName, value) {
    await deleteMasterDataItem(listName, value)
    await refresh()
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    {loading && <div className="info-banner">Chargement des données…</div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="dashboard-grid premium-grid phase2-grid">
      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Données clients</h3><p>Valeurs utilisées dans les listes déroulantes</p></div></div>
        <div className="delivery-form delivery-form-premium">
          <input placeholder="Ajouter un client" value={clientValue} onChange={(e) => setClientValue(e.target.value)} />
          <button className="primary-btn" onClick={() => addItem('clients', clientValue, setClientValue)}>Ajouter client</button>
        </div>
        <div className="driver-ranking">{(data.clients || []).map((item) => <div key={item} className="driver-rank-row static-row"><div><span>{item}</span><small>Client disponible</small></div><button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => removeItem('clients', item)} aria-label="Supprimer"><Trash2 size={16} /></button></div>)}</div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Données marchandises</h3><p>Valeurs utilisées dans les listes déroulantes</p></div></div>
        <div className="delivery-form delivery-form-premium">
          <input placeholder="Ajouter une marchandise" value={goodsValue} onChange={(e) => setGoodsValue(e.target.value)} />
          <button className="primary-btn" onClick={() => addItem('goods', goodsValue, setGoodsValue)}>Ajouter marchandise</button>
        </div>
        <div className="driver-ranking">{(data.goods || []).map((item) => <div key={item} className="driver-rank-row static-row"><div><span>{item}</span><small>Marchandise disponible</small></div><button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => removeItem('goods', item)} aria-label="Supprimer"><Trash2 size={16} /></button></div>)}</div>
      </section>
    </section>
  </div>
}
