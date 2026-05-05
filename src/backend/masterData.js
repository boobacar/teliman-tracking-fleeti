export function normalizePurchaseOrdersMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([client, purchaseOrderNumber]) => [String(client || '').trim(), String(purchaseOrderNumber || '').trim()])
      .filter(([client, purchaseOrderNumber]) => client && purchaseOrderNumber)
      .sort((a, b) => a[0].localeCompare(b[0]))
  )
}

export function normalizeClientPhonesMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([client, phone]) => [String(client || '').trim(), String(phone || '').trim()])
      .filter(([client, phone]) => client && phone)
      .sort((a, b) => a[0].localeCompare(b[0]))
  )
}

export function normalizeManualTrackers(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const id = Number(item?.id)
      const label = String(item?.label || '').trim()
      const driver = String(item?.driver || '').trim()
      const normalizedId = Number.isInteger(id) && id > 0 ? id : (9000000 + index + 1)
      if (!label || !driver) return null
      return { id: normalizedId, label, driver }
    })
    .filter(Boolean)
    .reduce((acc, item) => {
      if (acc.some((entry) => Number(entry.id) === Number(item.id))) return acc
      return [...acc, item]
    }, [])
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function normalizeStringList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
}

export function buildMasterDataPayload(data = {}) {
  return {
    clients: normalizeStringList(data.clients),
    goods: normalizeStringList(data.goods),
    destinations: normalizeStringList(data.destinations),
    suppliers: normalizeStringList(data.suppliers),
    purchaseOrders: normalizePurchaseOrdersMap(data.purchaseOrders),
    clientPhones: normalizeClientPhonesMap(data.clientPhones),
    manualTrackers: normalizeManualTrackers(data.manualTrackers),
  }
}

export function emptyMasterDataPayload() {
  return buildMasterDataPayload()
}
