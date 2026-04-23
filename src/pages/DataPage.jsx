import { useEffect, useMemo, useState } from 'react'
import { MapPin, Package2, Truck, Trash2, Users } from 'lucide-react'
import { addMasterDataItem, deleteMasterDataItem, loadMasterData } from '../lib/fleeti'

function DataCard({ title, description, icon, items, value, setValue, addLabel, placeholder, listName, onAdd, onRemove }) {
  return <section className="panel panel-large data-card-panel">
    <div className="panel-header data-card-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="data-card-head-side">
        <span className="data-count-badge">{items.length}</span>
        <div className="stat-icon">{icon}</div>
      </div>
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
  const [data, setData] = useState({ clients: [], goods: [], destinations: [], suppliers: [], purchaseOrders: {}, manualTrackers: [] })
  const [clientValue, setClientValue] = useState('')
  const [goodsValue, setGoodsValue] = useState('')
  const [destinationValue, setDestinationValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
  const [manualTruckLabel, setManualTruckLabel] = useState('')
  const [manualDriverName, setManualDriverName] = useState('')
  const [purchaseOrderClient, setPurchaseOrderClient] = useState('')
  const [purchaseOrderValue, setPurchaseOrderValue] = useState('')
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

  async function addManualTracker() {
    const label = manualTruckLabel.trim()
    const driver = manualDriverName.trim()
    if (!label || !driver) return
    await addMasterDataItem('manualTrackers', label, { label, driver })
    setManualTruckLabel('')
    setManualDriverName('')
    await refresh()
  }

  async function removeManualTracker(id) {
    await deleteMasterDataItem('manualTrackers', String(id))
    await refresh()
  }

  const summaryCards = useMemo(() => ([
    { label: 'Clients', value: data.clients?.length || 0, helper: 'listes déroulantes BL' },
    { label: 'Destinations', value: data.destinations?.length || 0, helper: 'zones de livraison' },
    { label: 'Marchandises', value: data.goods?.length || 0, helper: 'catalogue d’exploitation' },
    { label: 'Fournisseurs', value: data.suppliers?.length || 0, helper: 'bons carburant' },
    { label: 'Camions manuels', value: data.manualTrackers?.length || 0, helper: 'hors API Fleeti' },
    { label: 'Chauffeurs manuels', value: new Set((data.manualTrackers || []).map((item) => item.driver).filter(Boolean)).size, helper: 'hors API Fleeti' },
    { label: 'N° bons commande', value: Object.keys(data.purchaseOrders || {}).length || 0, helper: 'affectation par client' },
  ]), [data])

  return <div style={{ display: 'grid', gap: 20 }}>
    {loading && <div className="info-banner">Chargement des données…</div>}
    {error && <div className="error-banner">{error}</div>}

    <section className="panel panel-large reports-v2-hero data-hero-panel">
      <div className="panel-header"><div><h3>Centre de données de référence</h3><p>Clients, destinations, marchandises et référentiels opérationnels.</p></div></div>
      <section className="reports-summary-grid reports-v2-kpis data-kpis-grid">
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

      <section className="panel panel-large data-card-panel">
        <div className="panel-header">
          <div>
            <h3>Camions & chauffeurs manuels</h3>
            <p>Ajoutez des unités hors API Fleeti pour les utiliser dans les bons de livraison et de carburant.</p>
          </div>
          <div className="stat-icon"><Truck size={18} /></div>
        </div>
        <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
          <input placeholder="Nom du camion" value={manualTruckLabel} onChange={(e) => setManualTruckLabel(e.target.value)} />
          <input placeholder="Nom du chauffeur" value={manualDriverName} onChange={(e) => setManualDriverName(e.target.value)} />
          <button className="primary-btn" onClick={addManualTracker}>Ajouter</button>
        </div>
        <div className="data-list-grid">
          {(data.manualTrackers || []).length === 0 && <div className="empty-banner">Aucun camion manuel enregistré.</div>}
          {(data.manualTrackers || []).map((item) => (
            <div key={item.id} className="driver-rank-row static-row data-row-card">
              <div><span>{item.label}</span><small>{item.driver}</small></div>
              <button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => removeManualTracker(item.id)} aria-label="Supprimer"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-large data-card-panel">
        <div className="panel-header">
          <div>
            <h3>Numéro bon de commande</h3>
            <p>Associer un numéro de bon de commande à un client pour l’inclure dans les PDF exportés.</p>
          </div>
          <div className="stat-icon"><Users size={18} /></div>
        </div>
        <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
          <select value={purchaseOrderClient} onChange={(e) => setPurchaseOrderClient(e.target.value)}>
            <option value="">Sélectionner un client</option>
            {(data.clients || []).map((client) => <option key={client} value={client}>{client}</option>)}
          </select>
          <input placeholder="Numéro bon de commande" value={purchaseOrderValue} onChange={(e) => setPurchaseOrderValue(e.target.value)} />
          <button className="primary-btn" onClick={async () => {
            if (!purchaseOrderClient.trim() || !purchaseOrderValue.trim()) return
            await addMasterDataItem('purchaseOrders', purchaseOrderValue.trim(), { client: purchaseOrderClient.trim(), purchaseOrderNumber: purchaseOrderValue.trim() })
            setPurchaseOrderClient('')
            setPurchaseOrderValue('')
            await refresh()
          }}>Enregistrer</button>
        </div>
        <div className="data-list-grid">
          {Object.keys(data.purchaseOrders || {}).length === 0 && <div className="empty-banner">Aucun numéro de bon de commande assigné.</div>}
          {Object.entries(data.purchaseOrders || {}).map(([client, purchaseOrderNumber]) => (
            <div key={client} className="driver-rank-row static-row data-row-card">
              <div><span>{client}</span><small>{purchaseOrderNumber}</small></div>
              <button className="ghost-btn small-btn danger-btn icon-btn" onClick={() => removeItem('purchaseOrders', client)} aria-label="Supprimer"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </section>
    </section>
  </div>
}
