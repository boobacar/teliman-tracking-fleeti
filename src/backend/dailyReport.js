// Rapport « quel camion a fait quoi » — construction du message, sans aucune
// dépendance : on lui donne des données déjà lues ailleurs, il rend un texte.
//
// Principe de rédaction (validé par l'utilisateur) :
//  - une ligne d'en-tête et un résumé ;
//  - un bloc par camion qui a bougé, 4 à 6 lignes maximum ;
//  - les camions sans activité regroupés sur une seule ligne ;
//  - sélection et non volume : on résume, on ne déverse pas.
//
// Règle absolue : aucune valeur inventée. Une donnée absente disparaît de la
// ligne concernée (elle n'est jamais remplacée par un zéro ou une estimation).

const ENTER_LABEL = 'Entrée'
const EXIT_LABEL = 'Sortie'

function pad2(value) {
  return String(value).padStart(2, '0')
}

// Heure locale de la plateforme, format « 15h07 ».
export function formatClock(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  return `${pad2(date.getHours())}h${pad2(date.getMinutes())}`
}

export function formatDayKey(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatMinutes(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const totalMinutes = Math.round(seconds / 60)
  return `${Math.floor(totalMinutes / 60)}h${pad2(totalMinutes % 60)}`
}

function formatKilometres(km) {
  if (km == null || !Number.isFinite(km) || km <= 0) return null
  return `${Math.round(km)} km`
}

// « 39151WWCI01 » → « 39151 » : forme courte pour la ligne des camions sans activité.
export function shortTruckLabel(label) {
  const text = String(label || '').trim()
  return text.replace(/WWCI0?\d*$/i, '').trim() || text
}

function truckKeyOf(entry) {
  const id = entry?.trackerId ?? entry?.tracker_id ?? entry?.id
  if (id !== undefined && id !== null && String(id).trim()) return `id:${String(id).trim()}`
  return `label:${String(entry?.truckLabel || entry?.label || entry?.truck || '').trim()}`
}

function resolvedLabel(bucket) {
  return bucket.label || bucket.driver || 'Camion non renseigné'
}

// Découpe par camion tout ce qui s'est passé dans la journée.
function bucketise({ day, orders, events, fleetRows, vouchers, alerts }) {
  const buckets = new Map()

  const ensure = (entry) => {
    const key = truckKeyOf(entry)
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: String(entry?.truckLabel || entry?.label || '').trim(),
        driver: '',
        missions: [],
        zoneEvents: [],
        incidentCounts: new Map(),
        fuel: [],
        distanceKm: null,
        drivingSeconds: null,
        restSeconds: null,
      })
    }
    const bucket = buckets.get(key)
    const label = String(entry?.truckLabel || entry?.label || '').trim()
    if (label && !bucket.label) bucket.label = label
    return bucket
  }

  for (const row of fleetRows || []) {
    const bucket = ensure(row)
    if (row.driver) bucket.driver = row.driver
    if (Number.isFinite(Number(row.distanceKm))) bucket.distanceKm = Number(row.distanceKm)
    if (Number.isFinite(Number(row.drivingSeconds))) bucket.drivingSeconds = Number(row.drivingSeconds)
    if (Number.isFinite(Number(row.restSeconds))) bucket.restSeconds = Number(row.restSeconds)
  }

  for (const order of orders || []) {
    const dayKeys = [formatDayKey(order.date), formatDayKey(order.departureDateTime), formatDayKey(order.completedAt), formatDayKey(order.arrivalDateTime)]
    if (!dayKeys.includes(day)) continue
    const bucket = ensure(order)
    if (order.driver && !bucket.driver) bucket.driver = order.driver
    bucket.missions.push(order)
  }

  for (const event of events || []) {
    if (formatDayKey(event.createdAt) !== day) continue
    const bucket = ensure(event)
    bucket.zoneEvents.push(event)
  }

  for (const voucher of vouchers || []) {
    const dayKey = formatDayKey(voucher.date) || formatDayKey(voucher.createdAt)
    if (dayKey !== day) continue
    const bucket = ensure(voucher)
    bucket.fuel.push(voucher)
  }

  for (const alert of alerts || []) {
    const dayKey = formatDayKey(alert.createdAt || alert.timestamp || alert.time)
    if (dayKey !== day) continue
    const bucket = ensure(alert)
    const label = String(alert.label || alert.type || alert.eventType || 'alerte').trim()
    bucket.incidentCounts.set(label, (bucket.incidentCounts.get(label) || 0) + 1)
  }

  for (const bucket of buckets.values()) {
    bucket.zoneEvents.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    bucket.missions.sort((a, b) => new Date(a.departureDateTime || a.date || 0) - new Date(b.departureDateTime || b.date || 0))
    bucket.hasActivity = Boolean(
      bucket.missions.length
      || bucket.zoneEvents.length
      || bucket.fuel.length
      || bucket.incidentCounts.size
      || (bucket.distanceKm || 0) > 0
      || (bucket.drivingSeconds || 0) > 0,
    )
  }

  return buckets
}

function activityScore(bucket) {
  return bucket.missions.length * 100 + bucket.zoneEvents.length * 5 + bucket.incidentCounts.size * 10 + (bucket.distanceKm || 0) / 10
}

function missionLines(bucket, maxGroups = 3) {
  // Les agents créent parfois plusieurs bons identiques (même client, même trajet,
  // même marchandise) : plutôt que de répéter la ligne, on l'annonce une fois avec
  // le nombre de missions et l'amplitude horaire réelle.
  const groups = new Map()
  for (const mission of bucket.missions) {
    const route = [mission.loadingPoint, mission.destination].filter(Boolean).join(' → ')
    const signature = [String(mission.client || '').trim(), route, String(mission.goods || '').trim()].join('|')
    if (!groups.has(signature)) groups.set(signature, { mission, route, count: 0, missions: [] })
    const group = groups.get(signature)
    group.count += 1
    group.missions.push(mission)
  }

  const selected = [...groups.values()].slice(0, maxGroups)
  const lines = []
  for (const group of selected) {
    const { mission, route } = group
    const client = String(mission.client || '').trim()
    const goods = String(mission.goods || '').trim()
    const head = [client, route].filter(Boolean).join(' - ')
    const countSuffix = group.count > 1 ? ` — ${group.count} missions` : ''
    lines.push(`- ${head}${countSuffix}${goods ? ` (${goods})` : ''}`.trim())

    const sorted = [...group.missions].sort((a, b) => new Date(a.departureDateTime || a.date || 0) - new Date(b.departureDateTime || b.date || 0))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const times = []
    const departure = formatClock(first.departureDateTime)
    if (departure) times.push(`départ ${departure}`)
    const deliveredCount = group.missions.filter((item) => String(item.status || '') === 'Livré').length
    const lastDoneRaw = last.completedAt || last.arrivalDateTime
    const done = formatClock(lastDoneRaw)
    const departureDate = first.departureDateTime ? new Date(first.departureDateTime).getTime() : null
    const doneDate = lastDoneRaw ? new Date(lastDoneRaw).getTime() : null
    // Une heure de clôture antérieure au départ vient d'une saisie ou d'une clôture
    // administrative : on ne l'affiche pas plutôt que d'écrire l'absurde.
    const coherent = done && (departureDate === null || doneDate === null || doneDate >= departureDate)
    if (deliveredCount === group.count) times.push(coherent ? `${group.count > 1 ? 'livrées jusqu’à' : 'livré'} ${done}` : `${group.count > 1 ? `${group.count} livrées` : 'livré'}`)
    else if (deliveredCount > 0) times.push(`${deliveredCount}/${group.count} livrée${deliveredCount > 1 ? 's' : ''}`)
    else times.push(`statut ${String(first.status || 'en cours').toLowerCase()}`)
    lines.push(`  ${times.join(' · ')}`)
  }
  const remaining = groups.size - selected.length
  if (remaining > 0) lines.push(`- … et ${remaining} autre${remaining > 1 ? 's' : ''} mission${remaining > 1 ? 's' : ''}`)
  return lines
}

function zoneLines(bucket, maxEvents = 3) {
  const events = bucket.zoneEvents.slice(-maxEvents)
  const lines = events.map((event) => {
    const kind = String(event.eventType || '').toLowerCase() === 'exit' ? EXIT_LABEL : ENTER_LABEL
    const zone = String(event.geofenceName || event.zoneName || 'zone').trim()
    const clock = formatClock(event.createdAt)
    return `- ${kind} de zone ${zone}${clock ? ` à ${clock}` : ''}`
  })
  if (bucket.zoneEvents.length > events.length) {
    const rest = bucket.zoneEvents.length - events.length
    lines.push(`- … et ${rest} autre${rest > 1 ? 's' : ''} passage${rest > 1 ? 's' : ''} de zone`)
  }
  return lines
}

function incidentLines(bucket) {
  return [...bucket.incidentCounts.entries()].map(([label, count]) => `- ${count} ${label}${count > 1 ? 's' : ''}`)
}

function fuelLines(bucket) {
  return bucket.fuel.map((voucher) => {
    const litres = Number(voucher.liters ?? voucher.quantity ?? 0)
    const reference = String(voucher.voucherNumber || voucher.reference || '').trim()
    const parts = [litres > 0 ? `${Math.round(litres)} L` : null, reference ? `bon ${reference}` : null].filter(Boolean)
    return `- Carburant${parts.length ? ` : ${parts.join(' · ')}` : ''}`
  })
}

function metricsLine(bucket) {
  const parts = [formatMinutes(bucket.drivingSeconds) && `Conduite ${formatMinutes(bucket.drivingSeconds)}`, formatMinutes(bucket.restSeconds) && `repos ${formatMinutes(bucket.restSeconds)}`, formatKilometres(bucket.distanceKm)].filter(Boolean)
  return parts.length ? [`- ${parts.join(' · ')}`] : []
}

function renderBlock(bucket) {
  const title = [resolvedLabel(bucket), bucket.driver && bucket.label ? bucket.driver : ''].filter(Boolean).join(' - ')
  const lines = [
    ...missionLines(bucket),
    ...zoneLines(bucket),
    ...incidentLines(bucket),
    ...fuelLines(bucket),
    ...metricsLine(bucket),
  ]
  if (!lines.length) lines.push('- Aucun mouvement enregistré')
  return `${title}\n${lines.join('\n')}`
}

// Bilan de la semaine : une ligne par camion, agrégats uniquement (le détail
// mission par mission reste dans le rapport quotidien).
export function buildWeeklyReport({
  dayFrom,
  dayTo,
  dateLabel,
  hourLabel = '08h',
  orders = [],
  events = [],
  fleetRows = [],
  vouchers = [],
  knownTrucks = [],
  title = 'TELIMAN LOGISTIQUE',
} = {}) {
  if (!dayFrom || !dayTo) throw new Error('Semaine du rapport manquante (dayFrom, dayTo).')
  const inWeek = (isoString) => {
    const key = formatDayKey(isoString)
    return Boolean(key) && key >= dayFrom && key <= dayTo
  }

  const rows = new Map()
  const ensure = (entry) => {
    const key = truckKeyOf(entry)
    if (!rows.has(key)) rows.set(key, { key, label: '', driver: '', missions: 0, zones: 0, fuel: 0, distanceKm: 0, drivingSeconds: 0, restSeconds: 0, hasKm: false, hasDrive: false })
    const row = rows.get(key)
    const label = String(entry?.truckLabel || entry?.label || '').trim()
    if (label && !row.label) row.label = label
    if (entry?.driver && !row.driver) row.driver = entry.driver
    return row
  }

  for (const row of fleetRows || []) {
    const bucket = ensure(row)
    if (Number.isFinite(Number(row.distanceKm))) { bucket.distanceKm = Number(row.distanceKm); bucket.hasKm = true }
    if (Number.isFinite(Number(row.drivingSeconds))) { bucket.drivingSeconds = Number(row.drivingSeconds); bucket.hasDrive = true }
    if (Number.isFinite(Number(row.restSeconds))) bucket.restSeconds = Number(row.restSeconds)
  }
  for (const order of orders || []) {
    if (![order.date, order.departureDateTime, order.completedAt, order.arrivalDateTime].some(inWeek)) continue
    ensure(order).missions += 1
  }
  for (const event of events || []) {
    if (!inWeek(event.createdAt)) continue
    ensure(event).zones += 1
  }
  for (const voucher of vouchers || []) {
    if (!inWeek(voucher.date) && !inWeek(voucher.createdAt)) continue
    ensure(voucher).fuel += 1
  }
  for (const truck of knownTrucks || []) ensure(truck)

  const list = [...rows.values()].filter((row) => row.missions || row.zones || row.fuel || row.hasKm || row.hasDrive)
  list.sort((a, b) => (b.missions - a.missions) || (b.zones - a.zones) || (b.distanceKm - a.distanceKm))

  const totals = list.reduce((acc, row) => ({
    missions: acc.missions + row.missions,
    zones: acc.zones + row.zones,
    fuel: acc.fuel + row.fuel,
    km: acc.km + (row.hasKm ? row.distanceKm : 0),
  }), { missions: 0, zones: 0, fuel: 0, km: 0 })

  const header = `${title} - Bilan de la semaine${dateLabel ? ` (${dateLabel})` : ''}`
  const summary = [
    `${list.length} camion${list.length > 1 ? 's' : ''} en activité`,
    `${totals.missions} mission${totals.missions > 1 ? 's' : ''}`,
    `${totals.zones} passage${totals.zones > 1 ? 's' : ''} de zone`,
    totals.fuel ? `${totals.fuel} bon${totals.fuel > 1 ? 's' : ''} carburant` : null,
  ].filter(Boolean).join(' · ')

  const blocks = list.map((row) => {
    const parts = [
      `${row.missions} mission${row.missions > 1 ? 's' : ''}`,
      row.hasKm ? formatKilometres(row.distanceKm) : null,
      row.hasDrive ? `conduite ${formatMinutes(row.drivingSeconds)}` : null,
      row.zones ? `${row.zones} passage${row.zones > 1 ? 's' : ''} de zone` : null,
      row.fuel ? `${row.fuel} bon${row.fuel > 1 ? 's' : ''} carburant` : null,
    ].filter(Boolean)
    const title = [row.label || 'Camion non renseigné', row.driver].filter(Boolean).join(' - ')
    return `${title}\n- ${parts.join(' · ')}`
  })

  return {
    text: [header, '', summary, '', ...blocks.flatMap((block) => [block, ''])].join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    stats: { trucks: list.length, missions: totals.missions, zoneEvents: totals.zones, fuelVouchers: totals.fuel, distanceKm: Math.round(totals.km) },
  }
}
export function buildDailyReport({
  day,
  dateLabel,
  hourLabel = '20h',
  orders = [],
  events = [],
  fleetRows = [],
  vouchers = [],
  alerts = [],
  knownTrucks = [],
  hour = 20,
  fleetDetailsAvailable = true,
  maxChars = 1800,
  title = 'TELIMAN LOGISTIQUE',
} = {}) {
  if (!day) throw new Error('Journée du rapport manquante (day).')
  const bucketMap = bucketise({ day, orders, events, fleetRows, vouchers, alerts })

  // Les camions du parc sans aucune donnée du jour sont listés comme sans activité.
  for (const truck of knownTrucks || []) {
    const bucket = bucketMap.get(truckKeyOf(truck))
    if (bucket && !bucket.hasActivity) continue
    if (bucket) continue
    bucketMap.set(truckKeyOf(truck), {
      key: truckKeyOf(truck),
      label: String(truck.label || truck.truckLabel || '').trim(),
      driver: '', missions: [], zoneEvents: [], incidentCounts: new Map(), fuel: [],
      distanceKm: null, drivingSeconds: null, restSeconds: null, hasActivity: false,
    })
  }

  const active = [...bucketMap.values()].filter((bucket) => bucket.hasActivity).sort((a, b) => activityScore(b) - activityScore(a))
  const inactive = [...bucketMap.values()].filter((bucket) => !bucket.hasActivity)

  const missionTotal = active.reduce((sum, bucket) => sum + bucket.missions.length, 0)
  const zoneTotal = active.reduce((sum, bucket) => sum + bucket.zoneEvents.length, 0)
  const fuelTotal = active.reduce((sum, bucket) => sum + bucket.fuel.length, 0)

  const summaryParts = [
    `${active.length} camion${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''}`,
    `${missionTotal} mission${missionTotal > 1 ? 's' : ''}`,
    `${zoneTotal} passage${zoneTotal > 1 ? 's' : ''} de zone`,
  ]
  if (fuelTotal) summaryParts.push(`${fuelTotal} bon${fuelTotal > 1 ? 's' : ''} carburant`)

  const header = `${title} - Rapport du ${dateLabel || day} à ${hourLabel || `${hour}h`}`
  const footerLine = inactive.length
    ? `Sans activité aujourd'hui : ${inactive.map((bucket) => shortTruckLabel(bucket.label) || 'camion non renseigné').join(', ')}`
    : 'Tous les camions ont eu de l’activité.'

  // Le message doit rester lisible sur un téléphone : on retire les blocs les
  // moins actifs tant que la longueur dépasse la limite, et on les compte.
  let blocks = active.map((bucket) => ({ bucket, text: renderBlock(bucket) }))
  let removed = 0
  const assemble = () => {
    const parts = [header, '', summaryParts.join(' · '), '']
    for (const block of blocks) { parts.push(block.text, '') }
    if (removed) parts.push(`… et ${removed} autre${removed > 1 ? 's' : ''} camion${removed > 1 ? 's' : ''} actif${removed > 1 ? 's' : ''} (détail sur la plateforme)`, '')
    parts.push(footerLine)
    if (!fleetDetailsAvailable) parts.push('', 'Détails kilométrage/conduite indisponibles (données Fleeti non reçues).')
    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  let text = assemble()
  while (text.length > maxChars && blocks.length > 1) {
    blocks = blocks.slice(0, blocks.length - 1)
    removed += 1
    text = assemble()
  }

  return {
    text,
    day,
    stats: {
      activeTrucks: active.length,
      inactiveTrucks: inactive.length,
      missions: missionTotal,
      zoneEvents: zoneTotal,
      fuelVouchers: fuelTotal,
      incidents: active.reduce((sum, bucket) => sum + [...bucket.incidentCounts.values()].reduce((a, b) => a + b, 0), 0),
      blocks: blocks.length,
      removedBlocks: removed,
      length: text.length,
    },
  }
}
