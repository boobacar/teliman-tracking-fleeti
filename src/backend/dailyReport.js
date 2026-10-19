// Rapport journalier « TLM » — structure demandée par la direction de Teliman
// Logistique (document « TRACKING RAPPORT ») :
//   1. Suivi général : camions actifs, missions, entrées par zone
//   2. Camions actifs : immatriculation – chauffeur, missions, heures de départ et de
//      livraison avec statut, position actuelle, distance / conduite / repos
//   3. Camions inactifs : immatriculation – chauffeur, « pas de mission »
//   4. Quantités livrées ou chargées par client : chargée / livrée / en cours
//
// Aucune valeur estimée : une donnée absente de la plateforme n'est pas inventée, elle
// est soit omise, soit annoncée « indisponible » quand la direction l'attend.
import { OFFICIAL_TRUCKS, driverFor, isReportExcluded, plateFor } from './truckRegistry.js'
import { detectSpeedBreaches, extractSpeedFromMessage, formatSpeedEpisode, groupSpeedBreaches, shortenPlace } from './speedEpisodes.js'

export const REPORTED_ZONES = [
  { label: 'Zone Korhogo', patterns: ['korhogo'] },
  { label: 'Zone Fadiadougou', patterns: ['fadyadougou', 'fadiadougou'] },
  { label: 'Zone Bouaké', patterns: ['bouake'] },
]

const ALERT_LABELS = {
  speedup: 'excès de vitesse',
  excessive_parking: 'stationnement prolongé',
  crash_alarm: 'alerte accident',
  fuel_level_leap: 'variation de carburant',
  geofence_enter: 'entrée de zone',
  geofence_exit: 'sortie de zone',
}

const ALERT_LABELS_PLURAL = {
  speedup: 'excès de vitesse',
  excessive_parking: 'stationnements prolongés',
  crash_alarm: 'alertes accident',
  fuel_level_leap: 'variations de carburant',
  geofence_enter: 'entrées de zone',
  geofence_exit: 'sorties de zone',
}

// « 1 stationnement prolongé » / « 3 stationnements prolongés »
function pluralise(count, label, type = '') {
  if (count <= 1) return label
  if (type && ALERT_LABELS_PLURAL[type]) return ALERT_LABELS_PLURAL[type]
  return label.endsWith('al') ? `${label.slice(0, -2)}aux` : `${label}s`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function formatDayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateLabel(day) {
  const [year, month, date] = String(day || '').split('-')
  return year && month && date ? `${date}/${month}/${year}` : String(day || '')
}

function formatClock(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getHours()}h${pad(date.getMinutes())}`
}

function dayKeyOfOrder(order) {
  for (const candidate of [order?.date, order?.departureDateTime, order?.completedAt, order?.arrivalDateTime]) {
    const key = formatDayKey(candidate)
    if (key) return key
  }
  return ''
}

// Les quantités sont saisies au format français (« 52,940 »). On les additionne
// telles quelles, sans conversion d'unité inventée.
export function parseQuantity(value) {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  const cleaned = raw.replace(/\s|\u00a0/g, '').replace(/,/g, '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}

export function formatQuantity(value) {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 1000) / 1000
  const [integer, decimals] = String(rounded).split('.')
  const withSeparators = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decimals ? `${withSeparators},${decimals}` : withSeparators
}

const PLACE_LABELS = {
  bouake: 'Bouaké',
  korhogo: 'Korhogo',
  abidjan: 'Abidjan',
  fadyadougou: 'Fadiadougou',
  fadiadougou: 'Fadiadougou',
  'san pedro': 'San Pédro',
  yamoussoukro: 'Yamoussoukro',
  ferkessedougou: 'Ferkessédougou',
}

export function displayPlace(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // « Fadyadougou, mine » : on garde le site (mine, client, carrière) mais on écrit le
  // nom de la ville comme la direction l'écrit.
  const [head, ...rest] = raw.split(',')
  const key = head.trim().toLowerCase()
  const place = PLACE_LABELS[key] || head.trim().charAt(0).toUpperCase() + head.trim().slice(1).toLowerCase()
  return [place, ...rest.map((part) => part.trim().toLowerCase())].join(', ')
}

function normalizeZoneName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function labelOfRecord(record) {
  return String(record?.truckLabel || record?.trackerLabel || record?.label || record?.plate || '').trim()
}

export function filterExcludedTrucks(records = [], { excludedTrucks = [], registry = OFFICIAL_TRUCKS } = {}) {
  if (!excludedTrucks.length) return records
  return records.filter((record) => !isReportExcluded(labelOfRecord(record), { exclusions: excludedTrucks, entries: registry }))
}

function inDay(value, day) {
  const key = formatDayKey(value)
  return Boolean(key) && key === day
}

function truckKeyOf(record) {
  const trackerId = record?.trackerId ?? record?.tracker_id
  if (trackerId !== null && trackerId !== undefined && String(trackerId).trim() !== '') return `id:${String(trackerId)}`
  const label = String(record?.truckLabel || record?.trackerLabel || '').trim()
  return label ? `label:${label.toUpperCase()}` : ''
}

function bucketise({ orders, events, fleetRows, vouchers, alerts, day, registry }) {
  const buckets = new Map()
  const ensure = (key, seed = {}) => {
    if (!key) return null
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        trackerId: seed.trackerId ?? seed.tracker_id ?? null,
        rawLabel: seed.truckLabel || seed.trackerLabel || '',
        missions: [],
        enters: [],
        exits: [],
        incidents: [],
        alertDetails: [],
        vouchers: [],
        distanceKm: null,
        drivingSeconds: null,
        restSeconds: null,
      })
    }
    const bucket = buckets.get(key)
    if (!bucket.rawLabel && (seed.truckLabel || seed.trackerLabel)) bucket.rawLabel = seed.truckLabel || seed.trackerLabel
    if (bucket.trackerId === null && seed.trackerId !== undefined) bucket.trackerId = seed.trackerId
    return bucket
  }

  for (const order of orders) {
    if (dayKeyOfOrder(order) !== day) continue
    const bucket = ensure(truckKeyOf(order), order)
    if (bucket) bucket.missions.push(order)
  }

  for (const event of events) {
    if (!inDay(event?.createdAt ?? event?.timestamp, day)) continue
    const type = String(event?.eventType || event?.type || '')
    if (type !== 'enter' && type !== 'exit') continue
    const bucket = ensure(truckKeyOf(event), event)
    if (!bucket) continue
    const entry = { zone: String(event?.geofenceName || event?.zone || ''), at: event?.createdAt ?? event?.timestamp, type }
    if (type === 'enter') bucket.enters.push(entry)
    else bucket.exits.push(entry)
  }

  for (const alert of alerts) {
    if (day && !inDay(alert?.createdAt ?? alert?.timestamp ?? alert?.time, day)) continue
    const type = String(alert?.event || alert?.type || '')
    if (type === 'geofence_enter' || type === 'geofence_exit') continue
    // Sans identifiant ni étiquette, l'alerte est regroupée à part (comptée, jamais
    // attribuée à un camion).
    const bucket = ensure(truckKeyOf(alert) || 'orphan', alert)
    if (bucket) {
      bucket.incidents.push(type)
      const vitesse = Number(alert?.speed ?? alert?.speed_kmh ?? alert?.vitesse)
      bucket.alertDetails.push({
        type,
        // La vitesse figure dans le message de l'alerte quand le champ dédié est vide.
        speed: Number.isFinite(vitesse) && vitesse > 0 ? vitesse : (extractSpeedFromMessage(alert?.message) ?? null),
        at: alert?.createdAt ?? alert?.timestamp ?? alert?.time ?? '',
        lat: Number(alert?.lat ?? alert?.location?.lat),
        lng: Number(alert?.lng ?? alert?.lon ?? alert?.location?.lng),
        place: shortenPlace(alert?.place || alert?.address || alert?.location?.address || ''),
      })
    }
  }

  for (const voucher of vouchers) {
    if (!inDay(voucher?.date ?? voucher?.createdAt, day)) continue
    const bucket = ensure(truckKeyOf(voucher), voucher)
    if (bucket) bucket.vouchers.push(voucher)
  }

  for (const row of fleetRows) {
    const bucket = ensure(truckKeyOf(row), row)
    if (!bucket) continue
    const distance = Number(row?.distanceKm)
    const driving = Number(row?.drivingSeconds ?? row?.tripDurationSec)
    const rest = Number(row?.restSeconds ?? row?.parkingDurationSec)
    if (Number.isFinite(distance)) bucket.distanceKm = distance
    if (Number.isFinite(driving)) bucket.drivingSeconds = driving
    if (Number.isFinite(rest)) bucket.restSeconds = rest
  }

  for (const bucket of buckets.values()) {
    bucket.plate = plateFor(bucket.rawLabel, { registry, fallback: bucket.rawLabel })
    bucket.driver = driverFor(bucket.rawLabel, { registry, fallback: '' })
    const active = bucket.missions.length > 0
      || bucket.enters.length + bucket.exits.length > 0
      || (Number.isFinite(bucket.distanceKm) && bucket.distanceKm > 0)
      || (Number.isFinite(bucket.drivingSeconds) && bucket.drivingSeconds > 0)
    bucket.active = active
    bucket.score = bucket.missions.length * 1000 + (bucket.enters.length + bucket.exits.length) * 10 + Math.round(bucket.distanceKm || 0)
  }

  return [...buckets.values()].sort((a, b) => b.score - a.score || a.plate.localeCompare(b.plate))
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds / 60)
  return `${Math.floor(total / 60)}h${pad(total % 60)}`
}

// Missions regroupées : plusieurs bons identiques (même client, même trajet, même
// marchandise) sont annoncés une seule fois avec leur nombre.
function missionGroups(bucket, maxGroups = 2) {
  const groups = new Map()
  for (const mission of bucket.missions) {
    const route = [displayPlace(mission.loadingPoint), displayPlace(mission.destination)].filter(Boolean).join(' → ')
    const signature = [String(mission.client || '').trim(), route, String(mission.goods || '').trim()].join('|')
    if (!groups.has(signature)) groups.set(signature, { route, client: String(mission.client || '').trim(), goods: String(mission.goods || '').trim(), count: 0, missions: [] })
    const group = groups.get(signature)
    group.count += 1
    group.missions.push(mission)
  }
  const selected = [...groups.values()].slice(0, maxGroups)
  const lines = []
  for (const group of selected) {
    const head = [group.client, group.route].filter(Boolean).join(' : ')
    const count = group.count > 1 ? ` — ${group.count} missions` : ''
    const goods = group.goods ? ` (${group.goods.toLowerCase()})` : ''
    lines.push(`${head}${count}${goods}`.trim())
    const sorted = [...group.missions].sort((a, b) => new Date(a.departureDateTime || a.date || 0) - new Date(b.departureDateTime || b.date || 0))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const departure = formatClock(first.departureDateTime)
    const delivered = group.missions.filter((mission) => String(mission.status || '') === 'Livré').length
    const closingRaw = last.completedAt || last.arrivalDateTime
    const closing = formatClock(closingRaw)
    const departureTime = first.departureDateTime ? new Date(first.departureDateTime).getTime() : null
    const closingTime = closingRaw ? new Date(closingRaw).getTime() : null
    const coherent = closing && (departureTime === null || closingTime === null || closingTime >= departureTime)
    const times = []
    if (departure) times.push(`départ ${departure}`)
    if (delivered === group.count) times.push(coherent ? `livraison ${closing} (livré)` : 'livré')
    else if (delivered > 0) times.push(`${delivered}/${group.count} livrée${delivered > 1 ? 's' : ''}`)
    else times.push(`en cours (${String(first.status || 'en cours').toLowerCase()})`)
    lines.push(`  ${times.join(' · ')}`)
  }
  const remaining = groups.size - selected.length
  if (remaining > 0) lines.push(`  … et ${remaining} autre${remaining > 1 ? 's' : ''} mission${remaining > 1 ? 's' : ''}`)
  return lines
}

// Regroupe les passages par site : « Fadiadougou, mine — 4 passages (5h48 → 8h26) ».
export function summariseZones(movements = []) {
  const order = []
  const grouped = new Map()
  for (const movement of [...movements].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0))) {
    const zone = displayPlace(movement.zone)
    if (!zone) continue
    if (!grouped.has(zone)) {
      grouped.set(zone, { zone, steps: [] })
      order.push(zone)
    }
    grouped.get(zone).steps.push({ type: movement.type === 'exit' ? 'sortie' : 'entrée', at: formatClock(movement.at), raw: movement.at })
  }
  return order.map((zone) => {
    const { steps } = grouped.get(zone)
    const times = steps.map((step) => step.at).filter(Boolean)
    if (steps.length <= 2) {
      return `${zone} — ${steps.map((step) => `${step.type} ${step.at}`).filter((text) => !text.endsWith(' ')).join(' puis ')}`
    }
    const entries = steps.filter((step) => step.type === 'entrée').length
    const exits = steps.length - entries
    const parts = [entries ? `${entries} entrée${entries > 1 ? 's' : ''}` : null, exits ? `${exits} sortie${exits > 1 ? 's' : ''}` : null].filter(Boolean)
    return `${zone} — ${parts.join(', ')} (${times[0]} → ${times[times.length - 1]})`
  })
}

function zoneSummary(events, day) {
  const counters = REPORTED_ZONES.map((zone) => ({ label: zone.label, count: 0 }))
  let other = 0
  for (const event of events) {
    const type = String(event?.eventType || event?.type || '')
    if (type !== 'enter') continue
    if (!inDay(event?.createdAt ?? event?.timestamp, day)) continue
    const name = normalizeZoneName(event?.geofenceName || event?.zone)
    const zone = REPORTED_ZONES.find((candidate) => candidate.patterns.some((pattern) => name.includes(pattern)))
    if (zone) counters.find((counter) => counter.label === zone.label).count += 1
    else other += 1
  }
  return { counters, other }
}

function clientQuantities(orders, day) {
  const byClient = new Map()
  for (const order of orders) {
    if (dayKeyOfOrder(order) !== day) continue
    const client = String(order.client || '').trim() || 'Client non renseigné'
    const quantity = parseQuantity(order.quantity)
    if (!byClient.has(client)) byClient.set(client, { client, charged: null, delivered: null, inProgress: null, missions: 0 })
    const row = byClient.get(client)
    row.missions += 1
    if (quantity !== null) {
      row.charged = (row.charged || 0) + quantity
      if (String(order.status || '') === 'Livré') row.delivered = (row.delivered || 0) + quantity
    }
  }
  for (const row of byClient.values()) {
    if (row.charged !== null && row.delivered !== null) row.inProgress = Math.max(0, Math.round((row.charged - row.delivered) * 1000) / 1000)
    else if (row.charged !== null) row.inProgress = null
  }
  return [...byClient.values()].sort((a, b) => (b.charged || 0) - (a.charged || 0) || a.client.localeCompare(b.client))
}

export function buildDailyReport({
  day,
  dateLabel,
  hourLabel = '',
  orders = [],
  events = [],
  fleetRows = [],
  vouchers = [],
  alerts = [],
  trucks = [],
  positions = [],
  excludedTrucks = [],
  registry = OFFICIAL_TRUCKS,
  maxChars = 2400,
}) {
  // Véhicules exclus (ex. le bus) : retirés avant tout calcul.
  const exclus = { excludedTrucks, registry }
  orders = filterExcludedTrucks(orders, exclus)
  events = filterExcludedTrucks(events, exclus)
  fleetRows = filterExcludedTrucks(fleetRows, exclus)
  vouchers = filterExcludedTrucks(vouchers, exclus)
  alerts = filterExcludedTrucks(alerts, exclus)
  positions = filterExcludedTrucks(positions, exclus)
  trucks = filterExcludedTrucks(trucks, exclus)
  const buckets = bucketise({ orders, events, fleetRows, vouchers, alerts, day, registry })
  // Les alertes sans étiquette de camion ne peuvent être attribuées : elles sont
  // comptées à part plutôt que d'afficher un bloc sans immatriculation.
  const unattributed = buckets.filter((bucket) => !bucket.rawLabel).reduce((sum, bucket) => sum + bucket.incidents.length, 0)
  const identifiable = buckets.filter((bucket) => bucket.rawLabel)
  const active = identifiable.filter((bucket) => bucket.active)
  const inactive = identifiable.filter((bucket) => !bucket.active)
  const { counters, other } = zoneSummary(events, day)
  const quantities = clientQuantities(orders, day)

  // Excès de vitesse au-delà du seuil, regroupés en épisodes par camion (endroit inclus).
  const speedEpisodes = []
  for (const bucket of buckets) {
    const breaches = (bucket.alertDetails || [])
      .filter((detail) => Number(detail.speed) > 90)
      .map((detail) => ({ speed: detail.speed, at: detail.at, lat: detail.lat, lng: detail.lng, place: detail.place }))
    for (const episode of groupSpeedBreaches(breaches).slice(0, 2)) {
      speedEpisodes.push({ plate: bucket.plate, ...episode })
    }
  }
  speedEpisodes.sort((a, b) => b.maxSpeed - a.maxSpeed)
  const positionByKey = new Map()
  for (const position of positions) {
    const key = truckKeyOf(position)
    if (!key) continue
    const address = String(position?.address || '').trim()
    const zone = String(position?.geofence || position?.geofenceName || '').trim()
    const lat = Number(position?.lat)
    const lng = Number(position?.lng)
    if (address) positionByKey.set(key, address)
    else if (zone) positionByKey.set(key, displayPlace(zone))
    else if (Number.isFinite(lat) && Number.isFinite(lng)) positionByKey.set(key, `hors zone (${lat.toFixed(3)}, ${lng.toFixed(3)})`)
  }

  const header = `TELIMAN LOGISTIQUE - Rapport journalier du ${dateLabel}${hourLabel ? ` (${hourLabel})` : ''}`
  const lines = [header, '']
  lines.push('SUIVI GÉNÉRAL')
  const fleetSize = Math.max(buckets.length, trucks.length)
  lines.push(`Camions actifs : ${active.length}${fleetSize ? ` / ${fleetSize}` : ''} · Missions : ${active.reduce((sum, bucket) => sum + bucket.missions.length, 0)}`)
  const zoneLine = counters.map((counter) => `${counter.label} : ${counter.count} entrée${counter.count > 1 ? 's' : ''}`).join(' · ')
  lines.push(other > 0 ? `${zoneLine} · Autres zones : ${other}` : zoneLine)

  const renderActive = (bucket) => {
    const block = [`${bucket.plate}${bucket.driver ? ` - ${bucket.driver}` : ' - chauffeur non renseigné'}`]
    if (bucket.missions.length) {
      block.push(...missionGroups(bucket))
    } else {
      block.push(bucket.enters.length || bucket.exits.length ? 'Pas de mission — passages de zone uniquement' : 'Pas de mission')
    }
    const address = positionByKey.get(bucket.key)
    block.push(`  Position : ${address || 'indisponible'}`)
    const metrics = []
    if (Number.isFinite(bucket.distanceKm)) metrics.push(`${Math.round(bucket.distanceKm).toLocaleString('fr-FR')} km`)
    const driving = durationLabel(bucket.drivingSeconds)
    if (driving) metrics.push(`conduite ${driving}`)
    const rest = durationLabel(bucket.restSeconds)
    if (rest) metrics.push(`repos ${rest}`)
    if (metrics.length) block.push(`  ${metrics.join(' · ')}`)
    return block
  }

  const renderInactive = (bucket) => {
    const parking = bucket.incidents.filter((type) => type === 'excessive_parking').length
    const suffix = parking ? `${pluralise(parking, 'stationnement prolongé')}${parking > 1 ? ` (${parking})` : ''}` : 'pas de mouvement enregistré'
    return `- ${bucket.plate}${bucket.driver ? ` - ${bucket.driver}` : ''} : pas de mission — ${suffix}`
  }

  const activeBlocks = active.map(renderActive)
  lines.push('', 'CAMIONS ACTIFS')
  let kept = 0
  for (const block of activeBlocks) {
    const candidate = [...lines, ...block].join('\n')
    if (candidate.length > maxChars && kept > 0) break
    lines.push(...block)
    kept += 1
  }
  const skipped = active.length - kept
  if (skipped > 0) lines.push(`… et ${skipped} autre${skipped > 1 ? 's' : ''} camion${skipped > 1 ? 's' : ''} actif${skipped > 1 ? 's' : ''} (détail dans la plateforme)`)

  lines.push('', 'CAMIONS INACTIFS')
  if (inactive.length) lines.push(...inactive.map(renderInactive))
  else lines.push('- Aucun : tous les camions ont eu de l’activité')

  if (speedEpisodes.length) {
    lines.push('', 'EXCÈS DE VITESSE (plus de 90 km/h)')
    for (const episode of speedEpisodes.slice(0, 5)) {
      lines.push(`- ${episode.plate} : ${formatSpeedEpisode(episode)}`)
    }
  }

  lines.push('', 'QUANTITÉS LIVRÉES OU CHARGÉES PAR CLIENT')
  if (quantities.length) {
    for (const row of quantities) {
      const parts = []
      parts.push(`chargée ${row.charged === null ? 'non renseignée' : formatQuantity(row.charged)}`)
      parts.push(`livrée ${row.delivered === null ? 'aucune mission livrée' : formatQuantity(row.delivered)}`)
      parts.push(`en cours ${row.inProgress === null ? 'non renseignée' : formatQuantity(row.inProgress)}`)
      lines.push(`- ${row.client} (${row.missions} mission${row.missions > 1 ? 's' : ''}) : ${parts.join(' · ')}`)
    }
  } else {
    lines.push('- Aucune mission enregistrée aujourd’hui')
  }

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    text,
    sections: buildSections({ header, buckets, active, inactive, positions: positionByKey, counts: { counters, other }, quantities, day, fleetEpisodes: speedEpisodes }),
    stats: {
      activeTrucks: active.length,
      inactiveTrucks: inactive.length,
      missions: active.reduce((sum, bucket) => sum + bucket.missions.length, 0),
      zoneEntries: counters.reduce((sum, counter) => sum + counter.count, 0) + other,
      zoneCounters: counters,
      otherZones: other,
      clients: quantities.map((row) => ({ client: row.client, charged: row.charged, delivered: row.delivered, inProgress: row.inProgress, missions: row.missions })),
      truncatedTrucks: skipped,
      unattributedAlerts: unattributed,
      excludedTrucks: excludedTrucks.length,
      length: text.length,
    },
  }
}

// Bilan hebdomadaire : agrégats par camion sur la semaine (le détail mission par
// mission reste dans le rapport journalier).
export function buildWeeklyReport({
  dayFrom,
  dayTo,
  dateLabel,
  orders = [],
  events = [],
  fleetRows = [],
  vouchers = [],
  alerts = [],
  excludedTrucks = [],
  registry = OFFICIAL_TRUCKS,
  maxChars = 2400,
}) {
  const exclus = { excludedTrucks, registry }
  orders = filterExcludedTrucks(orders, exclus)
  events = filterExcludedTrucks(events, exclus)
  fleetRows = filterExcludedTrucks(fleetRows, exclus)
  vouchers = filterExcludedTrucks(vouchers, exclus)
  alerts = filterExcludedTrucks(alerts, exclus)
  const days = []
  const cursor = new Date(`${dayFrom}T12:00:00`)
  const end = new Date(`${dayTo}T12:00:00`)
  while (cursor <= end && days.length < 14) {
    days.push(formatDayKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  const rows = []
  for (const day of days) {
    const result = buildDailyReport({ day, dateLabel: formatDateLabel(day), orders, events, fleetRows, vouchers, alerts, registry, maxChars: Number.MAX_SAFE_INTEGER })
    for (const client of result.stats.clients) {
      const existing = rows.find((row) => row.client === client.client)
      if (existing) {
        existing.missions += client.missions
        existing.charged = (existing.charged || 0) + (client.charged || 0)
        existing.delivered = (existing.delivered || 0) + (client.delivered || 0)
      } else {
        rows.push({ ...client })
      }
    }
  }

  const alertsSemaine = alerts.filter((alert) => days.includes(formatDayKey(alert?.createdAt ?? alert?.timestamp ?? alert?.time)))
  const buckets = bucketise({ orders, events: [], fleetRows, vouchers, alerts: alertsSemaine, day: '', registry })
  const lines = [`TELIMAN LOGISTIQUE - Bilan hebdomadaire ${dateLabel}`, '']
  const totalMissions = orders.filter((order) => days.includes(dayKeyOfOrder(order))).length
  lines.push(`Missions de la semaine : ${totalMissions} · Camions suivis : ${buckets.length}`)

  const volumeText = (bucket) => {
    const parts = []
    if (Number.isFinite(bucket.distanceKm)) parts.push(`${Math.round(bucket.distanceKm).toLocaleString('fr-FR')} km`)
    return parts
  }

  for (const bucket of buckets) {
    const missions = orders.filter((order) => truckKeyOf(order) === bucket.key && days.includes(dayKeyOfOrder(order))).length
    const vouchersWeek = vouchers.filter((voucher) => truckKeyOf(voucher) === bucket.key && days.includes(formatDayKey(voucher?.date ?? voucher?.createdAt))).length
    const weekEvents = events.filter((event) => truckKeyOf(event) === bucket.key && days.includes(formatDayKey(event?.createdAt ?? event?.timestamp))).length
    const parts = [`${missions} mission${missions > 1 ? 's' : ''}`]
    parts.push(...volumeText(bucket))
    if (weekEvents) parts.push(`${weekEvents} passage${weekEvents > 1 ? 's' : ''} de zone`)
    if (vouchersWeek) parts.push(`${vouchersWeek} bon${vouchersWeek > 1 ? 's' : ''} carburant`)
    lines.push(`- ${bucket.plate}${bucket.driver ? ` - ${bucket.driver}` : ''} : ${parts.join(' · ')}`)
  }

  const episodesSemaine = []
  for (const bucket of buckets) {
    const breaches = (bucket.alertDetails || [])
      .filter((detail) => Number(detail.speed) > 90)
      .map((detail) => ({ speed: detail.speed, at: detail.at, lat: detail.lat, lng: detail.lng, place: detail.place }))
    for (const episode of groupSpeedBreaches(breaches).slice(0, 2)) {
      episodesSemaine.push({ plate: bucket.plate, ...episode })
    }
  }
  episodesSemaine.sort((a, b) => b.maxSpeed - a.maxSpeed)
  if (episodesSemaine.length) {
    lines.push('', 'EXCÈS DE VITESSE (plus de 90 km/h)')
    for (const episode of episodesSemaine.slice(0, 5)) {
      lines.push(`- ${episode.plate} : ${formatSpeedEpisode(episode)}`)
    }
  }

  lines.push('', 'QUANTITÉS PAR CLIENT (semaine)')
  if (rows.length) {
    for (const row of rows) {
      lines.push(`- ${row.client} (${row.missions} mission${row.missions > 1 ? 's' : ''}) : chargée ${formatQuantity(row.charged || 0)} · livrée ${formatQuantity(row.delivered || 0)} · en cours ${formatQuantity(Math.max(0, (row.charged || 0) - (row.delivered || 0)))}`)
    }
  } else {
    lines.push('- Aucune mission enregistrée sur la période')
  }

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars)
  return { text, stats: { days: days.length, missions: totalMissions, clients: rows.length, length: text.length } }
}

// Version structurée du rapport (utilisée par le PDF officiel) : mêmes données, mises
// en forme pour un document tabulaire.
function buildSections({ header, buckets, active, inactive, positions, counts, quantities, day, fleetEpisodes = [] }) {
  const truckBlock = (bucket) => {
    const missions = []
    const seen = new Map()
    for (const mission of bucket.missions) {
      const route = [displayPlace(mission.loadingPoint), displayPlace(mission.destination)].filter(Boolean).join(' → ')
      const signature = [String(mission.client || '').trim(), route, String(mission.goods || '').trim()].join('|')
      if (!seen.has(signature)) {
        seen.set(signature, { client: String(mission.client || '').trim(), route, goods: String(mission.goods || '').trim(), count: 0, missions: [], quantity: 0 })
        missions.push(seen.get(signature))
      }
      const group = seen.get(signature)
      group.count += 1
      group.missions.push(mission)
      const parsed = parseQuantity(mission.quantity)
      if (parsed !== null) group.quantity += parsed
    }
    const missionRows = []
    for (const group of missions) {
      const sorted = [...group.missions].sort((a, b) => new Date(a.departureDateTime || a.date || 0) - new Date(b.departureDateTime || b.date || 0))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      group.departure = formatClock(first.departureDateTime)
      const raw = last.completedAt || last.arrivalDateTime
      const closing = formatClock(raw)
      const depTime = first.departureDateTime ? new Date(first.departureDateTime).getTime() : null
      const closeTime = raw ? new Date(raw).getTime() : null
      group.closing = closing && (depTime === null || closeTime === null || closeTime >= depTime) ? closing : ''
      const delivered = group.missions.filter((mission) => String(mission.status || '') === 'Livré').length
      group.status = delivered === group.count ? 'Livré' : delivered > 0 ? `${delivered}/${group.count} livrée` : (String(first.status || 'En cours'))
      missionRows.push({
        client: group.client,
        route: group.route,
        goods: group.goods,
        count: group.count,
        departure: group.departure,
        closing: group.closing,
        status: group.status,
        quantity: group.quantity ? formatQuantity(group.quantity) : '',
      })
    }
    const incidents = new Map()
    for (const type of bucket.incidents) incidents.set(type, (incidents.get(type) || 0) + 1)
    return {
      plate: bucket.plate,
      oldPlate: bucket.rawLabel && bucket.rawLabel !== bucket.plate ? bucket.rawLabel : '',
      driver: bucket.driver || '',
      missions: missionRows,
      zones: summariseZones([...bucket.enters, ...bucket.exits]).map((text) => ({ text })),
      hasMissions: bucket.missions.length > 0,
      position: positions.get(bucket.key) || 'indisponible',
      distanceKm: Number.isFinite(bucket.distanceKm) ? Math.round(bucket.distanceKm) : null,
      driving: durationLabel(bucket.drivingSeconds),
      rest: durationLabel(bucket.restSeconds),
      incidents: [...incidents.entries()].map(([type, count]) => ({ label: pluralise(count, ALERT_LABELS[type] || type, type), count })),
      vouchers: bucket.vouchers.length,
    }
  }

  return {
    header,
    day,
    general: {
      activeTrucks: active.length,
      fleetSize: Math.max(buckets.length, active.length),
      missions: active.reduce((sum, bucket) => sum + bucket.missions.length, 0),
      zones: [
        ...counts.counters.map((counter) => ({ label: counter.label.replace(/^Zone /, ''), count: counter.count })),
        ...(counts.other > 0 ? [{ label: 'Autres zones', count: counts.other }] : []),
      ],
    },
    actives: active.map(truckBlock),
    speedEpisodes: (fleetEpisodes || []).slice(0, 5),
    inactives: inactive.map((bucket) => ({
      plate: bucket.plate,
      oldPlate: bucket.rawLabel && bucket.rawLabel !== bucket.plate ? bucket.rawLabel : '',
      driver: bucket.driver || '',
      reason: bucket.incidents.some((type) => type === 'excessive_parking') ? 'Pas de mission — stationnement prolongé' : 'Pas de mission',
    })),
    quantities: quantities.map((row) => ({
      client: row.client,
      missions: row.missions,
      charged: row.charged === null ? '' : formatQuantity(row.charged),
      delivered: row.delivered === null ? '' : formatQuantity(row.delivered),
      inProgress: row.inProgress === null ? '' : formatQuantity(row.inProgress),
    })),
  }
}
