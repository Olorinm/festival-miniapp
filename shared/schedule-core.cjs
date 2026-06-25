// Shared schedule core logic. Edit this file, then run `node scripts/sync-shared.mjs`.

function toMinutes(time) {
  const parts = String(time).split(':')
  const hour = Number(parts[0] || 0)
  const minute = Number(parts[1] || 0)
  return hour * 60 + minute
}

function endMinutes(screening) {
  const start = toMinutes(screening.start)
  const end = toMinutes(screening.end)
  return end <= start ? end + 24 * 60 : end
}

function resolveScreeningTiming(screening, runtime) {
  const startMinutes = toMinutes(screening.start)
  const runtimeMinutes = Number(runtime)
  const resolvedEndMinutes = screening.end
    ? endMinutes(screening)
    : (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 ? startMinutes + runtimeMinutes : null)
  const duration = Number.isFinite(resolvedEndMinutes)
    ? Math.max(0, resolvedEndMinutes - startMinutes)
    : null
  return {
    startMinutes,
    endMinutes: resolvedEndMinutes,
    duration,
    durationKnown: Number.isFinite(duration)
  }
}

function byScreeningTime(a, b) {
  const dateOrder = a.date.localeCompare(b.date)
  return dateOrder || toMinutes(a.start) - toMinutes(b.start)
}

function hasOverlap(a, b) {
  if (!a || !b || a.id === b.id || a.date !== b.date) {
    return false
  }
  if (!Number.isFinite(a.startMinutes) || !Number.isFinite(a.endMinutes) ||
    !Number.isFinite(b.startMinutes) || !Number.isFinite(b.endMinutes)) {
    return false
  }
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes
}

function findConflicts(screening, selectedIds, allScreenings) {
  const selected = allScreenings.filter(item => selectedIds.includes(item.id))
  return selected.filter(item => hasOverlap(screening, item))
}

function groupByDay(screenings) {
  const map = {}
  screenings.forEach(screening => {
    if (!map[screening.date]) {
      map[screening.date] = {
        date: screening.date,
        dayLabel: screening.dayLabel,
        items: []
      }
    }
    map[screening.date].items.push(screening)
  })
  return Object.keys(map)
    .sort()
    .map(date => map[date])
}

function buildPlan(selectedIds, allScreenings) {
  const selected = allScreenings
    .filter(screening => selectedIds.includes(screening.id))
    .sort(byScreeningTime)

  const conflictPairs = []
  const conflictIds = {}
  selected.forEach((screening, index) => {
    selected.slice(index + 1).forEach(other => {
      if (hasOverlap(screening, other)) {
        conflictPairs.push({
          id: `${screening.id}_${other.id}`,
          a: screening,
          b: other,
          label: `${screening.dayLabel} ${screening.timeRange} ${screening.cnTitle} / ${other.timeRange} ${other.cnTitle}`
        })
        conflictIds[screening.id] = true
        conflictIds[other.id] = true
      }
    })
  })

  const withState = selected.map(screening => ({
    ...screening,
    conflict: !!conflictIds[screening.id]
  }))

  const totalPrice = withState.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const totalMinutes = withState.reduce((sum, item) => {
    return sum + (Number.isFinite(Number(item.duration)) ? Number(item.duration) : 0)
  }, 0)

  return {
    selected: withState,
    days: groupByDay(withState),
    conflictPairs,
    totalPrice,
    totalMinutes
  }
}

module.exports = {
  buildPlan,
  byScreeningTime,
  endMinutes,
  findConflicts,
  groupByDay,
  hasOverlap,
  resolveScreeningTiming,
  toMinutes
}
