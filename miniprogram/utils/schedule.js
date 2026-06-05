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

function resolveScreeningInterest(film, filmById, filmMarks) {
  const ids = [film.id].concat(Array.isArray(film.memberFilmIds) ? film.memberFilmIds : [])
  return ids.reduce((best, id) => {
    const sourceFilm = id === film.id ? film : filmById.get(id)
    const interest = getInterestMeta(filmMarks[id] || (sourceFilm && sourceFilm.defaultInterest))
    return interest.rank > best.rank ? interest : best
  }, noInterest)
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
  const filmById = new Map(films.map(film => [film.id, film]))
  return films
    .reduce((list, film) => {
      const memberFilms = Array.isArray(film.memberFilmIds)
        ? film.memberFilmIds.map(id => filmById.get(id)).filter(Boolean)
        : []
      const interest = resolveScreeningInterest(film, filmById, filmMarks)
      const interestKey = interest.key
      const rows = film.screenings.map(screening => {
        const ticket = sanitizeTicketText(screening.ticket)
        const ticketPlan = sanitizeTicketText(screening.ticketPlan || ticket)
        return {
          filmId: film.id,
          cnTitle: filmDisplayTitle(film),
          enTitle: filmEnTitle(film),
          section: filmSection(film),
          director: filmDirector(film),
          country: filmCountry(film),
          year: filmYear(film),
          runtime: filmRuntimeMinutes(film),
          posterSrc: filmPosterSrc(film),
          cardMeta: slashMeta([filmCoreMeta(film), filmDirector(film)]),
          sectionLabel: filmSection(film),
          ratingSummary: filmRatingSummary(film),
          doubanRating: film.doubanRating,
          imdbRating: film.imdbRating,
          memberFilmIds: Array.isArray(film.memberFilmIds) ? film.memberFilmIds : [],
          memberCnTitles: Array.isArray(film.memberCnTitles) ? film.memberCnTitles : [],
          programType: film.programType || '',
          interestKey,
          interest,
          timeRange: `${screening.start}-${screening.end}`,
          startMinutes: toMinutes(screening.start),
          endMinutes: endMinutes(screening),
          duration: endMinutes(screening) - toMinutes(screening.start),
          screenMeta: filmScreeningMeta(film),
          searchText: [
            filmDisplayTitle(film),
            filmEnTitle(film),
            filmDirector(film),
            filmSection(film),
            filmCountry(film),
            filmGenre(film),
            film.memberCnTitles,
            memberFilms.map(member => [
              filmDisplayTitle(member),
              filmEnTitle(member),
              filmDirector(member),
              filmSection(member),
              filmGenre(member)
            ].join(' ')),
            screening.cinema,
            screening.hall
          ].join(' ').toLowerCase(),
          ...screening,
          ticket,
          ticketPlan
        }
      })
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

function slashMeta(items) {
  return items
    .map(item => String(item || '').trim().replace(/\s+·\s+/g, ' / '))
    .filter(Boolean)
    .join(' / ')
}

function firstText(items) {
  const list = Array.isArray(items) ? items : [items]
  const value = list.find(item => String(item || '').trim())
  return value === undefined ? '' : String(value).trim()
}

function sanitizeTicketText(value) {
  const text = firstText(value)
  if (!text) {
    return ''
  }

  return text
    .split(/\s*[·,，、|｜/]\s*/)
    .map(item => item.trim())
    .filter(item => item && item !== '测试场次')
    .join(' · ')
}

function filmDisplayTitle(film) {
  return firstText([film.cnTitle, film.officialTitle, film.title, film.doubanTitle])
}

function filmEnTitle(film) {
  return firstText([film.enTitle, film.titleEn, film.originalTitle])
}

function filmSection(film) {
  return firstText([film.section, film.unit])
}

function filmDirector(film) {
  return firstText([film.director, film.directors])
}

function filmCast(film) {
  return firstText([film.cast, film.actors, film.actor, film.starring])
}

function filmImdbId(film) {
  const imdbId = firstText([film.imdbId, film.imdbID])
  if (imdbId) {
    return imdbId
  }
  const matched = firstText(film.imdbUrl).match(/\/title\/(tt\d+)/)
  return matched ? matched[1] : ''
}

function filmAwards(film) {
  return firstText([film.awards, film.awardText])
}

function filmCountry(film) {
  return firstText([film.country, film.region, film.countries])
}

function filmGenre(film) {
  if (Array.isArray(film.genre)) {
    return film.genre.filter(Boolean).join(' ')
  }
  if (Array.isArray(film.genres)) {
    return film.genres.filter(Boolean).join(' ')
  }
  return firstText([film.genre, film.genres])
}

function filmYear(film) {
  const year = firstText([film.year, film.doubanYear, film.excelYear])
  return year ? String(year) : ''
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') {
    return 0
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  const matched = String(value).replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : 0
}

function filmRuntimeMinutes(film) {
  const value = numericValue(firstText([film.runtimeMinutes, film.runtime, film.duration]))
  return value > 0 ? Math.round(value) : 0
}

function isDefaultPosterSrc(src) {
  return /\/pics\/subject\/movie_(large|mid|small)\.jpg(?:\?|$)/.test(String(src || ''))
}

function filmPosterSrc(film) {
  if (isDefaultPosterSrc(firstText([film.posterUrl, film.coverUrl, film.cover]))) {
    return ''
  }
  return firstText([film.posterCloudFileId, film.posterUrl, film.coverUrl, film.cover, film.posterAssetPath, film.poster])
}

function formatRating(value) {
  const rating = numericValue(value)
  return rating > 0 ? rating.toFixed(1).replace(/\.0$/, '') : ''
}

function formatRatingCount(value) {
  const count = Math.round(numericValue(value))
  if (count <= 0) {
    return ''
  }
  if (count >= 10000) {
    const rounded = count >= 100000 ? Math.round(count / 10000) : Math.round(count / 1000) / 10
    return `${rounded}万人`
  }
  return `${count}人`
}

function filmRatingItems(film) {
  const douban = formatRating(film.doubanRating)
  const imdb = formatRating(film.imdbRating)
  const items = []
  if (douban) {
    items.push({
      key: 'douban',
      label: '豆瓣',
      value: douban,
      extra: formatRatingCount(film.doubanRatingCount)
    })
  }
  if (imdb) {
    items.push({
      key: 'imdb',
      label: 'IMDb',
      value: imdb,
      extra: formatRatingCount(film.imdbRatingCount)
    })
  }
  return items
}

function filmRatingSummary(film) {
  return filmRatingItems(film)
    .map(item => `${item.label} ${item.value}`)
    .join(' · ')
}

function filmCoreMeta(film) {
  return compactMeta([filmYear(film), filmCountry(film), runtimeText(filmRuntimeMinutes(film))])
}

function filmScreeningMeta(film) {
  return compactMeta([filmSection(film), filmYear(film), runtimeText(filmRuntimeMinutes(film))])
}

function findFilm(films, filmId) {
  return films.find(film => film.id === filmId)
}

function findScreening(screenings, screeningId) {
  return screenings.find(screening => screening.id === screeningId)
}

function isRelatedScreeningForFilm(screening, film) {
  if (!screening || !film) {
    return false
  }
  return screening.filmId === film.id ||
    (film.mappedProgramFilmId && screening.filmId === film.mappedProgramFilmId) ||
    (Array.isArray(screening.memberFilmIds) && screening.memberFilmIds.includes(film.id))
}

function findFilmScreenings(film, allScreenings) {
  return (allScreenings || []).filter(screening => isRelatedScreeningForFilm(screening, film))
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
  const minutes = Math.round(numericValue(runtime))
  if (!minutes) {
    return ''
  }
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return hour ? `${hour}小时${minute ? `${minute}分` : ''}` : `${minute}分`
}

module.exports = {
  buildPlan,
  buildScreenings,
  collectStats,
  compactMeta,
  filmAwards,
  filmCast,
  filmCoreMeta,
  filmCountry,
  filmDirector,
  filmDisplayTitle,
  filmEnTitle,
  filmGenre,
  filmImdbId,
  filmPosterSrc,
  filmRatingItems,
  filmRatingSummary,
  filmRuntimeMinutes,
  filmScreeningMeta,
  filmSection,
  filmYear,
  findConflicts,
  findFilmScreenings,
  findFilm,
  findScreening,
  firstText,
  formatRatingCount,
  getInterestMeta,
  groupByDay,
  slashMeta,
  runtimeText
}
