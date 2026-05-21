export function parseDeliveryQuantity(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value ?? '').trim()
  if (!raw) return 0

  const compact = raw
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/(?:tonnes?|tons?|tn)$/i, '')
    .replace(/t$/i, '')

  const match = compact.match(/-?\d+(?:\.\d+)?/)
  if (!match) return 0
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatDeliveryQuantity(value, { digits = 3, unit = false } = {}) {
  if (value === null || value === undefined || value === '') return '-'
  const parsed = parseDeliveryQuantity(value)
  if (!Number.isFinite(parsed)) return String(value)
  const formatted = parsed.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return unit ? `${formatted} t` : formatted
}

export function normalizeDeliveryQuantity(value, digits = 3) {
  const parsed = parseDeliveryQuantity(value)
  if (!Number.isFinite(parsed) || parsed === 0) return ''
  return parsed.toFixed(digits).replace('.', ',')
}

export function normalizeDeliveryReference(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^BL[-\s]*/i, '')
    .replace(/\s+/g, '')
    .replace(/^0+(?=\d)/, '')
}

export function deliveryActivityTimestamp(order = {}) {
  const candidates = [
    order.date,
    order.arrivalDateTime,
    order.completedAt,
    order.departureDateTime,
    order.createdAt,
    order.updatedAt,
  ]
  for (const value of candidates) {
    if (!value) continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getTime()
  }
  const id = Number(order.id)
  return Number.isFinite(id) ? id : 0
}

function hasProof(order = {}) {
  return Boolean(order.proofPhotoDataUrl) || (Array.isArray(order.proofPhotoDataUrls) && order.proofPhotoDataUrls.length > 0)
}

export function chooseBestDeliveryOrder(left = {}, right = {}) {
  const leftQty = parseDeliveryQuantity(left.quantity)
  const rightQty = parseDeliveryQuantity(right.quantity)
  const leftScore = [
    hasProof(left) ? 4 : 0,
    left.status === 'Livré' ? 2 : 0,
    left.active ? 1 : 0,
    leftQty > 0 ? 1 : 0,
    deliveryActivityTimestamp(left) / 1e15,
  ].reduce((a, b) => a + b, 0)
  const rightScore = [
    hasProof(right) ? 4 : 0,
    right.status === 'Livré' ? 2 : 0,
    right.active ? 1 : 0,
    rightQty > 0 ? 1 : 0,
    deliveryActivityTimestamp(right) / 1e15,
  ].reduce((a, b) => a + b, 0)

  const winner = rightScore > leftScore ? right : left
  const loser = winner === left ? right : left
  return {
    ...loser,
    ...winner,
    quantity: normalizeDeliveryQuantity(winner.quantity || loser.quantity) || String(winner.quantity || loser.quantity || '').trim(),
    duplicateIds: Array.from(new Set([
      ...(Array.isArray(winner.duplicateIds) ? winner.duplicateIds : []),
      ...(Array.isArray(loser.duplicateIds) ? loser.duplicateIds : []),
      winner.id,
      loser.id,
    ].filter(Boolean))),
  }
}

export function dedupeDeliveryOrders(rows = []) {
  const seen = new Map()
  const result = []
  let removed = 0

  for (const row of Array.isArray(rows) ? rows : []) {
    const normalizedRow = {
      ...row,
      reference: String(row?.reference ?? '').trim(),
      quantity: normalizeDeliveryQuantity(row?.quantity) || String(row?.quantity ?? '').trim(),
    }
    const refKey = normalizeDeliveryReference(normalizedRow.reference)
    const key = refKey
      ? `ref:${refKey}`
      : `row:${normalizedRow.id ?? result.length}`

    if (!seen.has(key)) {
      seen.set(key, result.length)
      result.push(normalizedRow)
      continue
    }

    const index = seen.get(key)
    result[index] = chooseBestDeliveryOrder(result[index], normalizedRow)
    removed += 1
  }

  return { rows: result, removed }
}
