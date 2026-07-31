#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_STORAGE_UUID = '8966697c-0fb2-467c-8496-acbe858b6a7e'

export function evaluateStorage({ uuid, expectedUuid, options, mountpoint }) {
  if (!uuid || uuid !== expectedUuid) throw new Error(`UUID inattendu pour ${mountpoint}: ${uuid || 'absent'}`)
  const flags = new Set(String(options).split(','))
  if (!flags.has('rw') || flags.has('ro')) throw new Error(`Stockage monté en lecture seule: ${mountpoint}`)
  return { mountpoint, uuid, readWrite: true }
}

export function inspectStorage({ mountpoint = '/mnt/netac-storage', expectedUuid = process.env.TELIMAN_STORAGE_UUID || DEFAULT_STORAGE_UUID, dataDir = process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data' } = {}) {
  const fields = execFileSync('findmnt', ['-J', '-o', 'TARGET,UUID,OPTIONS', '--target', mountpoint], { encoding: 'utf8' })
  const parsed = JSON.parse(fields)
  const filesystem = parsed.filesystems?.[0]
  if (!filesystem || path.resolve(filesystem.target) !== path.resolve(mountpoint)) throw new Error(`${mountpoint} n'est pas un point de montage autonome`)
  const result = evaluateStorage({ mountpoint, expectedUuid, uuid: filesystem.uuid, options: filesystem.options })
  if (!fs.statSync(dataDir).isDirectory()) throw new Error(`Répertoire de données absent: ${dataDir}`)
  const probe = path.join(dataDir, `.readiness-${process.pid}`)
  try {
    fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 })
    fs.fsyncSync(fs.openSync(probe, 'r'))
  } finally { fs.rmSync(probe, { force: true }) }
  return { ...result, dataDir, writable: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const get = (name, fallback) => {
      const index = process.argv.indexOf(`--${name}`)
      return index === -1 ? fallback : process.argv[index + 1]
    }
    console.log(JSON.stringify(inspectStorage({
      mountpoint: get('mountpoint', '/mnt/netac-storage'),
      expectedUuid: get('expected-uuid', process.env.TELIMAN_STORAGE_UUID || DEFAULT_STORAGE_UUID),
      dataDir: get('data-dir', process.env.TELIMAN_DATA_DIR || '/mnt/netac-storage/teliman-data'),
    }), null, 2))
  } catch (error) {
    console.error(`STORAGE NOT READY: ${error.message}`)
    process.exitCode = 1
  }
}
