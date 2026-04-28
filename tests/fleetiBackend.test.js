import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chunkIds,
  fetchAllPublicAssets,
  resolveScopedTrackerIds,
} from '../src/backend/fleetiBackend.js'

test('fetchAllPublicAssets pagine Asset/Search avec Skip/Take jusqu’à la dernière page', async () => {
  const calls = []
  const pages = [
    { results: [{ id: 1 }, { id: 2 }] },
    { results: [{ id: 3 }, { id: 4 }] },
    { results: [{ id: 5 }] },
  ]

  const rows = await fetchAllPublicAssets({
    take: 2,
    publicApiGet: async (path, query) => {
      calls.push({ path, query })
      return pages[query.Skip / query.Take]
    },
  })

  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5])
  assert.deepEqual(calls, [
    { path: '/Asset/Search', query: { Take: 2, Skip: 0 } },
    { path: '/Asset/Search', query: { Take: 2, Skip: 2 } },
    { path: '/Asset/Search', query: { Take: 2, Skip: 4 } },
  ])
})

test('resolveScopedTrackerIds ne limite pas la flotte quand FLEETI_TRACKER_IDS est vide', () => {
  assert.deepEqual(resolveScopedTrackerIds([11, 22, 33], []), [11, 22, 33])
})

test('resolveScopedTrackerIds garde seulement les ids configurés quand ils existent', () => {
  assert.deepEqual(resolveScopedTrackerIds([11, 22, 33], [22, 99]), [22])
})

test('chunkIds découpe les gros appels Fleeti par paquets stables', () => {
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})
