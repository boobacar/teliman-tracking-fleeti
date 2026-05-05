import { useEffect, useMemo, useState } from 'react'
import { MapPin, Package2, Phone, Truck, Trash2, Users } from 'lucide-react'
import { ErrorBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader, StatCard, StatGrid } from '../components/UIPrimitives'
import { addMasterDataItem, deleteMasterDataItem, loadMasterData } from '../lib/fleeti'

function DataCard({
  title,
  description,
  icon,
  items,
  value,
  setValue,
  addLabel,
  placeholder,
  listName,
  onAdd,
  onRemove,
}) {
  return (
    <section className="panel panel-large data-card-panel">
      <SectionHeader
        title={title}
        description={description}
        right={(
          <div className="data-card-head-side">
            <span className="data-count-badge">{items.length}</span>
            <div className="stat-icon">{icon}</div>
          </div>
        )}
      />

      <div className="delivery-form delivery-form-premium data-card-form">
        <label className="field-stack">
          <span>{placeholder}</span>
          <input
            aria-label={placeholder}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-btn"
          onClick={() => onAdd(listName, value, setValue)}
        >
          {addLabel}
        </button>
      </div>

      <div className="data-list-grid">
        {items.length === 0 && <div className="empty-banner">Aucune donnée enregistrée pour le moment.</div>}
        {items.map((item, index) => (
          <article key={item} className="data-item-card">
            <div className="data-item-main">
              <span className="data-item-title">{item}</span>
              <small>{title} disponible</small>
            </div>
            <div className="data-item-actions">
              <span className="data-item-index">{String(index + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="ghost-btn small-btn danger-btn icon-btn"
                onClick={() => onRemove(listName, item)}
                aria-label="Supprimer"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function DataPage() {
  const [data, setData] = useState({
    clients: [],
    goods: [],
    destinations: [],
    suppliers: [],
    purchaseOrders: {},
    clientPhones: {},
    manualTrackers: [],
  })
  const [clientValue, setClientValue] = useState('')
  const [goodsValue, setGoodsValue] = useState('')
  const [destinationValue, setDestinationValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
  const [clientPhoneClient, setClientPhoneClient] = useState('')
  const [clientPhoneValue, setClientPhoneValue] = useState('')
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

  useEffect(() => {
    refresh()
  }, [])

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

  async function removeClientPhone(client, phone) {
    await deleteMasterDataItem('clientPhones', client, { client, phone })
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

  const summaryCards = useMemo(
    () => [
      { label: 'Clients', value: data.clients?.length || 0, helper: 'listes déroulantes BL' },
      { label: 'Destinations', value: data.destinations?.length || 0, helper: 'zones de livraison' },
      { label: 'Marchandises', value: data.goods?.length || 0, helper: 'catalogue d’exploitation' },
      { label: 'Fournisseurs', value: data.suppliers?.length || 0, helper: 'bons carburant' },
      { label: 'Camions manuels', value: data.manualTrackers?.length || 0, helper: 'hors API Fleeti' },
      {
        label: 'Chauffeurs manuels',
        value: new Set((data.manualTrackers || []).map((item) => item.driver).filter(Boolean)).size,
        helper: 'hors API Fleeti',
      },
      {
        label: 'Téléphones clients',
        value: Object.keys(data.clientPhones || {}).length || 0,
        helper: 'contact par client',
      },
      {
        label: 'N° bons commande',
        value: Object.keys(data.purchaseOrders || {}).length || 0,
        helper: 'affectation par client',
      },
    ],
    [data],
  )

  return (
    <PageStack className="data-page-stack">
      {loading && <LoadingBanner message="Chargement des données…" />}
      <ErrorBanner message={error} />

      <section className="panel panel-large reports-v2-hero data-hero-panel">
        <SectionHeader
          title="Centre de données de référence"
          description="Clients, destinations, marchandises et référentiels opérationnels."
          right={<span className="data-phase-chip">Phase 3 UI</span>}
        />

        <StatGrid className="data-kpis-grid">
          {summaryCards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} helper={card.helper} />
          ))}
        </StatGrid>
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
          <SectionHeader
            title="Camions & chauffeurs manuels"
            description="Ajoutez des unités hors API Fleeti pour les utiliser dans les bons de livraison et de carburant."
            right={<div className="stat-icon"><Truck size={18} /></div>}
          />

          <div className="delivery-form delivery-form-premium data-card-form data-card-form-wide">
            <label className="field-stack">
              <span>Nom du camion</span>
              <input
                aria-label="Nom du camion"
                placeholder="Nom du camion"
                value={manualTruckLabel}
                onChange={(e) => setManualTruckLabel(e.target.value)}
              />
            </label>
            <label className="field-stack">
              <span>Nom du chauffeur</span>
              <input
                aria-label="Nom du chauffeur"
                placeholder="Nom du chauffeur"
                value={manualDriverName}
                onChange={(e) => setManualDriverName(e.target.value)}
              />
            </label>
            <button type="button" className="primary-btn" onClick={addManualTracker}>Ajouter</button>
          </div>

          <div className="data-list-grid">
            {(data.manualTrackers || []).length === 0 && <div className="empty-banner">Aucun camion manuel enregistré.</div>}
            {(data.manualTrackers || []).map((item, index) => (
              <article key={item.id} className="data-item-card">
                <div className="data-item-main">
                  <span className="data-item-title">{item.label}</span>
                  <small>Chauffeur: {item.driver}</small>
                </div>
                <div className="data-item-actions">
                  <span className="data-item-index">{String(index + 1).padStart(2, '0')}</span>
                  <button
                    type="button"
                    className="ghost-btn small-btn danger-btn icon-btn"
                    onClick={() => removeManualTracker(item.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-large data-card-panel">
          <SectionHeader
            title="Téléphones clients"
            description="Associer un numéro de téléphone à chaque client pour garder les contacts opérationnels dans les données."
            right={<div className="stat-icon"><Phone size={18} /></div>}
          />

          <div className="delivery-form delivery-form-premium data-card-form data-card-form-wide">
            <label className="field-stack">
              <span>Client</span>
              <select
                aria-label="Client pour le numéro de téléphone"
                value={clientPhoneClient}
                onChange={(e) => setClientPhoneClient(e.target.value)}
              >
                <option value="">Sélectionner un client</option>
                {(data.clients || []).map((client) => (
                  <option key={client} value={client}>{client}</option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span>Numéro de téléphone</span>
              <input
                aria-label="Numéro de téléphone client"
                placeholder="Ex: +225 07 00 00 00 00"
                type="tel"
                value={clientPhoneValue}
                onChange={(e) => setClientPhoneValue(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                if (!clientPhoneClient.trim() || !clientPhoneValue.trim()) return
                await addMasterDataItem('clientPhones', clientPhoneValue.trim(), {
                  client: clientPhoneClient.trim(),
                  phone: clientPhoneValue.trim(),
                })
                setClientPhoneClient('')
                setClientPhoneValue('')
                await refresh()
              }}
            >
              Enregistrer
            </button>
          </div>

          <div className="data-list-grid">
            {Object.keys(data.clientPhones || {}).length === 0 && <div className="empty-banner">Aucun numéro de téléphone client assigné.</div>}
            {Object.entries(data.clientPhones || {}).flatMap(([client, phones]) => (Array.isArray(phones) ? phones : [phones]).filter(Boolean).map((phone) => ({ client, phone }))).map(({ client, phone }, index) => (
              <article key={`${client}-${phone}`} className="data-item-card">
                <div className="data-item-main">
                  <span className="data-item-title">{client}</span>
                  <small>Tél: {phone}</small>
                </div>
                <div className="data-item-actions">
                  <span className="data-item-index">{String(index + 1).padStart(2, '0')}</span>
                  <button
                    type="button"
                    className="ghost-btn small-btn danger-btn icon-btn"
                    onClick={() => removeClientPhone(client, phone)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-large data-card-panel">
          <SectionHeader
            title="Numéro bon de commande"
            description="Associer un numéro de bon de commande à un client pour l’inclure dans les PDF exportés."
            right={<div className="stat-icon"><Users size={18} /></div>}
          />

          <div className="delivery-form delivery-form-premium data-card-form data-card-form-wide">
            <label className="field-stack">
              <span>Client</span>
              <select
                aria-label="Client pour le numéro de bon de commande"
                value={purchaseOrderClient}
                onChange={(e) => setPurchaseOrderClient(e.target.value)}
              >
                <option value="">Sélectionner un client</option>
                {(data.clients || []).map((client) => (
                  <option key={client} value={client}>{client}</option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span>Numéro bon de commande</span>
              <input
                aria-label="Numéro bon de commande"
                placeholder="Numéro bon de commande"
                value={purchaseOrderValue}
                onChange={(e) => setPurchaseOrderValue(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                if (!purchaseOrderClient.trim() || !purchaseOrderValue.trim()) return
                await addMasterDataItem('purchaseOrders', purchaseOrderValue.trim(), {
                  client: purchaseOrderClient.trim(),
                  purchaseOrderNumber: purchaseOrderValue.trim(),
                })
                setPurchaseOrderClient('')
                setPurchaseOrderValue('')
                await refresh()
              }}
            >
              Enregistrer
            </button>
          </div>

          <div className="data-list-grid">
            {Object.keys(data.purchaseOrders || {}).length === 0 && <div className="empty-banner">Aucun numéro de bon de commande assigné.</div>}
            {Object.entries(data.purchaseOrders || {}).map(([client, purchaseOrderNumber], index) => (
              <article key={client} className="data-item-card">
                <div className="data-item-main">
                  <span className="data-item-title">{client}</span>
                  <small>BC: {purchaseOrderNumber}</small>
                </div>
                <div className="data-item-actions">
                  <span className="data-item-index">{String(index + 1).padStart(2, '0')}</span>
                  <button
                    type="button"
                    className="ghost-btn small-btn danger-btn icon-btn"
                    onClick={() => removeItem('purchaseOrders', client)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </PageStack>
  )
}
