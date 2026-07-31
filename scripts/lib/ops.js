import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export const DEFAULT_BACKUP_ROOT = '/home/pi/backups/teliman'
export const AUTHORITY_KEY = 'json_migration_authority_v1'

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function sqliteQuickCheck(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.pragma('quick_check')
    const values = rows.map((row) => String(Object.values(row)[0]))
    if (values.length !== 1 || values[0] !== 'ok') {
      throw new Error(`PRAGMA quick_check a échoué: ${values.join('; ') || 'aucun résultat'}`)
    }
    return 'ok'
  } finally {
    db.close()
  }
}

export async function createVerifiedSqliteBackup(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size === 0) {
    throw new Error(`Base SQLite absente ou vide: ${sourcePath}`)
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 })
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(destinationPath)
  } finally {
    source.close()
  }
  if (!fs.existsSync(destinationPath) || fs.statSync(destinationPath).size === 0) {
    throw new Error('Le snapshot SQLite produit est vide')
  }
  // Un backup issu d'une base WAL conserve le mode WAL dans son en-tête. Le
  // repasser en journal DELETE évite de publier des sidecars éphémères.
  const snapshot = new Database(destinationPath, { fileMustExist: true })
  try {
    snapshot.pragma('journal_mode = DELETE')
    const rows = snapshot.pragma('quick_check')
    if (rows.length !== 1 || String(Object.values(rows[0])[0]) !== 'ok') {
      throw new Error('PRAGMA quick_check a échoué sur le snapshot')
    }
  } finally {
    snapshot.close()
  }
  sqliteQuickCheck(destinationPath)
  const checksum = sha256File(destinationPath)
  if (sha256File(destinationPath) !== checksum) throw new Error('Checksum SQLite instable')
  return { checksum, size: fs.statSync(destinationPath).size, quickCheck: 'ok' }
}

export function assertTreeHasNoLinks(root) {
  if (!fs.existsSync(root)) return
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans le backup: ${current}`)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name))
    } else if (!stat.isFile()) {
      throw new Error(`Type de fichier spécial refusé dans le backup: ${current}`)
    }
  }
}

export function listFiles(root) {
  const files = []
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const rel = path.relative(root, full)
      const stat = fs.lstatSync(full)
      if (stat.isDirectory()) visit(full)
      else if (stat.isFile()) files.push(rel)
      else throw new Error(`Entrée non régulière refusée: ${rel}`)
    }
  }
  visit(root)
  return files
}

export function writeChecksums(root, excluded = new Set(['SHA256SUMS'])) {
  const lines = listFiles(root)
    .filter((rel) => !excluded.has(rel))
    .map((rel) => `${sha256File(path.join(root, rel))}  ${rel}`)
  if (lines.length === 0) throw new Error('Aucun fichier à inclure dans SHA256SUMS')
  fs.writeFileSync(path.join(root, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o600 })
  for (const line of lines) {
    const separator = line.indexOf('  ')
    const expected = line.slice(0, separator)
    const rel = line.slice(separator + 2)
    if (sha256File(path.join(root, rel)) !== expected) throw new Error(`Checksum invalide: ${rel}`)
  }
  return lines.length
}
