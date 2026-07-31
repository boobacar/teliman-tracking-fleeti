import { useEffect, useMemo, useState } from 'react'
import { MapPin, Package2, Phone, Truck, Trash2, Users } from 'lucide-react'
import { ErrorBanner, LoadingBanner } from '../components/FeedbackBanners'
import { SkeletonTable } from '../components/Skeleton'
import { PageStack, SectionHeader, StatCard, StatGrid } from '../components/UIPrimitives'
import { addMasterDataItem, deleteMasterDataItem, loadMasterData } from '../lib/fleeti'
import { useAccessibleConfirm } from '../components/ConfirmDialog.jsx'

function SwitchControl({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <span className="ui-toggle-control">
        <input className="ui-toggle-input" type="checkbox" role="switch" aria-checked={checked} aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className={`ui-toggle-track ${checked ? 'is-checked' : ''}`} aria-hidden="true">
          <span className={`ui-toggle-knob ${checked ? 'is-checked' : ''}`} />
        </span>
      </span>
    </label>
  )
}

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
                className="ghost-btn danger-btn icon-btn"
                onClick={() => onRemove(listName, item)}
                aria-label="Supprimer"
              >
                <Trash2 size={22} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function DataPage() {
  const { confirm, confirmationDialog } = useAccessibleConfirm()
  const [data, setData] = useState({
    clients: [],
    goods: [],
    destinations: [],
    suppliers: [],
    purchaseOrders: {},
    clientPhones: {},
    alertWhatsAppRecipients: {},
    manualTrackers: [],
  })
  const [clientValue, setClientValue] = useState('')
  const [goodsValue, setGoodsValue] = useState('')
  const [destinationValue, setDestinationValue] = useState('')
  const [supplierValue, setSupplierValue] = useState('')
  const [clientPhoneClient, setClientPhoneClient] = useState('')
  const [clientPhoneValue, setClientPhoneValue] = useState('')
  const [alertRecipientTypes, setAlertRecipientTypes] = useState(['speedup', 'excessive_parking'])
  const [alertRecipientPhone, setAlertRecipientPhone] = useState('')
  const [manualTruckLabel, setManualTruckLabel] = useState('')
  const [manualDriverName, setManualDriverName] = useState('')
  const [purchaseOrderClient, setPurchaseOrderClient] = useState('')
  const [purchaseOrderValue, setPurchaseOrderValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    let cancelled = false

    async function initialLoad() {
      setLoading(true)
      setError('')
      try {
        const result = await loadMasterData()
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Erreur de chargement')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

  async function addItem(listName, value, reset) {
    if (!value.trim()) return
    if (await runMutation(() => addMasterDataItem(listName, value.trim()), 'Donnée ajoutée.')) reset('')
  }

  async function removeItem(listName, value) {
    if (!await confirm({ title: 'Supprimer cette donnée ?', message: `« ${value} » sera retiré des formulaires qui utilisent ce référentiel.`, confirmLabel: 'Supprimer' })) return
    await runMutation(() => deleteMasterDataItem(listName, value), 'Donnée supprimée.')
  }

  async function removeClientPhone(client, phone) {
    if (!await confirm({ title: 'Supprimer ce numéro ?', message: `${phone} ne sera plus associé à ${client}.`, confirmLabel: 'Supprimer' })) return
    await runMutation(() => deleteMasterDataItem('clientPhones', client, { client, phone }), 'Numéro supprimé.')
  }

  async function runMutation(action, successMessage) {
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
      await refresh()
      return true
    } catch (err) {
      setError(err.message || 'La modification n’a pas pu être enregistrée.')
      return false
    }
  }

  async function addAlertRecipient() {
    const phone = alertRecipientPhone.trim()
    if (!phone || alertRecipientTypes.length === 0) return
    const saved = await runMutation(async () => {
      for (const eventType of alertRecipientTypes) await addMasterDataItem('alertWhatsAppRecipients', phone, { eventType, phone })
    }, 'Destinataire WhatsApp enregistré.')
    if (saved) setAlertRecipientPhone('')
  }

  function toggleAlertRecipientType(eventType) {
    setAlertRecipientTypes((current) => {
      if (current.includes(eventType)) return current.filter((item) => item !== eventType)
      return [...current, eventType]
    })
  }

  async function removeAlertRecipient(eventType, phone) {
    if (!await confirm({ title: 'Supprimer ce destinataire ?', message: `${phone} ne recevra plus cette catégorie d’alerte.`, confirmLabel: 'Supprimer' })) return
    await runMutation(() => deleteMasterDataItem('alertWhatsAppRecipients', phone, { eventType, phone }), 'Destinataire supprimé.')
  }

  async function addManualTracker() {
    const label = manualTruckLabel.trim()
    const driver = manualDriverName.trim()
    if (!label || !driver) return
    if (await runMutation(() => addMasterDataItem('manualTrackers', label, { label, driver }), 'Camion manuel ajouté.')) {
      setManualTruckLabel('')
      setManualDriverName('')
    }
  }

  async function removeManualTracker(id) {
    if (!await confirm({ title: 'Supprimer ce camion manuel ?', message: 'Le camion et son affectation chauffeur seront retirés.', confirmLabel: 'Supprimer' })) return
    await runMutation(() => deleteMasterDataItem('manualTrackers', String(id)), 'Camion manuel supprimé.')
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
        label: 'Alertes WhatsApp',
        value: Object.values(data.alertWhatsAppRecipients || {}).reduce((sum, phones) => sum + (Array.isArray(phones) ? phones.length : (phones ? 1 : 0)), 0),
        helper: 'vitesse & stationnement',
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
      {loading && <SkeletonTable rows={4} cols={6} />}
      <ErrorBanner message={error} />
      {notice && <div className="ui-toast" role="status" aria-live="polite">{notice}</div>}

      <section className="panel panel-large reports-v2-hero data-hero-panel">
        <div className="ui-section-header"><div><h1>Centre de données de référence</h1><p>Clients, destinations, marchandises et référentiels opérationnels.</p></div></div>

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
                    className="ghost-btn danger-btn icon-btn"
                    onClick={() => removeManualTracker(item.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={22} />
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
                const saved = await runMutation(() => addMasterDataItem('clientPhones', clientPhoneValue.trim(), {
                  client: clientPhoneClient.trim(),
                  phone: clientPhoneValue.trim(),
                }), 'Numéro client enregistré.')
                if (saved) { setClientPhoneClient(''); setClientPhoneValue('') }
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
                    className="ghost-btn danger-btn icon-btn"
                    onClick={() => removeClientPhone(client, phone)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={22} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-large data-card-panel">
          <SectionHeader
            title="Destinataires alertes WhatsApp"
            description="Numéros qui reçoivent instantanément les alertes d’excès de vitesse et de stationnement prolongé."
            right={<div className="stat-icon"><Phone size={18} /></div>}
          />

          <div className="delivery-form delivery-form-premium data-card-form data-card-form-wide">
            <div className="field-stack">
              <span>Alertes à recevoir</span>
              <SwitchControl label="Excès de vitesse" checked={alertRecipientTypes.includes('speedup')} onChange={() => toggleAlertRecipientType('speedup')} />
              <SwitchControl label="Stationnement prolongé" checked={alertRecipientTypes.includes('excessive_parking')} onChange={() => toggleAlertRecipientType('excessive_parking')} />
              <small className="form-hint">Activez une seule alerte ou les deux pour le même numéro.</small>
            </div>
            <label className="field-stack">
              <span>Numéro WhatsApp destinataire</span>
              <input
                aria-label="Numéro WhatsApp pour les alertes flotte"
                placeholder="Ex: +225 07 69 28 93 04"
                type="tel"
                value={alertRecipientPhone}
                onChange={(e) => setAlertRecipientPhone(e.target.value)}
              />
              <small className="form-hint">Le numéro recevra véhicule, chauffeur, type d’alerte, position et heure dès l’événement.</small>
            </label>
            <button type="button" className="primary-btn" onClick={addAlertRecipient} disabled={alertRecipientTypes.length === 0}>Enregistrer</button>
          </div>

          <div className="data-list-grid">
            {Object.values(data.alertWhatsAppRecipients || {}).every((phones) => !(Array.isArray(phones) ? phones.length : phones)) && <div className="empty-banner">Aucun destinataire WhatsApp d’alerte enregistré.</div>}
            {Object.entries(data.alertWhatsAppRecipients || {}).flatMap(([eventType, phones]) => (Array.isArray(phones) ? phones : [phones]).filter(Boolean).map((phone) => ({ eventType, phone }))).map(({ eventType, phone }, index) => (
              <article key={`${eventType}-${phone}`} className="data-item-card">
                <div className="data-item-main">
                  <span className="data-item-title">{eventType === 'speedup' ? 'Excès de vitesse' : 'Stationnement prolongé'}</span>
                  <small>WhatsApp: {phone}</small>
                </div>
                <div className="data-item-actions">
                  <span className="data-item-index">{String(index + 1).padStart(2, '0')}</span>
                  <button
                    type="button"
                    className="ghost-btn danger-btn icon-btn"
                    onClick={() => removeAlertRecipient(eventType, phone)}
                    aria-label="Supprimer destinataire alerte WhatsApp"
                  >
                    <Trash2 size={22} />
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
                const saved = await runMutation(() => addMasterDataItem('purchaseOrders', purchaseOrderValue.trim(), {
                  client: purchaseOrderClient.trim(),
                  purchaseOrderNumber: purchaseOrderValue.trim(),
                }), 'Numéro de bon de commande enregistré.')
                if (saved) { setPurchaseOrderClient(''); setPurchaseOrderValue('') }
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
                    className="ghost-btn danger-btn icon-btn"
                    onClick={() => removeItem('purchaseOrders', client)}
                    aria-label="Supprimer"
                  >
                    <Trash2 size={22} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
      {confirmationDialog}
    </PageStack>
  )
}
