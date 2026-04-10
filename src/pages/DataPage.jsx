import { useEffect, useMemo, useState } from 'react'
import { MapPin, Package2, Truck, Trash2, Users } from 'lucide-react'
import { addMasterDataItem, deleteMasterDataItem, loadMasterData } from '../lib/fleeti'

function DataCard({ title, description, icon, items, value, setValue, addLabel, placeholder, listName, onAdd, onRemove }) {
  return <section className="panel panel-large data-card-panel">
    <div className="panel-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="stat-icon">{icon}</div>
    </div>
    <div className="delivery-form delivery-form-premium data-card-form">
      <input placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="primary-btn" onClick={() => onAdd(listName, value, setValue)}>{addLabel}</button>
    </div>
    <div className="data-list-grid">
      {items.length === 0 && <div className="empty-banner">Aucune donnée enregistrée pour le moment.</div>}
      {items.map((item) => <div key={item} className="driver-rank-row static-row data-row-card"><div><span>{item}</span><small>{title} disponible</small></div><button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => onRemove(listName, item)} aria-label="Supprimer"><Trash2 size={16} /></button></div>)}
    </div>
  </section>
}

export function DataPage() {
  const [data, setData] = useState({ clients: [], goods: [], destinations: [], suppliers: [] })
  const [clientValue, setClientValue] = useState('')
  const [goodsValue, setGoodsValue] = useState('')
  const [destinationValue, setDestinationValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
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

  const summaryCards = useMemo(() => ([
    { label: 'Clients', value: data.clients?.length || 0, helper: 'listes déroulantes BL' },
    { label: 'Destinations', value: data.destinations?.length || 0, helper: 'zones de livraison' },
    { label: 'Marchandises', value: data.goods?.length || 0, helper: 'catalogue d’exploitation' },
    { label: 'Fournisseurs', value: data.suppliers?.length || 0, helper: 'bons carburant' },
  ]), [data])

  return <div style={{ display: 'grid', gap: 20 }}>
    {loading && <div className="info-banner">Chargement des données…</div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="panel panel-large reports-v2-hero">
      <div className="panel-header"><div><h3>Centre de données de référence</h3><p>Clients, destinations et marchandises utilisés dans les formulaires métier</p></div></div>
      <section className="reports-summary-grid reports-v2-kpis">
        {summaryCards.map((card) => <div key={card.label} className="overview-card"><span>{card.label}</span><strong>{card.value}</strong><small>{card.helper}</small></div>)}
      </section>
    </section>

    <section className="dashboard-grid premium-grid phase2-grid data-page-grid">
      <DataCard
        title="Données clients"
        description="Valeurs utilisées dans les listes déroulantes"
        icon={<Users size={18} />}
        items={data.clients || []}
        value={clientValue}
        setValue={setClientValue}
        addLabel="Ajouter client"
        placeholder="Ajouter un client"
        listName="clients"
        onAdd={addItem}
        onRemove={removeItem}
      />

      <DataCard
        title="Données destinations"
        description="Destinations disponibles pour les bons de livraison"
        icon={<MapPin size={18} />}
        items={data.destinations || []}
        value={destinationValue}
        setValue={setDestinationValue}
        addLabel="Ajouter destination"
        placeholder="Ajouter une destination"
        listName="destinations"
        onAdd={addItem}
        onRemove={removeItem}
      />

      <DataCard
        title="Données marchandises"
        description="Valeurs utilisées dans les listes déroulantes"
        icon={<Package2 size={18} />}
        items={data.goods || []}
        value={goodsValue}
        setValue={setGoodsValue}
        addLabel="Ajouter marchandise"
        placeholder="Ajouter une marchandise"
        listName="goods"
        onAdd={addItem}
        onRemove={removeItem}
      />

      <DataCard
        title="Données fournisseurs"
        description="Fournisseurs disponibles pour les bons de carburant"
        icon={<Truck size={18} />}
        items={data.suppliers || []}
        value={supplierValue}
        setValue={setSupplierValue}
        addLabel="Ajouter fournisseur"
        placeholder="Ajouter un fournisseur"
        listName="suppliers"
        onAdd={addItem}
        onRemove={removeItem}
      />
    </section>
  </div>
}
