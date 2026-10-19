// Version PDF officielle du rapport : les mêmes données que le message WhatsApp, mises
// en page en document A4 (Typst) pour impression, archivage et transmission.
import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const REPORT_PDF_TEMPLATE = join(dirname(new URL(import.meta.url).pathname), '../../docs/rapport-journalier.typ')
export const BUS_REPORT_PDF_TEMPLATE = join(dirname(new URL(import.meta.url).pathname), '../../docs/rapport-bus.typ')
export const REPORT_PDF_LOGO = join(dirname(new URL(import.meta.url).pathname), '../../docs/teliman-logistique-logo.jpg')

// Met en forme les sections du rapport pour le gabarit Typst.
export function buildReportPdfInput(sections = {}, { dateLabel = '', title = 'Rapport journalier' } = {}) {
  return {
    title,
    date: dateLabel || sections?.date || '',
    general: {
      activeTrucks: Number(sections?.general?.activeTrucks || 0),
      fleetSize: Number(sections?.general?.fleetSize || 0),
      missions: Number(sections?.general?.missions || 0),
      zones: Array.isArray(sections?.general?.zones) ? sections.general.zones : [],
    },
    actives: Array.isArray(sections?.actives) ? sections.actives : [],
    inactives: Array.isArray(sections?.inactives) ? sections.inactives : [],
    quantities: Array.isArray(sections?.quantities) ? sections.quantities : [],
  }
}

// Version structurée du rapport bus pour le gabarit PDF.
export function buildBusReportPdfInput(sections = {}, { dateLabel = '' } = {}) {
  const activity = sections?.activity || {}
  const clock = (value) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return `${date.getHours()}h${String(date.getMinutes()).padStart(2, '0')}`
  }
  const durationLabel = (minutes) => {
    if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return '—'
    const total = Math.round(Number(minutes))
    return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`
  }
  const itinerary = Array.isArray(sections?.itinerary) ? sections.itinerary : []
  const expected = ['Kani', 'Fadiadougou', 'Bongogo']
  const found = itinerary.map((step) => String(step.zone || '').toLowerCase())
  return {
    title: 'Rapport bus',
    plate: sections?.plate || '',
    date: dateLabel || sections?.date || '',
    activity: {
      start: clock(activity.startTime),
      end: clock(activity.endTime),
      amplitude: durationLabel(activity.amplitudeMinutes),
      distance: Number.isFinite(Number(activity.distanceKm)) ? Number(activity.distanceKm).toLocaleString('fr-FR') : '—',
      avgSpeed: Number.isFinite(Number(activity.avgSpeed)) ? Number(activity.avgSpeed).toLocaleString('fr-FR') : '—',
      maxSpeed: Number.isFinite(Number(activity.maxSpeed)) ? Number(activity.maxSpeed).toLocaleString('fr-FR') : '—',
      speeds: [
        Number.isFinite(Number(activity.avgSpeed)) ? Number(activity.avgSpeed).toLocaleString('fr-FR') : '—',
        Number.isFinite(Number(activity.maxSpeed)) ? Number(activity.maxSpeed).toLocaleString('fr-FR') : '—',
      ].join(' / '),
    },
    itinerary: itinerary.map((step) => ({ time: step.time || '—', zone: step.zone || '' })),
    missingStops: expected.filter((stop) => !found.some((zone) => zone.includes(stop.toLowerCase().replace('fadia', 'fady')) || zone.includes(stop.toLowerCase()))),
    usualRoute: (Array.isArray(sections?.usualRoute) ? sections.usualRoute : []).map((leg) => leg.path.join(' → ')).join(' · '),
    alerts: {
      speedLimitKmh: Number(sections?.speedLimitKmh || 90),
      speedEpisodes: Array.isArray(sections?.speedEpisodes) ? sections.speedEpisodes : [],
      speedBreaches: Array.isArray(sections?.speedBreaches) ? sections.speedBreaches : [],
      speedAlerts: Array.isArray(sections?.speedAlerts) ? sections.speedAlerts : [],
      crashAlerts: Array.isArray(sections?.crashAlerts) ? sections.crashAlerts : [],
    },
    maintenance: {
      level: sections?.maintenance?.level || 'unknown',
      text: sections?.maintenance?.text || 'Référence de vidange non renseignée.',
    },
  }
}

async function renderPdfInput(input, { outPath, templatePath } = {}) {
  if (!outPath) throw new Error('Chemin de sortie du PDF manquant')
  const dataPath = `${outPath}.data.json`
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(dataPath, JSON.stringify(input, null, 1))
  try {
    // --root / : le gabarit lit le fichier de données hors de son dossier.
    await run('typst', ['compile', '--root', '/', '--input', `data=${dataPath}`, templatePath, outPath], {
      cwd: dirname(templatePath),
      timeout: 60000,
    })
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(outPath))
    return { path: outPath, bytes: size }
  } finally {
    await rm(dataPath, { force: true })
  }
}

export async function renderReportPdf(sections, { dateLabel = '', title = 'Rapport journalier', outPath, templatePath = REPORT_PDF_TEMPLATE } = {}) {
  return renderPdfInput(buildReportPdfInput(sections, { dateLabel, title }), { outPath, templatePath })
}

export async function renderBusReportPdf(sections, { dateLabel = '', outPath, templatePath = BUS_REPORT_PDF_TEMPLATE } = {}) {
  return renderPdfInput(buildBusReportPdfInput(sections, { dateLabel }), { outPath, templatePath })
}
