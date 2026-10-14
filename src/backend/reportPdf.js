// Version PDF officielle du rapport : les mêmes données que le message WhatsApp, mises
// en page en document A4 (Typst) pour impression, archivage et transmission.
import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const REPORT_PDF_TEMPLATE = join(dirname(new URL(import.meta.url).pathname), '../../docs/rapport-journalier.typ')
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

export async function renderReportPdf(sections, { dateLabel = '', title = 'Rapport journalier', outPath, templatePath = REPORT_PDF_TEMPLATE } = {}) {
  if (!outPath) throw new Error('Chemin de sortie du PDF manquant')
  const input = buildReportPdfInput(sections, { dateLabel, title })
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
