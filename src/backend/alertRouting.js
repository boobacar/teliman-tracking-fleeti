// Routage des alertes & rapports — logique PURE (aucune I/O), testable.
//
// Objectif métier (demande du 23/09/2026) : que le directeur puisse contrôler
// EXACTEMENT qui reçoit quoi — alertes de zone, alertes flotte, alertes client de
// mission, et rapports — au lieu du comportement « tout le monde reçoit tout ».
//
// Modèle :
//   - `alert_recipients` : les personnes/numéros (scope `internal` ou `client`).
//   - `alert_subscriptions` : une ligne = « ce destinataire veut CETTE catégorie »,
//     éventuellement restreinte à une portée (`zone:<id>`, `client:<nom>`,
//     `truck:<immatriculation>`).
//
// Règle de bascule, pensée pour ne rien casser :
//   - destinataire SANS aucune ligne → comportement historique (interne : zones +
//     flotte ; client : bornes de ses missions).
//   - destinataire AVEC au moins une ligne active → mode explicite : il ne reçoit
//     QUE ce qui est coché. C'est ce qui rend le contrôle total possible.

export const ALERT_CATEGORIES = [
  { key: 'geofence_enter', label: 'Entrée de zone', group: 'geofence', scopes: ['all', 'zone'], scopeSource: 'zone', defaultScopes: 'all' },
  { key: 'geofence_exit', label: 'Sortie de zone', group: 'geofence', scopes: ['all', 'zone'], scopeSource: 'zone' },
  { key: 'fleet_speedup', label: 'Excès de vitesse', group: 'fleet', scopes: ['all', 'truck'], scopeSource: 'truck' },
  { key: 'fleet_parking', label: 'Stationnement prolongé', group: 'fleet', scopes: ['all', 'truck'], scopeSource: 'truck' },
  { key: 'bl_created', label: 'Création de BL', group: 'bl', scopes: ['all', 'client'], scopeSource: 'client' },
  { key: 'bl_departed', label: 'Départ mission (client)', group: 'bl', scopes: ['all', 'client'], scopeSource: 'client' },
  { key: 'bl_arrived', label: 'Arrivée mission (client)', group: 'bl', scopes: ['all', 'client'], scopeSource: 'client' },
  { key: 'report_daily', label: 'Rapport quotidien', group: 'report', scopes: ['all'] },
  { key: 'report_weekly', label: 'Rapport hebdomadaire', group: 'report', scopes: ['all'] },
]

export const ALERT_GROUPS = [
  { key: 'geofence', label: 'Zones (géofences)' },
  { key: 'fleet', label: 'Flotte (conduite)' },
  { key: 'bl', label: 'Missions / clients' },
  { key: 'report', label: 'Rapports' },
]

// Comportement historique, appliqué tant qu'un destinataire n'a aucune ligne.
export const DEFAULT_CATEGORIES = {
  internal: ['geofence_enter', 'geofence_exit', 'fleet_speedup', 'fleet_parking'],
  client: ['bl_departed', 'bl_arrived'],
}

const CATEGORY_KEYS = new Set(ALERT_CATEGORIES.map((category) => category.key))
const CATEGORY_BY_KEY = new Map(ALERT_CATEGORIES.map((category) => [category.key, category]))

export function isValidAlertCategory(key) {
  return CATEGORY_KEYS.has(String(key || ''))
}

export function alertCategoryLabel(key) {
  return CATEGORY_BY_KEY.get(String(key || ''))?.label || String(key || '')
}

export function alertCategory(key) {
  return CATEGORY_BY_KEY.get(String(key || '')) || null
}

// Portée d'une règle : '' / 'all' = tout ; sinon la valeur (id de zone, nom de
// client, immatriculation). Comparaison insensible à la casse/aux espaces.
export function normalizeScopeValue(value) {
  return String(value ?? '').trim()
}

function sameScopeValue(a, b) {
  return normalizeScopeValue(a).toLowerCase() === normalizeScopeValue(b).toLowerCase()
}

// Une règle autorise-t-elle cette catégorie, pour ce contexte précis ?
export function subscriptionAllows(subscription, { category, zoneId = '', clientName = '', truckLabel = '' } = {}) {
  if (!subscription || subscription.active === false) return false
  if (String(subscription.category || '') !== String(category || '')) return false

  const scopeType = String(subscription.scopeType || 'all')
  if (scopeType === 'all' || !normalizeScopeValue(subscription.scopeValue)) return true
  if (scopeType === 'zone') return String(subscription.scopeValue) === String(zoneId ?? '')
  if (scopeType === 'client') return sameScopeValue(subscription.scopeValue, clientName)
  if (scopeType === 'truck') return sameScopeValue(subscription.scopeValue, truckLabel)
  return false
}

export function recipientSubscriptions(recipientId, subscriptions = []) {
  return (subscriptions || []).filter((subscription) => Number(subscription?.recipientId) === Number(recipientId))
}

export function recipientHasExplicitRouting(recipientId, subscriptions = []) {
  return recipientSubscriptions(recipientId, subscriptions).some((subscription) => subscription?.active !== false)
}

export function defaultCategoriesFor(recipient) {
  const scope = String(recipient?.scope || 'internal') === 'client' ? 'client' : 'internal'
  return DEFAULT_CATEGORIES[scope] || []
}

// Décide si UN destinataire doit recevoir l'événement décrit par le contexte.
export function recipientWantsEvent(recipient, subscriptions, context = {}) {
  if (!recipient || recipient.active === false) return false
  const own = recipientSubscriptions(recipient.id, subscriptions)
  if (recipientHasExplicitRouting(recipient.id, subscriptions)) {
    return own.some((subscription) => subscriptionAllows(subscription, context))
  }
  // Mode hérité : les catégories par défaut, sans restriction de portée — mais un
  // destinataire « client » ne doit JAMAIS recevoir une alerte interne de zone.
  const defaults = defaultCategoriesFor(recipient)
  if (!defaults.includes(String(context.category || ''))) return false
  if (String(recipient.scope || 'internal') === 'client') {
    const clientName = normalizeScopeValue(context.clientName)
    const ownClient = normalizeScopeValue(recipient.clientName)
    if (!clientName || !ownClient || clientName.toLowerCase() !== ownClient.toLowerCase()) return false
  }
  return true
}

// Liste des destinataires à notifier pour un événement (numéros normalisés, uniques).
export function resolveRoutedRecipients({ recipients = [], subscriptions = [], category, context = {} } = {}) {
  const fullContext = { ...context, category }
  const seen = new Set()
  const routed = []
  for (const recipient of recipients || []) {
    if (!recipientWantsEvent(recipient, subscriptions, fullContext)) continue
    const phone = String(recipient.phone || '').trim()
    if (!phone) continue
    const key = phone.replace(/\D/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    routed.push({ ...recipient, phone })
  }
  return routed
}

// Résumé lisible pour l'API/l'interface : « qui reçoit quoi », catégorie par catégorie.
export function describeRecipientRouting(recipient, subscriptions = []) {
  const own = recipientSubscriptions(recipient?.id, subscriptions).filter((subscription) => subscription?.active !== false)
  if (!own.length) {
    return {
      recipientId: recipient?.id,
      mode: 'default',
      categories: defaultCategoriesFor(recipient).map((key) => ({ key, label: alertCategoryLabel(key), scopeType: 'all', scopeValue: '' })),
    }
  }
  return {
    recipientId: recipient?.id,
    mode: 'custom',
    categories: own.map((subscription) => ({
      id: subscription.id,
      key: subscription.category,
      label: alertCategoryLabel(subscription.category),
      scopeType: subscription.scopeType || 'all',
      scopeValue: subscription.scopeValue || '',
    })),
  }
}

// Contrôle d'une règle avant insertion (garde-fous d'API).
export function validateSubscriptionInput({ recipientId, category, scopeType = 'all', scopeValue = '' } = {}) {
  const id = Number(recipientId)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Destinataire invalide')
  if (!isValidAlertCategory(category)) throw new Error(`Catégorie d'alerte inconnue : ${category}`)
  const definition = alertCategory(category)
  const type = String(scopeType || 'all')
  if (!definition.scopes.includes(type)) throw new Error(`Portée « ${type} » impossible pour ${definition.label}`)
  const value = normalizeScopeValue(scopeValue)
  if (type !== 'all' && !value) throw new Error('Valeur de portée manquante')
  if (type === 'all') return { recipientId: id, category, scopeType: 'all', scopeValue: '' }
  return { recipientId: id, category, scopeType: type, scopeValue: value }
}
