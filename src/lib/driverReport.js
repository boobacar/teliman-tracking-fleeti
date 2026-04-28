export function toDate(value) {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = new Date(String(value).replace(' ', 'T'))
  if (!Number.isNaN(normalized.getTime())) return normalized
  return null
}

export function dateToYmd(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return value.toISOString().slice(0, 10)
}

export function ymdToDate(value) {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value || '').trim().replace(',', '.')
  if (!raw) return 0
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

export function formatQty(value) {
  const num = parseQuantity(value)
  if (!Number.isFinite(num)) return value || '-'
  return `${num.toLocaleString('fr-FR')} t`
}

export function deliveryActivityDate(order = {}) {
  return order.date
    || order.arrivalDateTime
    || order.completedAt
    || order.departureDateTime
    || (Number.isFinite(Number(order.id)) ? new Date(Number(order.id)).toISOString() : null)
}

export function inRange(value, from, to) {
  const d = toDate(value)
  if (!d) return false
  if (from) {
    const f = new Date(`${from}T00:00:00`)
    if (d < f) return false
  }
  if (to) {
    const t = new Date(`${to}T23:59:59`)
    if (d > t) return false
  }
  return true
}

export function latestDeliveryActivityYmd(deliveryOrders = []) {
  let latest = null
  for (const order of deliveryOrders) {
    const date = toDate(deliveryActivityDate(order))
    if (date && (!latest || date > latest)) latest = date
  }
  return latest ? dateToYmd(latest) : ''
}

function trackerLocation(tracker) {
  const lat = Number(tracker?.state?.gps?.location?.lat)
  const lng = Number(tracker?.state?.gps?.location?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '-'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function buildDriverSummaries({ deliveryOrders = [], filteredTrackers = [], from = '', to = '' } = {}) {
  const rows = deliveryOrders.filter((item) => inRange(deliveryActivityDate(item), from, to))
  const grouped = new Map()

  for (const item of rows) {
    const driver = String(item.driver || 'Non renseigné').trim() || 'Non renseigné'
    if (!grouped.has(driver)) grouped.set(driver, [])
    grouped.get(driver).push(item)
  }

  const summaries = Array.from(grouped.entries()).map(([driver, items]) => {
    const latest = [...items].sort((a, b) => (toDate(deliveryActivityDate(b))?.getTime() || 0) - (toDate(deliveryActivityDate(a))?.getTime() || 0))[0]
    const tracker = filteredTrackers.find((entry) => Number(entry.id) === Number(latest?.trackerId))
      || filteredTrackers.find((entry) => String(entry.label || '').trim() === String(latest?.truckLabel || '').trim())
      || null
    const totalTonnage = items.reduce((sum, item) => sum + parseQuantity(item.quantity), 0)
    const clients = Array.from(new Set(items.map((item) => item.client).filter(Boolean)))
    const destinations = Array.from(new Set(items.map((item) => item.destination).filter(Boolean)))

    return {
      driver,
      totalTonnage,
      blCount: items.length,
      clients,
      destinations,
      truckLabel: latest?.truckLabel || tracker?.label || '-',
      currentStatus: tracker?.state?.movement_status || 'inconnu',
      currentLocation: trackerLocation(tracker),
      currentSpeed: tracker?.state?.gps?.speed ?? 0,
      currentClient: latest?.client || '-',
      currentDestination: latest?.destination || '-',
      items,
    }
  })

  const existingDrivers = new Set(summaries.map((item) => String(item.driver || '').trim().toUpperCase()))
  const existingTrucks = new Set(summaries.map((item) => String(item.truckLabel || '').trim().toUpperCase()))

  for (const tracker of filteredTrackers) {
    const driver = String(tracker?.employeeName || '').trim()
    const truckLabel = String(tracker?.label || '').trim()
    if (!driver || driver === 'Non assigné') continue
    const driverKey = driver.toUpperCase()
    const truckKey = truckLabel.toUpperCase()
    if (existingDrivers.has(driverKey) || (truckKey && existingTrucks.has(truckKey))) continue
    summaries.push({
      driver,
      totalTonnage: 0,
      blCount: 0,
      clients: [],
      destinations: [],
      truckLabel: truckLabel || '-',
      currentStatus: tracker?.state?.movement_status || 'inconnu',
      currentLocation: trackerLocation(tracker),
      currentSpeed: tracker?.state?.gps?.speed ?? 0,
      currentClient: '-',
      currentDestination: '-',
      items: [],
    })
    existingDrivers.add(driverKey)
    if (truckKey) existingTrucks.add(truckKey)
  }

  return summaries.sort((a, b) => a.driver.localeCompare(b.driver, 'fr'))
}

export function buildDriverReportTotals(driverSummaries = []) {
  const clients = new Set()
  const trucks = new Set()
  return driverSummaries.reduce((acc, item) => {
    acc.drivers += 1
    acc.blCount += item.blCount || 0
    acc.tonnage += Number(item.totalTonnage || 0)
    if (item.truckLabel && item.truckLabel !== '-') trucks.add(item.truckLabel)
    for (const client of item.clients || []) clients.add(client)
    acc.clients = clients.size
    acc.trucks = trucks.size
    return acc
  }, { drivers: 0, blCount: 0, tonnage: 0, clients: 0, trucks: 0 })
}
