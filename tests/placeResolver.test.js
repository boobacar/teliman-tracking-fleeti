// Lieu des excès de vitesse : zone déclarée, sinon géocodage inverse, sinon coordonnées.
// Règle métier : l'endroit n'est affiché que pour un dépassement au-delà du seuil (90 km/h).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createGeocodeCache, createPlaceResolver, describeSpeedBreaches, findZone, haversineKm } from '../src/backend/placeResolver.js'
import { buildBusReport } from '../src/backend/busReport.js'

const ZONES = [
  { name: 'Fadyadougou, mine', lat: 8.731041, lng: -6.649475, radiusMeters: 5900 },
  { name: 'Bouaké', lat: 7.687516, lng: -5.044778, radiusMeters: 15800 },
]

test('distance : cohérence du calcul', () => {
  const d = haversineKm({ lat: 8.731041, lng: -6.649475 }, { lat: 8.731041, lng: -6.649475 })
  assert.equal(Math.round(d), 0)
  const bouake = haversineKm({ lat: 8.731041, lng: -6.649475 }, { lat: 7.687516, lng: -5.044778 })
  assert.ok(bouake > 200 && bouake < 220, `distance inattendue : ${bouake}`)
})

test('zone : un point dans le rayon donne le nom de la zone', () => {
  const zone = findZone({ lat: 8.735, lng: -6.65 }, ZONES)
  assert.equal(zone.name, 'Fadyadougou, mine')
  assert.equal(zone.source, 'zone')
  assert.equal(findZone({ lat: 6.5, lng: -4.0 }, ZONES), null, 'hors de toute zone')
})

test('géocodage : mise en cache et repli propre sans réseau', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geocode-'))
  const cachePath = path.join(dir, 'cache.json')
  let appels = 0
  const resolver = createPlaceResolver({
    cachePath,
    minIntervalMs: 0,
    fetchImpl: async () => {
      appels += 1
      return { ok: true, json: async () => ({ address: { road: 'Route de Korhogo', village: 'Kani' } }) }
    },
  })
  const premier = await resolver.describe({ lat: 8.4773, lng: -6.6102 }, { zones: [] })
  assert.equal(premier.label, 'Route de Korhogo, Kani')
  assert.equal(premier.source, 'geocode')
  const second = await resolver.describe({ lat: 8.4773, lng: -6.6102 }, { zones: [] })
  assert.equal(second.label, 'Route de Korhogo, Kani')
  assert.equal(appels, 1, 'un même point n’est géocodé qu’une fois (cache)')
  assert.ok(fs.existsSync(cachePath), 'le cache est écrit sur disque')

  // Service injoignable : on retombe sur les coordonnées, jamais sur un lieu inventé.
  const muet = createPlaceResolver({ fetchImpl: async () => { throw new Error('réseau indisponible') }, minIntervalMs: 0, logger: { warn() {} } })
  const repli = await muet.describe({ lat: 8.4773, lng: -6.6102 }, { zones: [] })
  assert.equal(repli.source, 'coords')
  assert.match(repli.label, /^8\.4773, -6\.6102$/)
})

test('cache : sérialisation et relecture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geocode-'))
  const filePath = path.join(dir, 'cache.json')
  const cache = createGeocodeCache({ filePath })
  cache.set({ lat: 8.4, lng: -6.6 }, 'Kani')
  cache.persist()
  const relu = createGeocodeCache({ filePath })
  assert.equal(relu.get({ lat: 8.4, lng: -6.6 }), 'Kani')
  assert.equal(relu.get({ lat: 1, lng: 1 }), null)
})

test('dépassements : endroit seulement au-delà de 90 km/h', async () => {
  const resolver = createPlaceResolver({
    minIntervalMs: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: { village: 'Kani' } }) }),
  })
  const breaches = await describeSpeedBreaches(
    [
      { speed: 96, time: '18h35', lat: 8.4773, lng: -6.6102 },
      { speed: 91, time: '18h36', lat: 8.4773, lng: -6.6102 },
      { speed: 78, time: '19h02', lat: 8.4773, lng: -6.6102 },
      { speed: 95, time: '19h10', lat: 8.731, lng: -6.6495 },
    ],
    { zones: ZONES, resolver, minSpeedKmh: 90 },
  )
  assert.equal(breaches[0].place, 'Kani')
  assert.equal(breaches[1].place, 'Kani')
  assert.equal(breaches[2].place, undefined, '78 km/h : aucun endroit affiché')
  assert.equal(breaches[3].place, 'Fadyadougou, mine', 'la zone déclarée prime sur le géocodage')
})

test('rapport bus : ligne d’excès avec lieu, et sans lieu sous le seuil', () => {
  const jour = '2026-10-16'
  const points = [
    { lat: 8.4773, lng: -6.6102, speed: 96, time: `${jour}T18:35:00Z` },
    { lat: 8.4773, lng: -6.6102, speed: 78, time: `${jour}T19:02:00Z` },
  ]
  const { text } = buildBusReport({
    plate: '5273WWCI01',
    day: jour,
    dateLabel: '16/10/2026',
    points,
    events: [],
    alerts: [],
    speedBreaches: [
      { speed: 96, time: '18h35', place: 'Kani' },
      { speed: 78, time: '19h02', place: 'Kani' },
    ],
  })
  assert.ok(text.includes('18h35 : pointe 96 km/h — Kani'), text)
  assert.ok(text.includes('19h02 : pointe 78 km/h\n'), '78 km/h : pas de lieu')
  assert.ok(!text.includes('78 km/h — '), 'aucun endroit ne doit suivre un dépassement sous le seuil')
})
