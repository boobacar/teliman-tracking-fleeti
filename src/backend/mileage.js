export function computeTodayMileage({
  odometer,
  dayStartOdometer,
  todayMileageFromState,
  cachedTodayMileage,
  hasPreviousDayStart,
}) {
  const stateMileage = Math.max(0, Number(todayMileageFromState || 0))
  const cacheMileage = Math.max(0, Number(cachedTodayMileage || 0))

  if (Number.isFinite(Number(odometer)) && hasPreviousDayStart && Number.isFinite(Number(dayStartOdometer))) {
    return Math.max(0, Number((Number(odometer) - Number(dayStartOdometer)).toFixed(2)))
  }

  return Math.max(stateMileage, cacheMileage)
}
