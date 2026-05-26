import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTodayMileage } from '../src/backend/mileage.js'

test('returns odometer delta when day baseline exists', () => {
  const value = computeTodayMileage({
    odometer: 77580,
    dayStartOdometer: 77397.29,
    todayMileageFromState: 0,
    cachedTodayMileage: 0,
    hasPreviousDayStart: true,
  })
  assert.equal(value, 182.71)
})

test('never uses raw odometer as daily mileage when baseline is missing', () => {
  const value = computeTodayMileage({
    odometer: 77580,
    dayStartOdometer: 77580,
    todayMileageFromState: 182.71,
    cachedTodayMileage: 0,
    hasPreviousDayStart: false,
  })
  assert.equal(value, 182.71)
  assert.notEqual(value, 77580)
})

test('falls back to cached value when state daily mileage is unavailable', () => {
  const value = computeTodayMileage({
    odometer: Number.NaN,
    dayStartOdometer: Number.NaN,
    todayMileageFromState: 0,
    cachedTodayMileage: 64.3,
    hasPreviousDayStart: false,
  })
  assert.equal(value, 64.3)
})
