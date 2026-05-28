const { interestOptions: fallbackInterestOptions } = require('../data/festival')

const noInterest = {
  key: 'none',
  label: '',
  shortLabel: '',
  rank: 0,
  tone: 'gray'
}

function getInterestMeta(key) {
  if (!key || key === 'none' || key === 'pending') {
    return noInterest
  }
  let app = null
  try {
    app = typeof getApp === 'function' ? getApp() : null
  } catch (error) {}
  const interestOptions = app && app.globalData && Array.isArray(app.globalData.interestOptions)
    ? app.globalData.interestOptions
    : fallbackInterestOptions
  return interestOptions.find(item => item.key === key) || noInterest
}

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

function byScreeningTime(a, b) {
  const dateOrder = a.date.localeCompare(b.date)
  return dateOrder || toMinutes(a.start) - toMinutes(b.start)
}

function buildScreenings(films, marks) {
  const filmMarks = marks || {}
  return films
    .reduce((list, film) => {
      const interest = getInterestMeta(filmMarks[film.id] || film.defaultInterest)
      const interestKey = interest.key
      const rows = film.screenings.map(screening => ({
        filmId: film.id,
        cnTitle: film.cnTitle,
        enTitle: film.enTitle,
        section: film.section,
        director: film.director,
        country: film.country,
        year: film.year,
        runtime: film.runtime,
        interestKey,
        interest,
        timeRange: `${screening.start}-${screening.end}`,
        startMinutes: toMinutes(screening.start),
        endMinutes: endMinutes(screening),
        duration: endMinutes(screening) - toMinutes(screening.start),
        screenMeta: compactMeta([film.section, film.year, film.director]),
        searchText: [
          film.cnTitle,
          film.enTitle,
          film.director,
          film.section,
          screening.cinema,
          screening.hall
        ].join(' ').toLowerCase(),
        ...screening
      }))
      return list.concat(rows)
    }, [])
    .sort(byScreeningTime)
}

function compactMeta(items) {
  return items
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function findFilm(films, filmId) {
  return films.find(film => film.id === filmId)
}

function findScreening(screenings, screeningId) {
  return screenings.find(screening => screening.id === screeningId)
}

function hasOverlap(a, b) {
  if (!a || !b || a.id === b.id || a.date !== b.date) {
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
  const totalMinutes = withState.reduce((sum, item) => sum + (Number(item.duration) || 0), 0)

  return {
    selected: withState,
    days: groupByDay(withState),
    conflictPairs,
    totalPrice,
    totalMinutes
  }
}

function collectStats(films, selectedIds, marks) {
  const allScreenings = buildScreenings(films, marks)
  const selected = allScreenings.filter(screening => selectedIds.includes(screening.id))
  const selectedFilmIds = {}
  selected.forEach(screening => {
    selectedFilmIds[screening.filmId] = true
  })
  return {
    filmCount: films.length,
    selectedCount: selected.length,
    selectedFilmCount: Object.keys(selectedFilmIds).length,
    totalPrice: selected.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  }
}

function runtimeText(runtime) {
  const hour = Math.floor(runtime / 60)
  const minute = runtime % 60
  return hour ? `${hour}小时${minute ? `${minute}分` : ''}` : `${minute}分`
}

module.exports = {
  buildPlan,
  buildScreenings,
  collectStats,
  compactMeta,
  findConflicts,
  findFilm,
  findScreening,
  getInterestMeta,
  groupByDay,
  runtimeText
}
