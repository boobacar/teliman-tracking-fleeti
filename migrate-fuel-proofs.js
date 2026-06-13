/**
 * Migration : extraire les images base64 de fuel-vouchers.json → fichiers sur disque
 * Exécution : node migrate-fuel-proofs.js
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data'
const FUEL_VOUCHERS_FILE = path.join(DATA_DIR, 'fuel-vouchers.json')
const FUEL_PROOFS_DIR = path.join(DATA_DIR, 'uploads', 'fuel-proofs')

console.log(`📂 Lecture: ${FUEL_VOUCHERS_FILE}`)
const raw = fs.readFileSync(FUEL_VOUCHERS_FILE, 'utf8')
const vouchers = JSON.parse(raw)
console.log(`📊 ${vouchers.length} bons carburant trouvés`)

fs.mkdirSync(FUEL_PROOFS_DIR, { recursive: true })

function persistBase64Photo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return dataUrl
  // Déjà un chemin complet
  if (dataUrl.startsWith('/uploads/')) return dataUrl
  // Déjà un chemin relatif → convertir
  if (dataUrl.startsWith('fuel-proofs/')) return `/uploads/${dataUrl}`
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
  if (!match) return dataUrl

  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
  const base64Payload = match[2]
  const fileName = `fuel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const filePath = path.join(FUEL_PROOFS_DIR, fileName)
  fs.writeFileSync(filePath, Buffer.from(base64Payload, 'base64'))
  return `/uploads/fuel-proofs/${fileName}`
}

let extractedCount = 0
let skippedCount = 0
const seenPaths = new Map() // déduplication : même base64 → même fichier

for (const voucher of vouchers) {
  // Traiter proofPhotoDataUrl (champ unique)
  if (voucher.proofPhotoDataUrl && voucher.proofPhotoDataUrl.startsWith('data:image/')) {
    const hash = voucher.proofPhotoDataUrl.slice(0, 100)
    if (seenPaths.has(hash)) {
      voucher.proofPhotoDataUrl = seenPaths.get(hash)
      skippedCount++
    } else {
      const newPath = persistBase64Photo(voucher.proofPhotoDataUrl)
      seenPaths.set(hash, newPath)
      voucher.proofPhotoDataUrl = newPath
      extractedCount++
    }
  }

  // Traiter proofPhotoDataUrls (liste)
  if (Array.isArray(voucher.proofPhotoDataUrls)) {
    voucher.proofPhotoDataUrls = voucher.proofPhotoDataUrls.map((url) => {
      if (!url || !url.startsWith('data:image/')) return url
      const hash = url.slice(0, 100)
      if (seenPaths.has(hash)) {
        skippedCount++
        return seenPaths.get(hash)
      }
      const newPath = persistBase64Photo(url)
      seenPaths.set(hash, newPath)
      extractedCount++
      return newPath
    })
  }
}

console.log(`💾 Écriture du fichier mis à jour...`)
fs.writeFileSync(FUEL_VOUCHERS_FILE, JSON.stringify(vouchers, null, 2))
const newSize = fs.statSync(FUEL_VOUCHERS_FILE).size
console.log(`✅ Migration terminée !`)
console.log(`   📸 ${extractedCount} images extraites`)
console.log(`   🔄 ${skippedCount} doublons évités`)
console.log(`   📦 Nouvelle taille: ${(newSize / 1024 / 1024).toFixed(2)} MB (avant: ${(Buffer.byteLength(raw) / 1024 / 1024).toFixed(2)} MB)`)
console.log(`   📁 Fichiers dans fuel-proofs/: ${fs.readdirSync(FUEL_PROOFS_DIR).length}`)
